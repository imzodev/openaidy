/**
 * SQLite-backed tests for WorkflowRunsRepository and the subtask state
 * transitions workflow runs rely on (claimPending, skipSubtask, full
 * resets).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { TasksRepository } from './tasks';
import { SubtasksRepository } from './subtasks';
import { WorkflowRunsRepository } from './workflow-runs';

describe('WorkflowRunsRepository (sqlite)', () => {
  const dbPath = join(tmpdir(), `openaidy-workflow-runs-${Date.now()}.db`);
  let conn: DatabaseConnection;
  let tasksRepo: TasksRepository;
  let subtasksRepo: SubtasksRepository;
  let runsRepo: WorkflowRunsRepository;

  async function setup() {
    conn = await createDatabaseClient({ kind: 'sqlite', sqlitePath: dbPath });
    tasksRepo = new TasksRepository(conn.db);
    subtasksRepo = new SubtasksRepository(conn.db);
    runsRepo = new WorkflowRunsRepository(conn.db);
    return tasksRepo.create({ title: 'Workflow', description: 'desc' });
  }

  afterEach(async () => {
    if (conn) await conn.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it('creates a running run and finds it', async () => {
    const task = await setup();
    const run = await runsRepo.create({ taskId: task.id, trigger: 'agent' });

    expect(run.status).toBe('running');
    expect(run.trigger).toBe('agent');
    expect((await runsRepo.findRunning(task.id))?.id).toBe(run.id);
    expect((await runsRepo.listRunning()).map((r) => r.id)).toEqual([run.id]);
  });

  it('finishes a run only once', async () => {
    const task = await setup();
    const run = await runsRepo.create({ taskId: task.id, trigger: 'manual' });

    const cancelled = await runsRepo.finish(run.id, {
      status: 'cancelled',
      error: 'Run stopped',
    });
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.finishedAt).not.toBeNull();

    // A late completion must not overwrite the cancellation.
    expect(await runsRepo.finish(run.id, { status: 'completed' })).toBeNull();
    expect((await runsRepo.findById(run.id))?.status).toBe('cancelled');
    expect(await runsRepo.findRunning(task.id)).toBeNull();
  });

  it('reopens a finished run', async () => {
    const task = await setup();
    const run = await runsRepo.create({ taskId: task.id, trigger: 'manual' });
    await runsRepo.finish(run.id, { status: 'failed', error: 'boom' });

    const reopened = await runsRepo.reopen(run.id);
    expect(reopened?.status).toBe('running');
    expect(reopened?.error).toBeNull();
    expect(reopened?.finishedAt).toBeNull();
  });

  it('lists runs newest first', async () => {
    const task = await setup();
    const first = await runsRepo.create({ taskId: task.id, trigger: 'manual' });
    await runsRepo.finish(first.id, { status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await runsRepo.create({
      taskId: task.id,
      trigger: 'schedule',
    });

    const runs = await runsRepo.listByTask(task.id);
    expect(runs.map((r) => r.id)).toEqual([second.id, first.id]);
    expect((await runsRepo.findLatest(task.id))?.id).toBe(second.id);
  });

  it('claims a pending subtask exactly once', async () => {
    const task = await setup();
    const subtask = await subtasksRepo.create({
      taskId: task.id,
      title: 'A',
      description: 'a',
    });

    const [first, second] = await Promise.all([
      subtasksRepo.claimPending(subtask.id),
      subtasksRepo.claimPending(subtask.id),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await subtasksRepo.findById(subtask.id))?.status).toBe(
      'in_progress',
    );
  });

  it('skips only pending subtasks, keeping the reason', async () => {
    const task = await setup();
    const pending = await subtasksRepo.create({
      taskId: task.id,
      title: 'A',
      description: 'a',
    });
    const done = await subtasksRepo.create({
      taskId: task.id,
      title: 'B',
      description: 'b',
    });
    await subtasksRepo.completeSubtask(done.id, 'ok');

    expect(
      (await subtasksRepo.skipSubtask(pending.id, 'branch not taken'))?.result,
    ).toBe('branch not taken');
    expect(await subtasksRepo.skipSubtask(done.id, 'nope')).toBeNull();
    expect((await subtasksRepo.findById(done.id))?.status).toBe('completed');
  });

  it('resetByTask clears loop, approval and retry state', async () => {
    const task = await setup();
    const loop = await subtasksRepo.create({
      taskId: task.id,
      title: 'Loop',
      description: 'l',
      loop: {
        maxIterations: 3,
        conditionOperator: 'equals',
        conditionValue: 'ok',
      },
    });
    const gate = await subtasksRepo.create({
      taskId: task.id,
      title: 'Gate',
      description: 'g',
      subtaskKind: 'approval_gate',
    });
    await subtasksRepo.recordLoopIteration(loop.id, { result: 'try 1' });
    await subtasksRepo.incrementRetryCount(loop.id);
    await subtasksRepo.setAwaitingApproval(gate.id, true);
    await subtasksRepo.resolveApproval(gate.id, { decision: 'rejected' });

    await subtasksRepo.resetByTask(task.id);

    const resetLoop = (await subtasksRepo.findById(loop.id))!;
    expect(resetLoop.status).toBe('pending');
    expect(resetLoop.loopIterationCount).toBe(0);
    expect(resetLoop.loopLastResult).toBeNull();
    expect(resetLoop.retryCount).toBe(0);
    const resetGate = (await subtasksRepo.findById(gate.id))!;
    expect(resetGate.approvalDecision).toBeNull();
    expect(resetGate.awaitingApprovalSince).toBeNull();
  });

  it('recordLoopIteration gives each iteration fresh retries', async () => {
    const task = await setup();
    const loop = await subtasksRepo.create({
      taskId: task.id,
      title: 'Loop',
      description: 'l',
      loop: {
        maxIterations: 9,
        conditionOperator: 'equals',
        conditionValue: 'ok',
      },
    });
    await subtasksRepo.incrementRetryCount(loop.id);
    await subtasksRepo.incrementRetryCount(loop.id);

    const next = await subtasksRepo.recordLoopIteration(loop.id, {
      result: 'again',
    });
    expect(next?.retryCount).toBe(0);
    expect(next?.loopIterationCount).toBe(1);
  });
});
