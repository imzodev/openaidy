import { describe, it, expect } from 'vitest';
import type { ScheduledRunnable, ExecutionResult } from './scheduling';

/**
 * Smoke tests for the ScheduledRunnable contract.
 *
 * These tests don't exercise real implementations — they just verify
 * the interface is shaped as documented and that a minimal implementation
 * type-checks. Full behaviour tests live with each implementation
 * (TaskScheduleExecutor in Phase 2).
 */
describe('ScheduledRunnable contract', () => {
  it('accepts a minimal implementation', async () => {
    const fake: ScheduledRunnable<{ taskId: string }> = {
      kind: 'fake',
      async claimNextDue() {
        return { id: 'row-1', payload: { taskId: 'task-1' } };
      },
      async execute(_id, _payload) {
        return { ok: true, durationMs: 5 };
      },
      async reschedule(_id, _payload, _result) {
        return null;
      },
    };

    const claimed = await fake.claimNextDue();
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe('row-1');
    expect(claimed!.payload.taskId).toBe('task-1');

    const result = await fake.execute(claimed!.id, claimed!.payload);
    expect(result.ok).toBe(true);

    const next = await fake.reschedule(claimed!.id, claimed!.payload, result);
    expect(next).toBeNull();
  });

  it('claimNextDue can return null when nothing is due', async () => {
    const empty: ScheduledRunnable = {
      kind: 'empty',
      async claimNextDue() {
        return null;
      },
      async execute() {
        return { ok: true, durationMs: 0 };
      },
      async reschedule() {
        return null;
      },
    };

    const claimed = await empty.claimNextDue();
    expect(claimed).toBeNull();
  });

  it('execute can return a failure result', async () => {
    const failing: ScheduledRunnable = {
      kind: 'failing',
      async claimNextDue() {
        return { id: 'r', payload: null };
      },
      async execute() {
        const result: ExecutionResult = {
          ok: false,
          error: new Error('boom'),
          durationMs: 12,
        };
        return result;
      },
      async reschedule() {
        return null;
      },
    };

    const claimed = await failing.claimNextDue();
    const result = await failing.execute(claimed!.id, claimed!.payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('boom');
      expect(result.durationMs).toBe(12);
    }
  });
});
