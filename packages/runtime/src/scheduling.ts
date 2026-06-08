/**
 * Polymorphic scheduler extension.
 *
 * The legacy `SchedulerService` polls `scheduled_jobs` and dispatches via a
 * hard-coded `executeJob(job)` switch. The v1 recurring-tasks feature adds
 * a new kind of scheduled work (task schedules) that doesn't fit cleanly
 * into that table — the task system has its own lifecycle (planning →
 * subtasks → verify → done) and a 1-to-1 `task_schedules` table.
 *
 * Rather than forcing both domains into `scheduled_jobs`, we let each
 * domain own its data and expose itself to the scheduler through a
 * `ScheduledRunnable` interface. The scheduler iterates the registry,
 * calls `claimNextDue()` on each, and dispatches the claimed item to
 * `execute()` / `reschedule()`. The scheduler doesn't know what's inside
 * — it just calls these three methods.
 *
 * This is the Phase 0 interface. Wiring it into the legacy
 * `SchedulerService.tick()` is Phase 7's job (the spec keeps the legacy
 * `executeJob` path as a fallback until then). For now, this module
 * just publishes the contract so the rest of the codebase can build
 * against it.
 *
 * @see docs/recurring-tasks/recurring-tasks-technical-specification.md
 */

/**
 * Result of one runnable execution. Either it succeeded with a duration,
 * or it failed with an error and a duration. Callers (the scheduler) use
 * `ok` to decide whether to reschedule and how to record the result.
 */
export type ExecutionResult =
  | { ok: true; durationMs: number }
  | { ok: false; error: Error; durationMs: number };

/**
 * The shape returned by `ScheduledRunnable.claimNextDue`. The
 * scheduler passes these to `execute(id, payload)` and
 * `reschedule(id, payload, result)`. The `id` is the same id the
 * runnable returned; the `payload` is opaque to the scheduler
 * (it's the runnable's per-item context).
 */
export type ClaimedItem<TPayload> = {
  id: string;
  payload: TPayload;
};

/**
 * A work item that the scheduler can claim, execute, and reschedule.
 *
 * The scheduler doesn't know what's inside — it just calls these three
 * methods. Implementations are responsible for atomic claiming, for
 * keeping the claim safe across concurrent ticks, and for any side
 * effects (DB writes, agent invocations, etc.) inside `execute()`.
 *
 * The `kind` discriminator is what the scheduler uses to route a claimed
 * item to the right runnable. Two runnables with the same `kind` would
 * clash — use a unique stable string per implementation.
 */
export interface ScheduledRunnable<TPayload = unknown> {
  /** Unique discriminator used by the scheduler registry. */
  readonly kind: string;

  /**
   * Atomically claim the next due item of this kind. Returns null if
   * nothing is due.
   *
   * Implementations must be safe under concurrent ticks. Two common
   * patterns:
   * - Transactional `UPDATE ... WHERE nextRunAt <= now RETURNING *`
   *   (Postgres / SQLite with row-level locking)
   * - Single-server trust (the current OpenAidy model, since the
   *   server is one process per instance).
   */
  claimNextDue(): Promise<{ id: string; payload: TPayload } | null>;

  /**
   * Execute the claimed item. The implementation is responsible for
   * handling its own errors and reporting them via the returned
   * `ExecutionResult` — the scheduler does not wrap exceptions.
   *
   * The implementation should be idempotent where possible: a previous
   * run may have left partial state, and the next claim might pick up
   * where the last one crashed. Implementations can self-heal by
   * cleaning up at the start of `execute()`.
   */
  execute(id: string, payload: TPayload): Promise<ExecutionResult>;

  /**
   * Compute the next run time after a successful (or failed) execution.
   *
   * Returns the next `nextRunAt` timestamp, or `null` to signal that
   * the schedule is terminal and should not be rescheduled (e.g. a
   * one-shot that has fired, or a recurring schedule that reached
   * `maxExecutions`).
   */
  reschedule(
    id: string,
    payload: TPayload,
    result: ExecutionResult,
  ): Promise<Date | null>;
}
