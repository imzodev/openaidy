/**
 * Workflow run tests.
 *
 * Real SQLite database and repositories, with a scripted session service
 * standing in for the agents. Each test builds a small graph, starts a
 * run and checks how every step and the run itself end up.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDatabaseAdapter,
  type DatabaseAdapter,
  type Subtask,
  type Task,
} from '@openaidy/db';
import { DEFAULT_EXECUTION_CONFIG } from '@openaidy/config';
import { getWorkflowTemplate } from '@openaidy/workflow-templates';
import { TaskService, type TaskServiceOptions } from './service';
import {
  createWorkflowApprovalListTool,
  createWorkflowApprovalResolveTool,
} from '../tools/workflows/approvals';

import { FakeSessions, deferred, type Reply } from './testing/fake-sessions';

describe('workflow runs', { timeout: 20000 }, () => {
  let dir: string;
  let db: DatabaseAdapter;
  let sessions: FakeSessions;
  let service: TaskService;
  let task: Task;
  let maxRetries: number;
  let depContextPerItemChars: number;

  const build = () =>
    new TaskService({
      tasksRepo: db.repositories.tasks,
      subtasksRepo: db.repositories.subtasks,
      taskAgentsRepo: db.repositories.taskAgents,
      taskExecutionHistoryRepo: db.repositories.taskExecutionHistory,
      workflowRunsRepo: db.repositories.workflowRuns,
      sessionService: sessions as unknown as NonNullable<
        TaskServiceOptions['sessionService']
      >,
      getExecutionConfig: () => ({
        ...DEFAULT_EXECUTION_CONFIG,
        maxRetries,
        depContextPerItemChars,
      }),
    });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'openaidy-workflow-run-'));
    db = await createDatabaseAdapter({
      kind: 'sqlite',
      sqlitePath: join(dir, 'openaidy.db'),
    });
    sessions = new FakeSessions(db);
    maxRetries = DEFAULT_EXECUTION_CONFIG.maxRetries;
    depContextPerItemChars = DEFAULT_EXECUTION_CONFIG.depContextPerItemChars;
    service = build();
    task = await db.repositories.tasks.create({
      title: 'Workflow',
      description: 'A workflow',
      planningEnabled: true,
    });
  });

  afterEach(async () => {
    await service.whenIdle();
    service.destroy();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const step = (
    title: string,
    extra: Partial<Parameters<typeof db.repositories.subtasks.create>[0]> = {},
  ) =>
    db.repositories.subtasks.create({
      taskId: task.id,
      title,
      description: `DO:${title}`,
      ...extra,
    });

  const edge = (
    from: Subtask,
    to: Subtask,
    condition?: { operator: string; value: string },
  ) =>
    db.repositories.subtasks.addEdge({
      subtaskId: to.id,
      dependsOnSubtaskId: from.id,
      ...(condition ? { edgeKind: 'conditional' as const, condition } : {}),
    });

  const statuses = async () => {
    const rows = await db.repositories.subtasks.listByTask(task.id);
    return Object.fromEntries(rows.map((s) => [s.title, s.status]));
  };

  const latestRun = () => db.repositories.workflowRuns.findLatest(task.id);

  /** Reply per step, keyed by the step title in its prompt. */
  const replies = (map: Record<string, Reply | (() => Reply)>) => {
    sessions.reply = (turn) => {
      const title = /DO:([\w ]+)/.exec(turn.content)?.[1]?.trim();
      const reply = title ? map[title] : undefined;
      if (typeof reply === 'function') return reply();
      return reply ?? 'Done.';
    };
  };

  it('runs a linear workflow to completion and records the run', async () => {
    const a = await step('A');
    const b = await step('B');
    await edge(a, b);
    replies({ A: 'Result of A' });

    const started = await service.startRun(task.id);
    expect(started.ok).toBe(true);
    await service.whenIdle();

    expect(await statuses()).toEqual({ A: 'completed', B: 'completed' });
    const run = await latestRun();
    expect(run?.status).toBe('completed');
    expect(run?.finishedAt).not.toBeNull();
    const summary = JSON.parse(run!.summary!);
    expect(summary.completed).toBe(2);
    expect((await db.repositories.tasks.findById(task.id))?.status).toBe(
      'review',
    );
    // B got A's result as context.
    const bTurn = sessions.stepTurns().find((t) => t.content.includes('DO:B'));
    expect(bTurn?.content).toContain('Result of A');
  });

  it('bounds handed-off results and loop context by the configured limit', async () => {
    depContextPerItemChars = 40;
    service = build();
    const a = await step('A');
    const b = await step('B', {
      loop: {
        maxIterations: 2,
        conditionOperator: 'equals',
        conditionValue: 'ok',
      },
    });
    await step('Unrelated');
    await edge(a, b);
    let bCalls = 0;
    replies({
      A: 'a'.repeat(500),
      Unrelated: 'SECRET-UNRELATED',
      B: () => (++bCalls === 1 ? 'b'.repeat(500) : 'OUTCOME: ok'),
    });

    await service.startRun(task.id);
    await service.whenIdle();

    const bTurns = sessions
      .stepTurns()
      .filter((t) => t.content.includes('DO:B'));
    expect(bTurns).toHaveLength(2);
    expect(bTurns[0]!.content).not.toContain('a'.repeat(100));
    expect(bTurns[0]!.content).not.toContain('SECRET-UNRELATED');
    expect(bTurns[1]!.content).toContain('iteration 2 of 2');
    expect(bTurns[1]!.content).not.toContain('b'.repeat(100));
  });

  it('returns before agent steps finish', async () => {
    await step('Slow');
    const gate = deferred<Reply>();
    sessions.reply = () => gate.promise;

    const started = await service.startRun(task.id);
    expect(started.ok).toBe(true);
    expect(await statuses()).toEqual({ Slow: 'in_progress' });
    expect((await latestRun())?.status).toBe('running');

    gate.resolve('Finally.');
    await service.whenIdle();
    expect((await latestRun())?.status).toBe('completed');
  });

  it('skips the branch not taken and joins after it', async () => {
    const check = await step('Check');
    const yes = await step('Yes');
    const no = await step('No');
    const join = await step('Join');
    await edge(check, yes, { operator: 'equals', value: 'yes' });
    await edge(check, no, { operator: 'equals', value: 'no' });
    await edge(yes, join);
    await edge(no, join);
    replies({ Check: 'Looked into it.\nOUTCOME: yes' });

    await service.startRun(task.id);
    await service.whenIdle();

    expect(await statuses()).toEqual({
      Check: 'completed',
      Yes: 'completed',
      No: 'skipped',
      Join: 'completed',
    });
    expect((await latestRun())?.status).toBe('completed');
    const skipped = (await db.repositories.subtasks.findById(no.id))!;
    expect(skipped.result).toContain('did not match');
  });

  it('skips a fan-in step when one of its conditions is not met', async () => {
    const tests = await step('Tests');
    const review = await step('Review');
    const deploy = await step('Deploy');
    await edge(tests, deploy);
    await edge(review, deploy, { operator: 'equals', value: 'approved' });
    replies({ Review: 'OUTCOME: changes-requested' });

    await service.startRun(task.id);
    await service.whenIdle();

    expect((await statuses())['Deploy']).toBe('skipped');
    expect((await latestRun())?.status).toBe('completed');
  });

  it('routes a rejected approval to its branch and skips the approved path', async () => {
    const draft = await step('Draft');
    const gate = await step('Approve', { subtaskKind: 'approval_gate' });
    const send = await step('Send');
    const revise = await step('Revise');
    await edge(draft, gate);
    await edge(gate, send);
    await edge(gate, revise, { operator: 'equals', value: 'rejected' });

    await service.startRun(task.id);
    await service.whenIdle();
    expect((await statuses())['Approve']).toBe('in_progress');
    expect((await latestRun())?.status).toBe('running');

    const resolved = await service.resolveApproval(
      gate.id,
      'rejected',
      'Too long',
    );
    expect(resolved.ok).toBe(true);
    await service.whenIdle();

    expect(await statuses()).toEqual({
      Draft: 'completed',
      Approve: 'completed',
      Send: 'skipped',
      Revise: 'completed',
    });
    expect((await latestRun())?.status).toBe('completed');
  });

  it('fails the run when a step fails, skipping what depends on it', async () => {
    const a = await step('A');
    const b = await step('B');
    await step('C');
    await edge(a, b);
    replies({ A: { fail: 'provider exploded' } });

    await service.startRun(task.id);
    await service.whenIdle();

    expect(await statuses()).toEqual({
      A: 'failed',
      B: 'skipped',
      C: 'completed',
    });
    const run = await latestRun();
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('"A" failed');
    expect(run?.error).toContain('provider exploded');
    expect((await db.repositories.tasks.findById(task.id))?.status).toBe(
      'todo',
    );
  });

  it('keeps looping past the retry limit until the condition is met', async () => {
    maxRetries = 2;
    service = build();
    await step('Loop', {
      loop: {
        maxIterations: 7,
        conditionOperator: 'equals',
        conditionValue: 'done',
      },
    });
    let calls = 0;
    replies({
      Loop: () => (++calls >= 6 ? 'OUTCOME: done' : 'OUTCOME: again'),
    });

    await service.startRun(task.id);
    await service.whenIdle();

    expect(calls).toBe(6);
    expect((await statuses())['Loop']).toBe('completed');
    expect((await latestRun())?.status).toBe('completed');
  });

  it('fails a loop that runs out of iterations', async () => {
    await step('Loop', {
      loop: {
        maxIterations: 3,
        conditionOperator: 'equals',
        conditionValue: 'PASS',
      },
    });
    replies({ Loop: 'OUTCOME: FAIL' });

    await service.startRun(task.id);
    await service.whenIdle();

    const loop = (await db.repositories.subtasks.listByTask(task.id))[0]!;
    expect(loop.status).toBe('failed');
    expect(loop.result).toContain('Stopped after 3 iterations');
    expect(sessions.stepTurns()).toHaveLength(3);
    expect((await latestRun())?.status).toBe('failed');
  });

  it('retries with the verifier reason, then fails after max attempts', async () => {
    maxRetries = 2;
    service = build();
    await step('A');
    sessions.verdict = () =>
      '{"verdict": "INCOMPLETE", "reason": "no file was written"}';

    await service.startRun(task.id);
    await service.whenIdle();

    const turns = sessions.stepTurns();
    expect(turns).toHaveLength(2);
    expect(turns[1]!.content).toContain('no file was written');
    const a = (await db.repositories.subtasks.listByTask(task.id))[0]!;
    expect(a.status).toBe('failed');
    expect(a.result).toContain('Did not pass verification after 2 attempts');
    expect((await latestRun())?.status).toBe('failed');
  });

  it('runs again from scratch, including loop and approval state', async () => {
    const loop = await step('Loop', {
      loop: {
        maxIterations: 2,
        conditionOperator: 'equals',
        conditionValue: 'ok',
      },
    });
    const gate = await step('Gate', { subtaskKind: 'approval_gate' });
    await edge(loop, gate);
    let calls = 0;
    replies({
      Loop: () => (++calls % 2 === 0 ? 'OUTCOME: ok' : 'OUTCOME: no'),
    });

    await service.startRun(task.id);
    await service.whenIdle();
    await service.resolveApproval(gate.id, 'approved');
    await service.whenIdle();
    expect((await latestRun())?.status).toBe('completed');

    const second = await service.startRun(task.id);
    expect(second.ok).toBe(true);
    await service.whenIdle();
    // The loop got its full two iterations again and the gate waits again.
    expect(calls).toBe(4);
    const rows = await db.repositories.subtasks.listByTask(task.id);
    const gateRow = rows.find((s) => s.id === gate.id)!;
    expect(gateRow.status).toBe('in_progress');
    expect(gateRow.approvalDecision).toBeNull();
    expect(await db.repositories.workflowRuns.listByTask(task.id)).toHaveLength(
      2,
    );
  });

  it('refuses to start a second run while one is going', async () => {
    await step('Slow');
    const gate = deferred<Reply>();
    sessions.reply = () => gate.promise;

    await service.startRun(task.id);
    const again = await service.startRun(task.id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('workflow.already_running');

    gate.resolve('done');
  });

  it('never starts the same step twice under concurrent calls', async () => {
    await step('A');
    await step('B');
    const gate = deferred<Reply>();
    sessions.reply = () => gate.promise;

    await Promise.all([
      service.executeSubtasks(task.id),
      service.executeSubtasks(task.id),
      service.executeSubtasks(task.id),
    ]);
    gate.resolve('ok');
    await service.whenIdle();

    expect(sessions.stepTurns()).toHaveLength(2);
    expect(await db.repositories.workflowRuns.listByTask(task.id)).toHaveLength(
      1,
    );
  });

  it('stops a run: aborts the running step and starts nothing else', async () => {
    const a = await step('A');
    const b = await step('B');
    await edge(a, b);
    sessions.reply = () => new Promise<Reply>(() => {});

    await service.startRun(task.id);
    const cancelled = await service.cancelRun(task.id);
    expect(cancelled.ok).toBe(true);
    await service.whenIdle();

    expect(sessions.cancelled).toHaveLength(1);
    expect(await statuses()).toEqual({ A: 'failed', B: 'pending' });
    expect((await latestRun())?.status).toBe('cancelled');
    expect(sessions.stepTurns()).toHaveLength(1);
  });

  it('retries a failed step and finishes the same run', async () => {
    const a = await step('A');
    const b = await step('B');
    await edge(a, b);
    let fail = true;
    replies({ A: () => (fail ? { fail: 'flaky' } : 'ok') });

    await service.startRun(task.id);
    await service.whenIdle();
    expect((await latestRun())?.status).toBe('failed');

    fail = false;
    const retried = await service.retrySubtask(a.id);
    expect(retried.ok).toBe(true);
    await service.whenIdle();

    expect(await statuses()).toEqual({ A: 'completed', B: 'completed' });
    const runs = await db.repositories.workflowRuns.listByTask(task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('completed');
  });

  it('fails steps interrupted by a restart so the run finishes', async () => {
    await step('A');
    await step('Gate', { subtaskKind: 'approval_gate' });
    const lost = deferred<Reply>();
    sessions.reply = () => lost.promise;
    await service.startRun(task.id);

    // A new process: same database, nothing in flight.
    const restarted = build();
    await restarted.recoverInterruptedRuns();

    const rows = await db.repositories.subtasks.listByTask(task.id);
    const a = rows.find((s) => s.title === 'A')!;
    expect(a.status).toBe('failed');
    expect(a.result).toContain('server restarted');
    // The gate keeps waiting, so the run is still going.
    expect(rows.find((s) => s.title === 'Gate')!.status).toBe('in_progress');
    expect((await latestRun())?.status).toBe('running');
    restarted.destroy();

    // The old process's turn finishing late changes nothing.
    lost.resolve('late');
    await service.whenIdle();
    expect((await db.repositories.subtasks.findById(a.id))?.status).toBe(
      'failed',
    );
  });

  it('fails orphaned steps but leaves steps that are still working', async () => {
    const a = await step('A');
    const run = await db.repositories.workflowRuns.create({
      taskId: task.id,
      trigger: 'manual',
    });
    await db.repositories.subtasks.claimPending(a.id);
    const b = await step('B');

    // B is genuinely running in this process.
    const working = deferred<Reply>();
    sessions.reply = () => working.promise;
    await service.executeSubtask(b.id);

    // Ten minutes later, nothing is working on A.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000);
    try {
      await service.checkStuckSubtasks();
    } finally {
      clock.mockRestore();
    }
    expect((await db.repositories.subtasks.findById(b.id))?.status).toBe(
      'in_progress',
    );
    working.resolve('done');
    await service.whenIdle();

    expect((await db.repositories.subtasks.findById(a.id))?.status).toBe(
      'failed',
    );
    expect((await db.repositories.workflowRuns.findById(run.id))?.status).toBe(
      'failed',
    );
  });

  it('refuses to start a run of a graph with a cycle', async () => {
    const a = await step('A');
    const b = await step('B');
    await edge(a, b);
    await edge(b, a);

    const started = await service.startRun(task.id);
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.code).toBe('workflow.invalid_graph');
      expect(started.error.message).toContain('cycle');
    }
    expect(await latestRun()).toBeNull();
  });

  it('fails the run when steps wait on each other', async () => {
    const a = await step('A');
    const b = await step('B');
    await edge(a, b);
    await edge(b, a);

    // executeSubtasks starts a run without the pre-run graph check, which
    // is how a graph broken behind the editor's back would reach the
    // engine.
    await service.executeSubtasks(task.id);
    await service.whenIdle();

    expect(await statuses()).toEqual({ A: 'skipped', B: 'skipped' });
    const run = await latestRun();
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('wait on each other');
  });

  it('runs the Software Development template end to end', async () => {
    const template = getWorkflowTemplate('software-development')!;
    const applied = await service.applyWorkflowTemplate(task.id, template.id, {
      repo: 'acme/app',
      branch: 'main',
    });
    expect(applied.ok).toBe(true);
    let testRuns = 0;
    sessions.reply = (turn) => {
      if (turn.content.includes('Run the test suite')) {
        return ++testRuns >= 2 ? 'All green.\nOUTCOME: PASS' : 'OUTCOME: FAIL';
      }
      return 'Done.';
    };

    await service.startRun(task.id);
    await service.whenIdle();
    const rows = await db.repositories.subtasks.listByTask(task.id);
    const review = rows.find((s) => s.subtaskKind === 'approval_gate')!;
    expect(review.status).toBe('in_progress');

    await service.resolveApproval(review.id, 'approved');
    await service.whenIdle();

    const final = await db.repositories.subtasks.listByTask(task.id);
    expect(final.every((s) => s.status === 'completed')).toBe(true);
    expect(testRuns).toBe(2);
    expect((await latestRun())?.status).toBe('completed');
  });

  it('lists waiting approvals and resolves one relayed by an agent', async () => {
    const gate = await step('Approve', { subtaskKind: 'approval_gate' });
    const after = await step('After');
    await edge(gate, after);
    await service.startRun(task.id);
    await service.whenIdle();

    const pending = await service.listPendingApprovals();
    expect(pending.map((p) => [p.id, p.taskTitle])).toEqual([
      [gate.id, 'Workflow'],
    ]);

    const ctx = { agentId: 'concierge', sessionId: 's' } as never;
    const list = await createWorkflowApprovalListTool(() => service).execute(
      {},
      ctx,
    );
    expect(list.ok && list.content).toContain(gate.id);

    const resolve = createWorkflowApprovalResolveTool(() => service);
    const result = await resolve.execute(
      { nodeId: gate.id, decision: 'approved', note: 'go ahead' },
      ctx,
    );
    expect(result.ok).toBe(true);
    await service.whenIdle();

    const row = (await db.repositories.subtasks.findById(gate.id))!;
    expect(row.approvedBy).toBe('agent:concierge');
    expect(await service.listPendingApprovals()).toEqual([]);
    expect((await statuses())['After']).toBe('completed');

    const again = await resolve.execute(
      { nodeId: gate.id, decision: 'rejected' },
      ctx,
    );
    expect(again.ok).toBe(false);
  });

  it('announces changes so clients can refresh', async () => {
    const changed: string[] = [];
    const unsubscribe = service.onWorkflowChange((id) => changed.push(id));
    await step('A');

    await service.startRun(task.id);
    await service.whenIdle();
    unsubscribe();

    // Start, step completion and run finish each announce the workflow.
    expect(changed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(changed)).toEqual(new Set([task.id]));
  });
});
