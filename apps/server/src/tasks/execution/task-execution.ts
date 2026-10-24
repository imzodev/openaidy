import { nanoid } from 'nanoid';
import type {
  TasksRepository,
  SubtasksRepository,
  TaskAgentsRepository,
  DeliverablesRepository,
  TaskExecutionHistoryRepository,
  WorkflowRunsRepository,
  WorkflowRun,
  Subtask,
  SessionMessage,
} from '@openaidy/db';
import type { AgentRegistry } from '../../agents';
import type { SessionMessageService } from '../../sessions/service';
import type {
  SubmitMessageResult,
  SubmitMessageStreamingInput,
} from '../../sessions/types';
import type { RunEventEmitter } from '../../dispatch/events';
import type {
  ExecutionSubtaskSummary,
  WorkflowRunTrigger,
} from '@openaidy/shared-types';
import {
  DEFAULT_EXECUTION_CONFIG,
  type ExecutionConfig,
} from '@openaidy/config';
import { createLogger } from '../../lib/logger';
import { stripThinking } from '../../lib/message.js';
import {
  createContextBudget,
  truncateWithBudget,
} from '../../lib/context-budget';
import type { SessionMessageRecord, ServiceResult } from '../../types';
import {
  resolveSubtask,
  getDependencySubtasks,
  getDownstreamSubtaskIds,
  evaluateCondition,
  subtaskNeedsOutcomeTag,
  expectedOutcomes,
  isTerminalStatus,
  type SubtaskDependencyEdge,
  type ConditionOperator,
} from './subtask-graph';
import {
  parseVerificationVerdict,
  buildRetryMessage,
} from './verification-verdict';

/**
 * A step whose agent run is no longer tracked by this process (e.g. the
 * run was lost) is failed once it has been quiet this long.
 */
const ORPHANED_STEP_MINUTES = 3;
// Bound on how much of a verifier's rejection reason gets echoed back into
// the retry message, so a verbose verdict can't unboundedly grow the next
// attempt's opening message.
const RETRY_REASON_MAX_CHARS = 1500;
// Per-step result text kept in a finished run's summary.
const SUMMARY_RESULT_MAX_CHARS = 500;

const RESTART_MESSAGE =
  'The server restarted while this step was running. Retry the step to continue.';
const ORPHANED_MESSAGE =
  'This step stopped responding (its agent run was lost). Retry the step to continue.';

type RunStore = Pick<
  WorkflowRunsRepository,
  | 'create'
  | 'findById'
  | 'findRunning'
  | 'findLatest'
  | 'listByTask'
  | 'listRunning'
  | 'finish'
  | 'reopen'
>;

/**
 * Process-local run store, used when no database repository is wired
 * (in-memory deployments and unit tests).
 */
class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, WorkflowRun>();

  async create(input: {
    taskId: string;
    trigger: WorkflowRunTrigger;
    sessionId?: string | null;
    historyId?: string | null;
  }): Promise<WorkflowRun> {
    const run: WorkflowRun = {
      id: nanoid(),
      taskId: input.taskId,
      trigger: input.trigger,
      status: 'running',
      sessionId: input.sessionId ?? null,
      historyId: input.historyId ?? null,
      error: null,
      summary: null,
      startedAt: new Date(),
      finishedAt: null,
    };
    this.runs.set(run.id, run);
    return { ...run };
  }
  async findById(id: string) {
    const run = this.runs.get(id);
    return run ? { ...run } : null;
  }
  async findRunning(taskId: string) {
    return (
      (await this.listByTask(taskId)).find((r) => r.status === 'running') ??
      null
    );
  }
  async findLatest(taskId: string) {
    return (await this.listByTask(taskId))[0] ?? null;
  }
  async listByTask(taskId: string, limit = 50) {
    return [...this.runs.values()]
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async listRunning() {
    return [...this.runs.values()]
      .filter((r) => r.status === 'running')
      .map((r) => ({ ...r }));
  }
  async finish(
    id: string,
    input: {
      status: Exclude<WorkflowRun['status'], 'running'>;
      error?: string | null;
      summary?: string | null;
    },
  ) {
    const run = this.runs.get(id);
    if (!run || run.status !== 'running') return null;
    Object.assign(run, {
      status: input.status,
      error: input.error ?? null,
      summary: input.summary ?? null,
      finishedAt: new Date(),
    });
    return { ...run };
  }
  async reopen(id: string) {
    const run = this.runs.get(id);
    if (!run) return null;
    Object.assign(run, {
      status: 'running',
      error: null,
      summary: null,
      finishedAt: null,
    });
    return { ...run };
  }
}

export type StartRunOptions = {
  trigger?: WorkflowRunTrigger;
  /** Reuse a session the caller already created (scheduled runs). */
  sessionId?: string;
  /** Scheduled runs: the task_execution_history row to finalise. */
  historyId?: string;
  /**
   * Reset every step before starting (default). Callers that already
   * reset or re-planned the graph pass false.
   */
  reset?: boolean;
};

/**
 * Runs a task's subtask graph (a "workflow").
 *
 * Every execution is a workflow run. A run dispatches each step once
 * its incoming edges resolve, skips steps whose branch was not taken,
 * and finishes when every step is terminal (completed, failed or
 * skipped). Agent steps run in the background: their outcome is read
 * from the returned turn rather than correlated from run events, and
 * all state transitions for a task happen under a per-task lock so
 * concurrent completions can't double-dispatch or overwrite each other.
 */
export class TaskExecution {
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly runs: RunStore;
  /** taskId -> tail of the queue of state transitions for that task. */
  private readonly locks = new Map<string, Promise<unknown>>();
  /** taskId -> tail of the verification queue (one verifier turn at a time). */
  private readonly verifyQueues = new Map<string, Promise<unknown>>();
  /** subtaskId -> number of in-process pipelines working on it. */
  private readonly busy = new Map<string, number>();
  /** subtaskId -> key that cancels its current agent turn. */
  private readonly cancelKeys = new Map<string, string>();
  /** Background work started by this executor (awaited by whenIdle). */
  private readonly background = new Set<Promise<unknown>>();
  private readonly changeListeners = new Set<(taskId: string) => void>();

  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly subtasksRepo: SubtasksRepository,
    private readonly taskAgentsRepo: TaskAgentsRepository,
    private readonly deliverablesRepo: DeliverablesRepository | undefined,
    private readonly agents: AgentRegistry | undefined,
    private readonly sessionService: SessionMessageService | undefined,
    _runEvents: RunEventEmitter | undefined,
    private readonly workspaceBaseDir: string | undefined,
    private readonly taskExecutionHistoryRepo:
      | TaskExecutionHistoryRepository
      | undefined,
    // Live getter (rather than a value captured at construction time) so
    // config changes saved via the Settings UI take effect on the next
    // subtask run without restarting the server.
    private readonly getExecutionConfig: () => ExecutionConfig = () =>
      DEFAULT_EXECUTION_CONFIG,
    workflowRunsRepo?: RunStore,
  ) {
    this.logger = createLogger('TaskExecution');
    this.runs = workflowRunsRepo ?? new InMemoryRunStore();
  }

  destroy(): void {
    // Nothing to unsubscribe: step outcomes come from awaited turns.
  }

  /** Resolves once all background work started so far has settled. */
  async whenIdle(): Promise<void> {
    while (this.background.size > 0) {
      await Promise.allSettled([...this.background]);
    }
  }

  private track<T>(promise: Promise<T>): void {
    const tracked = promise.catch((err) => {
      this.logger.error('Background workflow work failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    this.background.add(tracked);
    void tracked.finally(() => this.background.delete(tracked));
  }

  /**
   * Called with the task id after any change to a run or its steps, so
   * clients can refresh instead of polling.
   */
  onWorkflowChange(listener: (taskId: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(taskId: string): void {
    for (const listener of this.changeListeners) {
      try {
        listener(taskId);
      } catch (err) {
        this.logger.warn('Workflow change listener failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Serialise state transitions per task. Every transition runs under
   * this lock, so it is also where changes are announced.
   */
  private withLock<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(taskId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(fn)
      .finally(() => this.notifyChange(taskId));
    this.locks.set(taskId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.locks.get(taskId) === next) this.locks.delete(taskId);
      });
    return next;
  }

  private markBusy(subtaskId: string): () => void {
    this.busy.set(subtaskId, (this.busy.get(subtaskId) ?? 0) + 1);
    return () => {
      const n = (this.busy.get(subtaskId) ?? 1) - 1;
      if (n <= 0) this.busy.delete(subtaskId);
      else this.busy.set(subtaskId, n);
    };
  }

  // ========================================
  // Runs
  // ========================================

  async listRuns(taskId: string, limit?: number): Promise<WorkflowRun[]> {
    return this.runs.listByTask(taskId, limit);
  }

  async getRun(runId: string): Promise<WorkflowRun | null> {
    return this.runs.findById(runId);
  }

  /** Gates waiting for a decision whose step is still in progress. */
  async listPendingApprovals(): Promise<
    Array<Subtask & { taskTitle: string }>
  > {
    const rows = await this.subtasksRepo.listAwaitingApproval();
    return rows.filter((s) => s.status === 'in_progress');
  }

  /**
   * Start a new run of the task. By default every step is reset first,
   * so "Run" always runs the whole workflow again. Returns as soon as
   * the first steps are dispatched; agent steps continue in the
   * background.
   */
  async startRun(
    taskId: string,
    options: StartRunOptions = {},
  ): Promise<ServiceResult<{ runId: string; sessionId: string }>> {
    if (!this.sessionService) {
      return {
        ok: false,
        error: {
          code: 'session.not_configured',
          message: 'Session service is not configured',
        },
      };
    }
    const sessionService = this.sessionService;

    return this.withLock(taskId, async () => {
      const task = await this.tasksRepo.findById(taskId);
      if (!task) {
        return {
          ok: false as const,
          error: {
            code: 'task.not_found',
            message: `Task "${taskId}" not found`,
          },
        };
      }
      const running = await this.runs.findRunning(taskId);
      if (running) {
        return {
          ok: false as const,
          error: {
            code: 'workflow.already_running',
            message:
              'This workflow is already running. Stop the current run first.',
          },
        };
      }

      if (options.reset !== false) {
        await this.subtasksRepo.resetByTask(taskId);
      }

      const sessionId =
        options.sessionId ??
        (await sessionService.createSession(`Task: ${task.title}`, 'task')).id;
      await this.tasksRepo.update(taskId, { sessionId });
      await this.tasksRepo.updateStatus(taskId, 'in_progress');

      const run = await this.runs.create({
        taskId,
        trigger: options.trigger ?? 'manual',
        sessionId,
        historyId: options.historyId ?? null,
      });
      this.logger.info('Workflow run started', {
        taskId,
        runId: run.id,
        trigger: run.trigger,
      });

      const subtasks = await this.subtasksRepo.listByTask(taskId);
      if (subtasks.length === 0) {
        // No graph: the task description is the whole job.
        this.track(this.runDescription(taskId, run, sessionId));
      } else {
        await this.advanceLocked(taskId);
      }
      return { ok: true as const, data: { runId: run.id, sessionId } };
    });
  }

  /**
   * Stop a running run: abort agent steps in flight, fail every step
   * that was still going, and mark the run cancelled.
   */
  async cancelRun(taskId: string): Promise<ServiceResult<WorkflowRun>> {
    return this.withLock(taskId, async () => {
      const run = await this.runs.findRunning(taskId);
      if (!run) {
        return {
          ok: false as const,
          error: {
            code: 'workflow.not_running',
            message: 'This workflow is not running',
          },
        };
      }
      const subtasks = await this.subtasksRepo.listByTask(taskId);
      for (const subtask of subtasks) {
        if (subtask.status !== 'in_progress') continue;
        const key = this.cancelKeys.get(subtask.id);
        if (key) this.sessionService?.cancelRun(key);
        if (subtask.awaitingApprovalSince != null) {
          await this.subtasksRepo.setAwaitingApproval(subtask.id, false);
        }
        await this.subtasksRepo.failSubtask(subtask.id, 'Run stopped');
      }
      const finished = await this.finishRun(run, 'cancelled', 'Run stopped');
      return finished
        ? { ok: true as const, data: finished }
        : {
            ok: false as const,
            error: {
              code: 'workflow.not_running',
              message: 'This workflow is not running',
            },
          };
    });
  }

  /**
   * Run a failed (or skipped) step again, along with everything
   * downstream of it, continuing the task's latest run.
   */
  /** Whether a run of this task is going right now. */
  async isRunning(taskId: string): Promise<boolean> {
    return Boolean(await this.runs.findRunning(taskId));
  }

  async retrySubtask(subtaskId: string): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) return notFound(subtaskId);
    if (subtask.status !== 'failed' && subtask.status !== 'skipped') {
      return {
        ok: false,
        error: {
          code: 'subtask.not_retryable',
          message: `Only failed or skipped steps can be retried (this one is ${subtask.status})`,
        },
      };
    }
    return this.withLock(subtask.taskId, async () => {
      const edges = await this.subtasksRepo.listEdgesByTask(subtask.taskId);
      const toReset = [subtaskId, ...getDownstreamSubtaskIds(subtaskId, edges)];
      for (const id of toReset) await this.subtasksRepo.resetOne(id);

      const running = await this.runs.findRunning(subtask.taskId);
      if (!running) {
        const latest = await this.runs.findLatest(subtask.taskId);
        if (latest) {
          await this.runs.reopen(latest.id);
        } else {
          await this.runs.create({ taskId: subtask.taskId, trigger: 'manual' });
        }
      }
      await this.tasksRepo.updateStatus(subtask.taskId, 'in_progress');
      await this.advanceLocked(subtask.taskId);
      const reloaded = await this.subtasksRepo.findById(subtaskId);
      return reloaded
        ? { ok: true as const, data: reloaded }
        : notFound(subtaskId);
    });
  }

  // ========================================
  // Execution entry points
  // ========================================

  /** Run the whole workflow (resets every step first). */
  async executeTask(
    taskId: string,
    options: { sessionId?: string } = {},
  ): Promise<ServiceResult<{ sessionId: string; runId: string }>> {
    return this.startRun(taskId, {
      trigger: 'manual',
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    });
  }

  /**
   * Start whichever steps are ready, without resetting anything. Starts a
   * run if none is going.
   */
  async executeSubtasks(
    taskId: string,
    options: { trigger?: WorkflowRunTrigger } = {},
  ): Promise<ServiceResult<{ startedCount: number; runId: string }>> {
    const before = await this.countInProgress(taskId);
    const running = await this.runs.findRunning(taskId);
    let runId: string;
    if (running) {
      runId = running.id;
      await this.advance(taskId);
    } else {
      const started = await this.startRun(taskId, {
        trigger: options.trigger ?? 'manual',
        reset: false,
      });
      if (!started.ok) return started;
      runId = started.data.runId;
    }
    const after = await this.countInProgress(taskId);
    return {
      ok: true,
      data: { startedCount: Math.max(0, after - before), runId },
    };
  }

  private async countInProgress(taskId: string): Promise<number> {
    const subtasks = await this.subtasksRepo.listByTask(taskId);
    return subtasks.filter((s) => s.status === 'in_progress').length;
  }

  /** Start one ready step. Starts a run (without resetting) if none is going. */
  async executeSubtask(
    subtaskId: string,
  ): Promise<ServiceResult<{ sessionId: string | null }>> {
    if (!this.sessionService) {
      return {
        ok: false,
        error: {
          code: 'session.not_configured',
          message: 'Session service is not configured',
        },
      };
    }
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) return notFound(subtaskId);
    const taskId = subtask.taskId;

    return this.withLock(taskId, async () => {
      const current = await this.subtasksRepo.findById(subtaskId);
      if (!current) return notFound(subtaskId);
      if (current.status !== 'pending') {
        return {
          ok: false as const,
          error: {
            code: 'subtask.already_executed',
            message: `Subtask "${subtaskId}" is already ${current.status}`,
          },
        };
      }
      const allSubtasks = await this.subtasksRepo.listByTask(taskId);
      const edges = await this.subtasksRepo.listEdgesByTask(taskId);
      if (resolveSubtask(current, allSubtasks, edges).action !== 'run') {
        return {
          ok: false as const,
          error: {
            code: 'subtask.dependency_not_met',
            message: 'One or more dependencies not completed',
          },
        };
      }

      let run = await this.runs.findRunning(taskId);
      if (!run) {
        const task = await this.tasksRepo.findById(taskId);
        run = await this.runs.create({
          taskId,
          trigger: 'manual',
          sessionId: task?.sessionId ?? null,
        });
        await this.tasksRepo.updateStatus(taskId, 'in_progress');
      }

      const claimed = await this.subtasksRepo.claimPending(subtaskId);
      if (!claimed) {
        return {
          ok: false as const,
          error: {
            code: 'subtask.already_executed',
            message: `Subtask "${subtaskId}" was started by another request`,
          },
        };
      }
      const sessionId = await this.dispatch(claimed, allSubtasks, edges);
      return { ok: true as const, data: { sessionId } };
    });
  }

  // ========================================
  // Graph progression
  // ========================================

  private advance(taskId: string): Promise<void> {
    return this.withLock(taskId, () => this.advanceLocked(taskId));
  }

  /**
   * Skip steps that can no longer run, dispatch steps that are ready,
   * and finish the run once every step is terminal. Caller holds the
   * task lock.
   */
  private async advanceLocked(taskId: string): Promise<void> {
    const run = await this.runs.findRunning(taskId);
    if (!run) return;

    let subtasks = await this.subtasksRepo.listByTask(taskId);
    const edges = await this.subtasksRepo.listEdgesByTask(taskId);

    // Skips cascade (a skipped step can make its dependents skippable),
    // so resolve until nothing changes.
    for (;;) {
      let skippedAny = false;
      for (const subtask of subtasks) {
        if (subtask.status !== 'pending') continue;
        const decision = resolveSubtask(subtask, subtasks, edges);
        if (decision.action === 'skip') {
          await this.subtasksRepo.skipSubtask(subtask.id, decision.reason);
          skippedAny = true;
        }
      }
      if (!skippedAny) break;
      subtasks = await this.subtasksRepo.listByTask(taskId);
    }

    for (const subtask of subtasks) {
      if (subtask.status !== 'pending') continue;
      if (resolveSubtask(subtask, subtasks, edges).action !== 'run') continue;
      const claimed = await this.subtasksRepo.claimPending(subtask.id);
      if (!claimed) continue;
      await this.dispatch(claimed, subtasks, edges);
    }

    await this.finishIfDone(run);
  }

  private async finishIfDone(run: WorkflowRun): Promise<void> {
    const subtasks = await this.subtasksRepo.listByTask(run.taskId);
    if (subtasks.some((s) => s.status === 'in_progress')) return;

    const waiting = subtasks.filter((s) => !isTerminalStatus(s.status));
    if (waiting.length > 0) {
      // Nothing is running but some steps never became ready: their
      // dependencies wait on each other.
      for (const s of waiting) {
        await this.subtasksRepo.skipSubtask(
          s.id,
          'Never became ready to run (its dependencies wait on each other).',
        );
      }
      await this.finishRun(
        run,
        'failed',
        `Steps wait on each other and can never start: ${waiting
          .map((s) => `"${s.title}"`)
          .join(', ')}`,
      );
      return;
    }

    const failed = subtasks.find((s) => s.status === 'failed');
    if (failed) {
      await this.finishRun(
        run,
        'failed',
        `"${failed.title}" failed: ${(failed.result ?? 'no details').slice(0, 300)}`,
      );
    } else {
      await this.finishRun(run, 'completed');
    }
  }

  /**
   * Move the run to a terminal status and settle the task and its
   * schedule history row. Returns null if the run had already finished.
   */
  private async finishRun(
    run: WorkflowRun,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
  ): Promise<WorkflowRun | null> {
    const subtasks = await this.subtasksRepo.listByTask(run.taskId);
    const summary = buildRunSummary(subtasks);
    const finished = await this.runs.finish(run.id, {
      status,
      error: error ?? null,
      summary: JSON.stringify(summary),
    });
    if (!finished) return null;

    this.logger.info('Workflow run finished', {
      taskId: run.taskId,
      runId: run.id,
      status,
    });

    // Only one run per task is ever running, so this run owns the task.
    await this.tasksRepo.updateStatus(
      run.taskId,
      status === 'completed' ? 'review' : 'todo',
    );
    if (status === 'completed') await this.verifyDeliverables(run.taskId);

    if (run.historyId && this.taskExecutionHistoryRepo) {
      const durationMs = Date.now() - run.startedAt.getTime();
      await this.taskExecutionHistoryRepo.update(run.historyId, {
        subtaskSummary: JSON.stringify(summary),
      });
      if (status === 'completed') {
        await this.taskExecutionHistoryRepo.markCompleted(
          run.historyId,
          durationMs,
        );
      } else {
        await this.taskExecutionHistoryRepo.markFailed(
          run.historyId,
          durationMs,
          {
            code: status === 'cancelled' ? 'RUN_CANCELLED' : 'RUN_FAILED',
            message: error ?? 'Run failed',
          },
        );
      }
    }
    return finished;
  }

  /** A task with no steps: send its description and wait for the answer. */
  private async runDescription(
    taskId: string,
    run: WorkflowRun,
    sessionId: string,
  ): Promise<void> {
    const task = await this.tasksRepo.findById(taskId);
    const result = await this.sessionService!.submitMessageStreaming({
      sessionId,
      content: task?.description ?? '',
      role: 'user',
      onStreamEvent: () => {},
    });
    await this.withLock(taskId, async () => {
      if (result.ok) {
        await this.finishRun(run, 'completed');
      } else {
        await this.finishRun(run, 'failed', result.error.message);
      }
    });
  }

  // ========================================
  // Steps
  // ========================================

  /**
   * Start a claimed (now in_progress) step. Approval gates pause for a
   * person; agent steps get their own session and run in the
   * background. Returns the step's session id (null for gates).
   */
  private async dispatch(
    subtask: Subtask,
    allSubtasks: Subtask[],
    edges: SubtaskDependencyEdge[],
  ): Promise<string | null> {
    if (subtask.subtaskKind === 'approval_gate') {
      await this.subtasksRepo.setAwaitingApproval(subtask.id, true);
      this.logger.info('Approval gate paused, awaiting human decision', {
        subtaskId: subtask.id,
      });
      return null;
    }

    const session = await this.sessionService!.createSession(
      `Subtask: ${subtask.title}`,
      'subtask',
    );
    await this.subtasksRepo.update(subtask.id, { sessionId: session.id });

    const content = this.buildStepPrompt(subtask, allSubtasks, edges);
    this.track(this.runStepTurn(subtask, session.id, content));
    return session.id;
  }

  private buildStepPrompt(
    subtask: Subtask,
    allSubtasks: Subtask[],
    edges: SubtaskDependencyEdge[],
  ): string {
    // Scope the handoff to this subtask's actual dependencies only
    // (not every completed subtask in the task), and bound its size so
    // a large upstream result can't unboundedly grow this session.
    const completedDeps = getDependencySubtasks(
      subtask,
      allSubtasks,
      edges,
    ).filter((s) => s.status === 'completed' && s.result);

    let messageContent = subtask.description;
    if (completedDeps.length > 0) {
      const { depContextPerItemChars, depContextTotalChars } =
        this.getExecutionConfig();
      const depBudget = createContextBudget(depContextTotalChars);
      const contextParts: string[] = [];
      for (const dep of completedDeps) {
        if (depBudget.remaining <= 0) break;
        const truncatedResult = truncateWithBudget(
          dep.result!,
          depContextPerItemChars,
          depBudget,
        );
        contextParts.push(`## Result from "${dep.title}":\n${truncatedResult}`);
      }
      messageContent = `${subtask.description}\n\n---\n\n**Context from completed dependencies:**\n\n${contextParts.join('\n\n')}`;
    }

    // Loop iteration context: on iterations after the first, prepend the
    // previous attempt's result so the agent can build on (or fix) it.
    if (
      subtask.loopMaxIterations != null &&
      subtask.loopIterationCount > 0 &&
      subtask.loopLastResult
    ) {
      const { depContextPerItemChars } = this.getExecutionConfig();
      const loopBudget = createContextBudget(depContextPerItemChars);
      const truncatedPrevious = truncateWithBudget(
        subtask.loopLastResult,
        depContextPerItemChars,
        loopBudget,
      );
      messageContent =
        `This is iteration ${subtask.loopIterationCount + 1} of ${subtask.loopMaxIterations}. ` +
        `Continue refining until the result satisfies: ${subtask.loopConditionOperator} "${subtask.loopConditionValue}".\n\n` +
        `**Previous attempt's result:**\n${truncatedPrevious}\n\n---\n\n${messageContent}`;
    }

    // Some downstream logic (a conditional branch reading this subtask's
    // result, or this subtask's own loop convergence check) needs a short
    // structured signal rather than free text — ask the agent to end its
    // final message with an OUTCOME line.
    if (subtaskNeedsOutcomeTag(subtask, edges)) {
      const expected = expectedOutcomes(subtask, edges);
      const choices =
        expected.length > 0
          ? ` Use one of these tags, exactly as written, so the workflow can decide what happens next: ${expected.map((v) => `"OUTCOME: ${v}"`).join(', ')}. If none fits, pick the closest.`
          : ' This is used to decide what happens next.';
      messageContent = `${messageContent}\n\n---\n\nEnd your final message with a line "OUTCOME: <short-tag>" summarizing the outcome in a few words (e.g. "OUTCOME: approved" or "OUTCOME: needs-revision").${choices}`;
    }
    return messageContent;
  }

  /**
   * Run one agent turn for a step and act on its outcome: verify and
   * complete it, retry it, or fail it.
   */
  private async runStepTurn(
    subtask: Subtask,
    sessionId: string,
    content: string,
  ): Promise<void> {
    const release = this.markBusy(subtask.id);
    try {
      const cancelKey = `workflow:${subtask.id}:${nanoid(8)}`;
      this.cancelKeys.set(subtask.id, cancelKey);
      const input: SubmitMessageStreamingInput = {
        sessionId,
        content,
        role: 'user',
        runId: cancelKey,
        onStreamEvent: () => {},
      };
      if (subtask.assignedAgentId) input.agentId = subtask.assignedAgentId;

      let result: SubmitMessageResult;
      try {
        result = await this.sessionService!.submitMessageStreaming(input);
      } catch (err) {
        result = {
          ok: false,
          error: {
            code: 'exception',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      } finally {
        if (this.cancelKeys.get(subtask.id) === cancelKey) {
          this.cancelKeys.delete(subtask.id);
        }
      }
      await this.onStepTurnFinished(subtask.id, sessionId, result);
    } finally {
      release();
    }
  }

  private async onStepTurnFinished(
    subtaskId: string,
    sessionId: string,
    result: SubmitMessageResult,
  ): Promise<void> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask || subtask.status !== 'in_progress') return;

    if (!result.ok) {
      const reason =
        result.error.code === 'cancelled'
          ? 'Stopped by user'
          : `The agent run failed: ${result.error.message}`;
      await this.settleStep(subtask, { kind: 'fail', reason });
      return;
    }

    const text =
      stripThinking(
        (result.assistantMessage as { content?: string } | undefined)
          ?.content ?? '',
      ).trim() || 'Completed';
    const updated = await this.subtasksRepo.incrementRetryCount(subtaskId);
    const attempts = updated?.retryCount ?? 1;
    const { maxRetries } = this.getExecutionConfig();

    const messages = await this.sessionService?.listMessages(sessionId);
    const verdict = await this.verifyStep(subtask, text, messages);

    if (!verdict || verdict.isComplete || hasConcreteArtifacts(text)) {
      if (verdict && !verdict.isComplete) {
        this.logger.warn(
          'Verifier said INCOMPLETE but executor response contains concrete success artifacts; completing to avoid duplicate side effects',
          { subtaskId },
        );
      }
      await this.settleStep(subtask, { kind: 'complete', result: text });
      return;
    }

    if (attempts >= maxRetries) {
      await this.settleStep(subtask, {
        kind: 'fail',
        reason:
          `Did not pass verification after ${attempts} attempts: ${verdict.reason}`.slice(
            0,
            2000,
          ),
      });
      return;
    }

    // Retry in the same session, telling the agent what was missing.
    const fresh = await this.subtasksRepo.findById(subtaskId);
    const run = await this.runs.findRunning(subtask.taskId);
    if (fresh?.status !== 'in_progress' || !run) return;
    this.logger.info('Verification says incomplete, retrying step', {
      subtaskId,
      attempts,
    });
    this.track(
      this.runStepTurn(
        fresh,
        sessionId,
        buildRetryMessage(verdict.reason, RETRY_REASON_MAX_CHARS),
      ),
    );
  }

  /**
   * Apply a step's outcome under the task lock, then move the graph on.
   * Ignored if the step is no longer running (stopped, reset or edited).
   */
  private async settleStep(
    subtask: Subtask,
    outcome:
      | { kind: 'complete'; result: string }
      | { kind: 'fail'; reason: string },
  ): Promise<void> {
    await this.withLock(subtask.taskId, async () => {
      const current = await this.subtasksRepo.findById(subtask.id);
      if (!current || current.status !== 'in_progress') return;
      if (!(await this.runs.findRunning(subtask.taskId))) return;

      if (outcome.kind === 'fail') {
        await this.subtasksRepo.failSubtask(current.id, outcome.reason);
      } else {
        await this.completeOrLoop(current, outcome.result);
      }
      await this.advanceLocked(subtask.taskId);
    });
  }

  /**
   * Complete a step — unless it is a bounded loop whose condition isn't
   * met yet, in which case it goes back to pending for another
   * iteration (or fails once the iteration cap is reached). Caller
   * holds the task lock.
   */
  private async completeOrLoop(
    subtask: Subtask,
    result: string,
  ): Promise<void> {
    if (subtask.loopMaxIterations != null) {
      if (!subtask.loopConditionOperator || !subtask.loopConditionValue) {
        await this.subtasksRepo.failSubtask(
          subtask.id,
          'This loop has no condition to check. Set "repeat until" on the step and run it again.',
        );
        return;
      }
      const converged = evaluateCondition(result, {
        operator: subtask.loopConditionOperator as ConditionOperator,
        value: subtask.loopConditionValue,
      });
      if (!converged) {
        const nextIteration = subtask.loopIterationCount + 1;
        if (nextIteration >= subtask.loopMaxIterations) {
          await this.subtasksRepo.failSubtask(
            subtask.id,
            `Stopped after ${subtask.loopMaxIterations} iterations without meeting its condition (${subtask.loopConditionOperator} "${subtask.loopConditionValue}"). Last result: ${result.slice(0, 300)}`,
          );
          return;
        }
        await this.subtasksRepo.recordLoopIteration(subtask.id, { result });
        this.logger.info('Loop condition not met, re-running step', {
          subtaskId: subtask.id,
          iteration: nextIteration,
          maxIterations: subtask.loopMaxIterations,
        });
        return;
      }
    }
    await this.subtasksRepo.completeSubtask(subtask.id, result);
  }

  /**
   * Mark a step completed by hand (API). Moves the graph on if a run is
   * going.
   */
  async completeSubtask(
    subtaskId: string,
    result: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) return notFound(subtaskId);
    return this.withLock(subtask.taskId, async () => {
      const updated = await this.subtasksRepo.completeSubtask(
        subtaskId,
        result,
      );
      await this.advanceLocked(subtask.taskId);
      return updated
        ? { ok: true as const, data: updated }
        : notFound(subtaskId);
    });
  }

  /** Mark a step failed by hand (API). */
  async failSubtask(
    subtaskId: string,
    error: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) return notFound(subtaskId);
    return this.withLock(subtask.taskId, async () => {
      const key = this.cancelKeys.get(subtaskId);
      if (key) this.sessionService?.cancelRun(key);
      const updated = await this.subtasksRepo.failSubtask(subtaskId, error);
      await this.advanceLocked(subtask.taskId);
      return updated
        ? { ok: true as const, data: updated }
        : notFound(subtaskId);
    });
  }

  /**
   * Resolve a paused approval gate. Both decisions complete the gate
   * with an `OUTCOME: approved|rejected` result, so conditional edges
   * can branch on it; plain edges out of a rejected gate are not
   * followed.
   */
  async resolveApproval(
    subtaskId: string,
    decision: 'approved' | 'rejected',
    note?: string,
    approvedBy?: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) return notFound(subtaskId);
    if (subtask.subtaskKind !== 'approval_gate') {
      return {
        ok: false,
        error: {
          code: 'subtask.not_approval_gate',
          message: `Subtask "${subtaskId}" is not an approval gate`,
        },
      };
    }

    return this.withLock(subtask.taskId, async () => {
      const current = await this.subtasksRepo.findById(subtaskId);
      if (current?.status !== 'in_progress') {
        return notAwaiting(subtaskId);
      }
      // The "still awaiting approval" check is enforced atomically inside
      // this UPDATE's WHERE clause, so two concurrent resolve calls can't
      // both win.
      const resolved = await this.subtasksRepo.resolveApproval(subtaskId, {
        decision,
        note: note ?? null,
        approvedBy: approvedBy ?? null,
      });
      if (!resolved) return notAwaiting(subtaskId);

      const updated = await this.subtasksRepo.completeSubtask(
        subtaskId,
        `OUTCOME: ${decision}${note ? `\n\n${note}` : ''}`,
      );
      await this.advanceLocked(subtask.taskId);
      return updated
        ? { ok: true as const, data: updated }
        : notFound(subtaskId);
    });
  }

  /**
   * Re-send a step's session a retry message. Kept for callers that
   * want to nudge a running step; normal retries happen automatically
   * after verification.
   */
  async triggerSubtaskRetry(
    subtaskId: string,
    reason?: string,
  ): Promise<ServiceResult<{ sessionId: string }>> {
    if (!this.sessionService) {
      return {
        ok: false,
        error: {
          code: 'service.not_configured',
          message: 'Session service is not configured',
        },
      };
    }
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) return notFound(subtaskId);
    if (!subtask.sessionId) {
      return {
        ok: false,
        error: {
          code: 'subtask.no_session',
          message: `Subtask "${subtaskId}" has no linked session`,
        },
      };
    }
    const sessionId = subtask.sessionId;
    this.track(
      this.runStepTurn(
        subtask,
        sessionId,
        buildRetryMessage(reason, RETRY_REASON_MAX_CHARS),
      ),
    );
    return { ok: true, data: { sessionId } };
  }

  // ========================================
  // Recovery
  // ========================================

  /**
   * On startup: steps that were running when the process stopped have
   * lost their agent run. Fail them so their runs finish instead of
   * hanging (approval gates keep waiting).
   */
  async recoverInterruptedRuns(): Promise<void> {
    const running = await this.runs.listRunning();
    for (const run of running) {
      await this.withLock(run.taskId, async () => {
        const subtasks = await this.subtasksRepo.listByTask(run.taskId);
        for (const s of subtasks) {
          if (s.status !== 'in_progress' || s.awaitingApprovalSince != null) {
            continue;
          }
          await this.subtasksRepo.failSubtask(s.id, RESTART_MESSAGE);
        }
        if (subtasks.length === 0) {
          await this.finishRun(run, 'failed', RESTART_MESSAGE);
          return;
        }
        await this.advanceLocked(run.taskId);
      });
    }
    if (running.length > 0) {
      this.logger.info('Recovered interrupted workflow runs', {
        count: running.length,
      });
    }
  }

  /**
   * Periodic safety net: fail agent steps that are marked running but
   * that no pipeline in this process is working on (their run was lost).
   * Steps still being worked on are left alone however long they take.
   */
  async checkStuckSubtasks(): Promise<void> {
    const allSubtasks = await this.subtasksRepo.listAll();
    const now = Date.now();
    const orphaned = allSubtasks.filter((s) => {
      if (s.status !== 'in_progress' || s.awaitingApprovalSince != null) {
        return false;
      }
      if (this.busy.has(s.id)) return false;
      const updatedAt = s.updatedAt ? new Date(s.updatedAt).getTime() : now;
      return now - updatedAt >= ORPHANED_STEP_MINUTES * 60_000;
    });

    for (const subtask of orphaned) {
      this.logger.warn('Failing orphaned workflow step', {
        subtaskId: subtask.id,
      });
      await this.withLock(subtask.taskId, async () => {
        const current = await this.subtasksRepo.findById(subtask.id);
        if (current?.status !== 'in_progress' || this.busy.has(subtask.id)) {
          return;
        }
        await this.subtasksRepo.failSubtask(subtask.id, ORPHANED_MESSAGE);
        if (await this.runs.findRunning(subtask.taskId)) {
          await this.advanceLocked(subtask.taskId);
        } else {
          await this.tasksRepo.updateStatus(subtask.taskId, 'todo');
        }
      });
    }
  }

  // ========================================
  // Verification
  // ========================================

  /**
   * Ask the task's verifier whether a step's work was really done.
   * Verifier turns share the task session, so they run one at a time
   * per task. Returns null when there is nothing to verify with (the
   * step is then accepted as is).
   */
  private async verifyStep(
    subtask: Subtask,
    subtaskResult: string,
    sessionMessages?: (SessionMessage | SessionMessageRecord)[],
  ): Promise<{ isComplete: boolean; reason: string } | null> {
    const prev = this.verifyQueues.get(subtask.taskId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() =>
        this.runVerification(subtask, subtaskResult, sessionMessages),
      );
    this.verifyQueues.set(subtask.taskId, next);
    try {
      return await next;
    } finally {
      if (this.verifyQueues.get(subtask.taskId) === next) {
        this.verifyQueues.delete(subtask.taskId);
      }
    }
  }

  private async runVerification(
    subtask: Subtask,
    subtaskResult: string,
    sessionMessages?: (SessionMessage | SessionMessageRecord)[],
  ): Promise<{ isComplete: boolean; reason: string } | null> {
    if (!this.sessionService) return null;

    const task = await this.tasksRepo.findById(subtask.taskId);
    if (!task?.sessionId) {
      this.logger.warn('No task session found for subtask verification', {
        subtaskId: subtask.id,
        taskId: subtask.taskId,
      });
      return null;
    }

    const taskAgents = await this.taskAgentsRepo.listByTask(subtask.taskId);
    const agentId = taskAgents[0]?.agentId;

    // Toolset of the agent that ACTUALLY executed the subtask. The
    // verification runs on the task session, which uses a different
    // agent (taskAgents[0]); that agent's enabled tools are NOT the
    // tools that were available during execution. We must surface the
    // executor's toolset so the verifier does not dismiss tool calls
    // (e.g. exec_run) as "not in my toolset → fabricated".
    const executorAgentId = (subtask as { assignedAgentId?: string })
      .assignedAgentId;
    const executorTools =
      (executorAgentId && this.agents?.getAgent(executorAgentId)?.tools) || [];

    // Build a map of toolCallId -> result content (truncated) so we
    // can pair each assistant tool call with the real outcome
    // persisted in the following role:'tool' message. Without this
    // evidence the verifier only sees tool NAMES and can hallucinate
    // that calls were fabricated (see false-INCOMPLETE bug).
    const toolResultByCallId = new Map<
      string,
      { content: string; isError: boolean }
    >();
    if (sessionMessages && sessionMessages.length > 0) {
      for (const m of sessionMessages) {
        if (m.role === 'tool') {
          const id = (m as { toolCallId?: string }).toolCallId;
          if (!id) continue;
          const md = (m as { metadata?: Record<string, unknown> }).metadata;
          const isError =
            (m as { isError?: boolean }).isError === true ||
            md?.isError === true;
          const raw = (m as { content?: string }).content ?? '';
          toolResultByCallId.set(id, { content: raw, isError });
        }
      }
    }

    const consultedSkills = new Set<string>();
    const toolCallsWithResults: string[] = [];
    const MAX_PER_RESULT = 1000;
    const MAX_TOTAL_RESULTS = 8192;
    const resultsBudget = createContextBudget(MAX_TOTAL_RESULTS);

    if (sessionMessages && sessionMessages.length > 0) {
      for (const m of sessionMessages) {
        if (m.role !== 'assistant') continue;
        const metadata = (m as { metadata?: Record<string, unknown> }).metadata;
        const toolCalls = metadata?.toolCalls as
          | Array<{ id?: string; name: string; arguments: string }>
          | undefined;
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            let entry = `- ${tc.name}(${tc.arguments})`;
            if (tc.id && toolResultByCallId.has(tc.id)) {
              const result = toolResultByCallId.get(tc.id)!;
              if (resultsBudget.remaining > 0) {
                const truncated = truncateWithBudget(
                  result.content,
                  MAX_PER_RESULT,
                  resultsBudget,
                );
                entry += `\n    → result${
                  result.isError ? ' (ERROR)' : ''
                }: ${truncated}`;
              }
            }
            toolCallsWithResults.push(entry);
          }
        }
        const skills = metadata?.consultedSkills as string[] | undefined;
        if (skills && skills.length > 0) {
          for (const skillId of skills) {
            consultedSkills.add(skillId);
          }
        }
      }
    }

    const consultedSkillsList = Array.from(consultedSkills);

    const executorToolsetBlock =
      executorTools.length > 0
        ? `**IMPORTANT — toolset context**: This subtask was executed by agent "${executorAgentId}" with these tools enabled: ${executorTools.join(', ')}. The tool calls below were made by THAT agent, not by you. Do NOT judge the work based on your own enabled tools — your toolset is different and irrelevant here. Evaluate based on the tool RESULTS and the agent's final response. A tool name you do not have (e.g. exec_run) is NOT evidence of fabrication; it is expected because a different agent did the work.`
        : `**IMPORTANT — toolset context**: This subtask was executed by a different agent with its own toolset. Do NOT judge the work based on your own enabled tools. Evaluate based on the tool RESULTS and the agent's final response.`;

    const verificationPrompt = [
      `Evaluate whether this subtask was successfully completed.`,
      ``,
      `**Subtask**: ${subtask.title}`,
      `**Objective**: ${subtask.description}`,
      ``,
      executorToolsetBlock,
      ``,
      ...(toolCallsWithResults.length > 0
        ? [
            `**Tool calls and their results** (${toolCallsWithResults.length} calls; results truncated to ${MAX_PER_RESULT} chars each, ${MAX_TOTAL_RESULTS} chars total):`,
            ...toolCallsWithResults,
            ``,
          ]
        : [`**No tools were invoked**`, ``]),
      ...(consultedSkillsList.length > 0
        ? [
            `**Skills consulted during execution**: ${consultedSkillsList.join(', ')}`,
            ``,
          ]
        : [
            `**No skills were consulted** — the agent did not read any skill files from the skills/ directory.`,
            ``,
          ]),
      `**Agent's final response**:`,
      subtaskResult,
      ``,
      `Reply with ONLY a JSON object in this exact format (no markdown, no extra text):`,
      `{"verdict": "COMPLETED|INCOMPLETE", "reason": "brief explanation of why"}`,
      ``,
      `Use COMPLETED if the work was actually done. Evidence of success includes: tool results showing successful API responses (post IDs, URLs, created resource identifiers), confirmation messages in the final response, or files written. Use INCOMPLETE only if tool results show errors AND the final response does not claim success with concrete artifacts. Do NOT mark INCOMPLETE solely because a tool name is unfamiliar to you or is not in your own toolset.`,
    ].join('\n');

    this.logger.info('Submitting subtask verification to task session', {
      subtaskId: subtask.id,
      taskId: subtask.taskId,
      taskSessionId: task.sessionId,
    });

    const messageInput: SubmitMessageStreamingInput = {
      sessionId: task.sessionId,
      content: verificationPrompt,
      role: 'user',
      onStreamEvent: () => {},
    };
    if (agentId) messageInput.agentId = agentId;

    await this.subtasksRepo.setPendingVerificationResult(
      subtask.id,
      subtaskResult,
    );
    let result: SubmitMessageResult;
    try {
      result = await this.sessionService.submitMessageStreaming(messageInput);
    } finally {
      await this.subtasksRepo.setPendingVerificationResult(subtask.id, null);
    }
    if (!result.ok) {
      this.logger.warn('Verification run failed; accepting the step as is', {
        subtaskId: subtask.id,
        error: result.error.message,
      });
      return null;
    }

    const content = stripThinking(
      (result.assistantMessage as { content?: string } | undefined)?.content ??
        '',
    );
    const { isComplete, reason, rawVerdict } =
      parseVerificationVerdict(content);
    this.logger.info('Subtask verification result received', {
      subtaskId: subtask.id,
      isComplete,
      verdict: rawVerdict ?? null,
    });
    return { isComplete, reason };
  }

  // ========================================
  // Deliverable verification
  // ========================================

  /**
   * Collect all absolute paths stored in tool message metadata across all subtask sessions.
   */
  private async collectDeliverablePaths(taskId: string): Promise<string[]> {
    const paths: string[] = [];
    if (!this.sessionService) return paths;

    const subtasks = await this.subtasksRepo.listByTask(taskId);
    for (const subtask of subtasks) {
      if (!subtask.sessionId) continue;

      const messages = await this.sessionService.listMessages(
        subtask.sessionId,
      );
      for (const m of messages) {
        if (m.role !== 'tool') continue;
        const msg = m as { metadata?: Record<string, unknown> };
        if (
          msg.metadata?.absolutePath &&
          typeof msg.metadata.absolutePath === 'string'
        ) {
          paths.push(msg.metadata.absolutePath);
        }
      }
    }
    return paths;
  }

  /**
   * Verify deliverables for a task by checking stored absolute paths from tool execution.
   * This is more reliable than asking an LLM to verify since we have the actual paths.
   */
  private async verifyDeliverables(taskId: string): Promise<void> {
    if (!this.deliverablesRepo) {
      this.logger.warn(
        'Cannot verify deliverables: deliverablesRepo not configured',
        { taskId },
      );
      return;
    }

    const task = await this.tasksRepo.findById(taskId);
    if (!task) return;

    const deliverables = await this.deliverablesRepo.findByTask(taskId);
    if (deliverables.length === 0) {
      this.logger.info('No deliverables found for task', { taskId });
      return;
    }

    const deliverable = deliverables[0]!;

    // Collect all paths from tool executions
    const absolutePaths = await this.collectDeliverablePaths(taskId);
    this.logger.info('Collected absolute paths from tool executions', {
      taskId,
      pathCount: absolutePaths.length,
      paths: absolutePaths,
    });

    if (absolutePaths.length > 0) {
      // Use the first path as the deliverable path
      const deliverablePath = absolutePaths[0]!;
      this.logger.info('Deliverable found at path', {
        taskId,
        deliverableId: deliverable.id,
        path: deliverablePath,
      });

      // Determine if it's a URL or file path
      const updateInput: Parameters<typeof this.deliverablesRepo.update>[1] = {
        status: 'delivered',
      };

      if (
        deliverablePath.startsWith('http://') ||
        deliverablePath.startsWith('https://')
      ) {
        updateInput.url = deliverablePath;
      } else {
        updateInput.path = deliverablePath;
      }

      await this.deliverablesRepo.update(deliverable.id, updateInput);
      this.logger.info('Deliverable marked as delivered', {
        taskId,
        deliverableId: deliverable.id,
        path: updateInput.path,
        url: updateInput.url,
      });
    } else {
      // No paths found - deliverable not created
      this.logger.info('No deliverable paths found, keeping as pending', {
        taskId,
        deliverableId: deliverable.id,
      });
    }
  }
}

/**
 * Heuristic guard against false-INCOMPLETE verification verdicts.
 *
 * Returns true when the executor's final response simultaneously:
 *   - claims success (published/posted/created/successfully/completed/done…), AND
 *   - references a concrete artifact: a long hex ID (e.g. Buffer post IDs
 *     like "6a35942d9513262b4d256b1f") or an http(s):// URL.
 *
 * When this returns true, {@link TaskExecution.handleVerificationResult}
 * overrides an INCOMPLETE verdict and completes the subtask instead of
 * re-running it, which would repeat side effects (duplicate tweets, etc.).
 */
function hasConcreteArtifacts(text: string): boolean {
  if (!text) return false;
  const successPattern =
    /\b(publish(?:ed)?|post(?:ed)?|creat(?:ed|ing)?|sent|updat(?:ed|ing)?|success(?:fully)?|complet(?:ed|ing)?|done|deliver(?:ed|ing)?)\b/i;
  if (!successPattern.test(text)) return false;
  const longHexId = /\b[a-f0-9]{20,}\b/i;
  const url = /https?:\/\/\S+/i;
  return longHexId.test(text) || url.test(text);
}

function notFound(subtaskId: string): {
  ok: false;
  error: { code: string; message: string };
} {
  return {
    ok: false,
    error: {
      code: 'subtask.not_found',
      message: `Subtask "${subtaskId}" not found`,
    },
  };
}

function notAwaiting(subtaskId: string): {
  ok: false;
  error: { code: string; message: string };
} {
  return {
    ok: false,
    error: {
      code: 'subtask.not_awaiting_approval',
      message: `Subtask "${subtaskId}" is not awaiting approval`,
    },
  };
}

/** Snapshot of how each step ended, kept on the finished run. */
export function buildRunSummary(subtasks: Subtask[]): ExecutionSubtaskSummary {
  return {
    total: subtasks.length,
    completed: subtasks.filter((s) => s.status === 'completed').length,
    failed: subtasks.filter((s) => s.status === 'failed').length,
    skipped: subtasks.filter((s) => s.status === 'skipped').length,
    inProgress: subtasks.filter((s) => s.status === 'in_progress').length,
    pending: subtasks.filter(
      (s) => s.status === 'pending' || s.status === 'assigned',
    ).length,
    items: subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      sessionId: s.sessionId ?? null,
      result: s.result ? s.result.slice(0, SUMMARY_RESULT_MAX_CHARS) : null,
    })),
  };
}
