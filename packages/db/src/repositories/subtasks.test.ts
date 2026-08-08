/**
 * SQLite-backed tests for SubtasksRepository's workflow-graph additions
 * (subtaskKind, loop iteration, approval gating, edge CRUD). Runs in every
 * environment via createDatabaseClient({kind:'sqlite'}) — no Postgres
 * required, unlike the DATABASE_URL-gated integration suite in
 * `tasks.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { TasksRepository } from './tasks';
import { SubtasksRepository } from './subtasks';

describe('SubtasksRepository — workflow graph (sqlite)', () => {
  const dbPath = join(tmpdir(), `openaidy-subtasks-test-${Date.now()}.db`);
  let conn: DatabaseConnection;
  let tasksRepo: TasksRepository;
  let subtasksRepo: SubtasksRepository;

  async function setup() {
    conn = await createDatabaseClient({ kind: 'sqlite', sqlitePath: dbPath });
    tasksRepo = new TasksRepository(conn.db);
    subtasksRepo = new SubtasksRepository(conn.db);
    const task = await tasksRepo.create({
      title: 'Workflow test task',
      description: 'desc',
    });
    return task;
  }

  afterEach(async () => {
    if (conn) await conn.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it('creates an approval_gate subtask and round-trips it', async () => {
    const task = await setup();
    const subtask = await subtasksRepo.create({
      taskId: task.id,
      title: 'Approve deploy',
      description: 'Approve before deploying',
      subtaskKind: 'approval_gate',
    });
    expect(subtask.subtaskKind).toBe('approval_gate');
    expect(subtask.awaitingApprovalSince).toBeNull();
  });

  it('setAwaitingApproval then resolveApproval clears the pause sentinel', async () => {
    const task = await setup();
    const subtask = await subtasksRepo.create({
      taskId: task.id,
      title: 'Approve deploy',
      description: 'Approve before deploying',
      subtaskKind: 'approval_gate',
    });

    const paused = await subtasksRepo.setAwaitingApproval(subtask.id, true);
    expect(paused?.awaitingApprovalSince).not.toBeNull();

    const resolved = await subtasksRepo.resolveApproval(subtask.id, {
      decision: 'approved',
      note: 'looks good',
      approvedBy: 'irving',
    });
    expect(resolved?.awaitingApprovalSince).toBeNull();
    expect(resolved?.approvalDecision).toBe('approved');
    expect(resolved?.approvalNote).toBe('looks good');
    expect(resolved?.approvedBy).toBe('irving');
  });

  it('creates a loop-configured subtask and records iterations', async () => {
    const task = await setup();
    const subtask = await subtasksRepo.create({
      taskId: task.id,
      title: 'Refine draft',
      description: 'Keep refining',
      loop: {
        maxIterations: 3,
        conditionOperator: 'contains',
        conditionValue: 'approved',
      },
    });
    expect(subtask.loopMaxIterations).toBe(3);
    expect(subtask.loopIterationCount).toBe(0);

    const afterIteration = await subtasksRepo.recordLoopIteration(subtask.id, {
      result: 'OUTCOME: needs-work',
    });
    expect(afterIteration?.loopIterationCount).toBe(1);
    expect(afterIteration?.loopLastResult).toBe('OUTCOME: needs-work');
    expect(afterIteration?.status).toBe('pending');
  });

  it('update() can clear loop config by passing loop: null', async () => {
    const task = await setup();
    const subtask = await subtasksRepo.create({
      taskId: task.id,
      title: 'Refine draft',
      description: 'Keep refining',
      loop: {
        maxIterations: 3,
        conditionOperator: 'contains',
        conditionValue: 'approved',
      },
    });

    const cleared = await subtasksRepo.update(subtask.id, { loop: null });
    expect(cleared?.loopMaxIterations).toBeNull();
    expect(cleared?.loopConditionOperator).toBeNull();
    expect(cleared?.loopConditionValue).toBeNull();
  });

  it('addEdge/updateEdge/deleteEdge manage a conditional edge', async () => {
    const task = await setup();
    const upstream = await subtasksRepo.create({
      taskId: task.id,
      title: 'A',
      description: 'first',
    });
    const downstream = await subtasksRepo.create({
      taskId: task.id,
      title: 'B',
      description: 'second',
    });

    const edge = await subtasksRepo.addEdge({
      subtaskId: downstream.id,
      dependsOnSubtaskId: upstream.id,
      edgeKind: 'conditional',
      condition: { operator: 'equals', value: 'approved' },
    });
    expect(edge.edgeKind).toBe('conditional');
    expect(edge.conditionOperator).toBe('equals');

    const full = await subtasksRepo.listEdgesByTaskFull(task.id);
    expect(full).toHaveLength(1);
    expect(full[0]!.id).toBe(edge.id);

    const updated = await subtasksRepo.updateEdge(edge.id, {
      condition: { operator: 'contains', value: 'ok' },
    });
    expect(updated?.conditionOperator).toBe('contains');
    expect(updated?.conditionValue).toBe('ok');

    const deleted = await subtasksRepo.deleteEdge(edge.id);
    expect(deleted?.id).toBe(edge.id);
    expect(await subtasksRepo.listEdgesByTaskFull(task.id)).toHaveLength(0);
  });
});
