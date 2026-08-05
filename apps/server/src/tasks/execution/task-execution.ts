import type {
  TasksRepository,
  SubtasksRepository,
  TaskAgentsRepository,
  DeliverablesRepository,
  TaskExecutionHistoryRepository,
  Subtask,
  SessionMessage,
} from '@openaidy/db';
import type { AgentRegistry } from '../../agents';
import type { SessionMessageService } from '../../sessions/service';
import type { SubmitMessageStreamingInput } from '../../sessions/types';
import type { RunEventEmitter } from '../../dispatch/events';
import type {
  SessionType,
  ExecutionSubtaskSummary,
} from '@openaidy/shared-types';
import { createLogger } from '../../lib/logger';
import { stripThinking } from '../../lib/message.js';
import {
  createContextBudget,
  truncateWithBudget,
} from '../../lib/context-budget';
import type { SessionMessageRecord, ServiceResult } from '../../types';
import {
  isSubtaskExecutable,
  getDependencySubtasks,
  evaluateCondition,
  subtaskNeedsOutcomeTag,
  type SubtaskDependencyEdge,
  type ConditionOperator,
} from './subtask-graph';

const MAX_RETRIES = 5;
const STUCK_TIMEOUT_MINUTES = 3;
// Bounds on how much of a completed dependency's result is carried into
// a dependent subtask's opening message, so a large upstream result
// can't unboundedly grow the next subtask's context window.
const DEP_CONTEXT_PER_ITEM_CHARS = 2000;
const DEP_CONTEXT_TOTAL_CHARS = 8000;

export class TaskExecution {
  private readonly logger: ReturnType<typeof createLogger>;
  private unsubscribeRunEvents: (() => void) | undefined;

  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly subtasksRepo: SubtasksRepository,
    private readonly taskAgentsRepo: TaskAgentsRepository,
    private readonly deliverablesRepo: DeliverablesRepository | undefined,
    private readonly agents: AgentRegistry | undefined,
    private readonly sessionService: SessionMessageService | undefined,
    private readonly runEvents: RunEventEmitter | undefined,
    private readonly workspaceBaseDir: string | undefined,
    private readonly taskExecutionHistoryRepo:
      | TaskExecutionHistoryRepository
      | undefined,
  ) {
    this.logger = createLogger('TaskExecution');

    if (this.runEvents) {
      this.unsubscribeRunEvents = this.runEvents.subscribeAll((event) => {
        void this.handleRunEvent(event);
      });
    }
  }

  destroy(): void {
    if (this.unsubscribeRunEvents) {
      this.unsubscribeRunEvents();
      this.unsubscribeRunEvents = void 0;
    }
  }

  // ========================================
  // Run event handler
  // ========================================

  private async handleRunEvent(
    event: import('../../dispatch/events').RunEvent,
  ): Promise<void> {
    if (event.type !== 'run.completed' && event.type !== 'run.failed') return;

    // Check for pending verification on a task session
    const task = await this.tasksRepo.findBySessionId?.(event.sessionId);
    if (task) {
      const subtasks = await this.subtasksRepo.listByTask(task.id);
      const pendingSubtask = subtasks.find(
        (s) =>
          s.pendingVerificationResult !== null &&
          s.pendingVerificationResult !== undefined,
      );
      if (pendingSubtask) {
        await this.subtasksRepo.setPendingVerificationResult(
          pendingSubtask.id,
          null,
        );
        if (event.type === 'run.completed') {
          await this.handleVerificationResult(
            pendingSubtask.id,
            pendingSubtask.pendingVerificationResult!,
            event.sessionId,
          );
        } else {
          this.logger.warn(
            'Verification run failed, auto-completing subtask as fallback',
            {
              subtaskId: pendingSubtask.id,
            },
          );
          await this.completeSubtask(
            pendingSubtask.id,
            pendingSubtask.pendingVerificationResult!,
            event.sessionId,
          );
        }
        return;
      }
    }

    this.logger.info('Handling run event', {
      type: event.type,
      sessionId: event.sessionId,
      runId: event.runId,
    });

    try {
      const sessionRecord = await this.sessionService?.getSession(
        event.sessionId,
      );
      const sessionType =
        sessionRecord && 'type' in sessionRecord
          ? (sessionRecord as { type?: SessionType }).type
          : null;

      if (sessionType !== 'task' && sessionType !== 'subtask') {
        this.logger.debug('Skipping subtask lookup for regular chat session', {
          sessionId: event.sessionId,
          sessionType: sessionType ?? 'unknown',
        });
        return;
      }

      const linkedSubtask = await this.subtasksRepo.findBySessionId(
        event.sessionId,
      );
      if (!linkedSubtask) {
        this.logger.warn('No subtask found linked to session', {
          sessionId: event.sessionId,
        });
        return;
      }

      this.logger.info('Found linked subtask', {
        subtaskId: linkedSubtask.id,
        taskId: linkedSubtask.taskId,
        currentStatus: linkedSubtask.status,
      });

      if (
        linkedSubtask.status === 'completed' ||
        linkedSubtask.status === 'failed'
      ) {
        this.logger.debug('Subtask already in terminal state, skipping', {
          subtaskId: linkedSubtask.id,
          status: linkedSubtask.status,
        });
        return;
      }

      if (event.type === 'run.completed') {
        const sessionMessages = await this.sessionService?.listMessages(
          event.sessionId,
        );
        const lastAssistantMessage = sessionMessages
          ?.slice()
          .reverse()
          .find((m) => m.role === 'assistant');
        const result = stripThinking(
          lastAssistantMessage?.content ?? 'Completed',
        );

        console.log(
          '[TaskExecution] Subtask run completed, sending to verification',
          {
            subtaskId: linkedSubtask.id,
            subtaskTitle: linkedSubtask.title,
            lastMessagePreview: result.substring(0, 300),
          },
        );

        const updatedSubtask = await this.subtasksRepo.incrementRetryCount(
          linkedSubtask.id,
        );
        const retryCount = updatedSubtask?.retryCount ?? 0;

        if (retryCount >= MAX_RETRIES) {
          this.logger.warn('Max retries exceeded, marking subtask as failed', {
            subtaskId: linkedSubtask.id,
            retryCount,
          });
          await this.failSubtask(
            linkedSubtask.id,
            `Failed after ${MAX_RETRIES} attempts. Last message: ${result.substring(0, 200)}`,
          );
        } else {
          const verified = await this.submitVerificationToTaskSession(
            linkedSubtask,
            result,
            sessionMessages,
          );
          if (!verified) {
            this.logger.info(
              'No task session for verification, auto-completing subtask',
              {
                subtaskId: linkedSubtask.id,
                sessionId: event.sessionId,
              },
            );
            await this.completeSubtask(linkedSubtask.id, result);
          }
        }
      } else if (event.type === 'run.failed') {
        this.logger.info('Auto-failing subtask after session run failed', {
          subtaskId: linkedSubtask.id,
          sessionId: event.sessionId,
        });
        const errorMessage =
          (event.data.errorMessage as string | undefined) ?? 'Run failed';
        await this.failSubtask(linkedSubtask.id, errorMessage);
      }
    } catch (err) {
      this.logger.error('Failed to handle run event for subtask', {
        error: err instanceof Error ? err.message : String(err),
        sessionId: event.sessionId,
        runId: event.runId,
      });
    }
  }

  // ========================================
  // Execution
  // ========================================

  async executeTask(
    taskId: string,
    options: { sessionId?: string } = {},
  ): Promise<ServiceResult<{ sessionId: string }>> {
    if (!this.sessionService) {
      return {
        ok: false,
        error: {
          code: 'session.not_configured',
          message: 'Session service is not configured',
        },
      };
    }

    const task = await this.tasksRepo.findById(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    // Reuse the existing session when the caller (e.g. the
    // recurring-task executor) has already created one and just needs
    // us to dispatch the work. Without this, every recurring run
    // would create a second "Task: <title>" session on top of the
    // "Task: <title> (run #N)" session the executor created.
    let session: { id: string };
    if (options.sessionId) {
      session = { id: options.sessionId };
    } else {
      session = await this.sessionService.createSession(
        `Task: ${task.title}`,
        'task',
      );
    }
    await this.tasksRepo.update(taskId, { sessionId: session.id });
    await this.tasksRepo.updateStatus(taskId, 'in_progress');
    this.logger.info('Task moved to in_progress', { taskId });

    const subtasks = await this.subtasksRepo.listByTask(taskId);
    if (subtasks.length > 0) {
      this.logger.info('Task has subtasks, executing subtasks', {
        taskId,
        subtaskCount: subtasks.length,
      });
      // Only pass the session down to subtasks if the caller (e.g. the
      // recurring-task executor) already created one. For normal API
      // calls, each subtask should create its own session.
      const executeSubtasksOptions = options.sessionId
        ? { sessionId: options.sessionId }
        : {};
      const result = await this.executeSubtasks(taskId, executeSubtasksOptions);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, data: { sessionId: session.id } };
    }

    const executionResult = await this.sessionService.submitMessageStreaming({
      sessionId: session.id,
      content: task.description,
      role: 'user',
      onStreamEvent: () => {},
    });

    if (!executionResult.ok) {
      this.logger.warn(
        'Task execution failed while submitting initial message',
        {
          taskId,
          sessionId: session.id,
          errorCode: executionResult.error.code,
        },
      );
      return { ok: false, error: executionResult.error };
    }

    await this.tasksRepo.updateStatus(taskId, 'review');
    this.logger.info('Task moved to review', { taskId, reason: 'no_subtasks' });

    return { ok: true, data: { sessionId: session.id } };
  }

  async executeSubtask(
    subtaskId: string,
    options: {
      sessionId?: string;
      // Lets executeSubtasks() pass the task's subtasks/edges it already
      // fetched for the batch, instead of this method re-fetching the
      // same data per subtask.
      preloadedGraph?: {
        allSubtasks: Subtask[];
        edges: SubtaskDependencyEdge[];
      };
    } = {},
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
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    if (subtask.status === 'in_progress' || subtask.status === 'completed') {
      this.logger.info('Subtask already executed, skipping', {
        subtaskId,
        status: subtask.status,
      });
      return {
        ok: false,
        error: {
          code: 'subtask.already_executed',
          message: `Subtask "${subtaskId}" is already ${subtask.status}`,
        },
      };
    }

    const allSubtasks =
      options.preloadedGraph?.allSubtasks ??
      (await this.subtasksRepo.listByTask(subtask.taskId));
    const edges =
      options.preloadedGraph?.edges ??
      (await this.subtasksRepo.listEdgesByTask(subtask.taskId));

    if (!isSubtaskExecutable(subtask, allSubtasks, edges)) {
      return {
        ok: false,
        error: {
          code: 'subtask.dependency_not_met',
          message: 'One or more dependencies not completed',
        },
      };
    }

    // Approval gates pause execution for a human decision instead of
    // running an agent. No session is created and submitMessageStreaming
    // is never called, so this subtask stays completely outside the
    // RunEvent/session-correlation machinery — resolveApproval() is the
    // only thing that moves it forward.
    if (subtask.subtaskKind === 'approval_gate') {
      await this.subtasksRepo.updateStatus(subtaskId, 'in_progress');
      await this.subtasksRepo.setAwaitingApproval(subtaskId, true);
      this.logger.info('Approval gate paused, awaiting human decision', {
        subtaskId,
      });
      return { ok: true, data: { sessionId: null } };
    }

    // Reuse the existing session if the caller (e.g. the recurring-task
    // executor) already created one. Otherwise create a per-subtask
    // session like before.
    let session: { id: string };
    if (options.sessionId) {
      session = { id: options.sessionId };
    } else {
      session = await this.sessionService.createSession(
        `Subtask: ${subtask.title}`,
        'subtask',
      );
    }
    this.logger.info(
      options.sessionId
        ? 'Reusing session for subtask (called by recurring executor)'
        : 'Created session for subtask',
      {
        subtaskId,
        sessionId: session.id,
      },
    );

    await this.subtasksRepo.update(subtaskId, { sessionId: session.id });
    await this.subtasksRepo.updateStatus(subtaskId, 'in_progress');

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
      const depBudget = createContextBudget(DEP_CONTEXT_TOTAL_CHARS);
      const contextParts: string[] = [];
      for (const dep of completedDeps) {
        if (depBudget.remaining <= 0) break;
        const truncatedResult = truncateWithBudget(
          dep.result!,
          DEP_CONTEXT_PER_ITEM_CHARS,
          depBudget,
        );
        contextParts.push(`## Result from "${dep.title}":\n${truncatedResult}`);
      }
      messageContent = `${subtask.description}\n\n---\n\n**Context from completed dependencies:**\n\n${contextParts.join('\n\n')}`;
      this.logger.info('Including context from completed dependencies', {
        subtaskId,
        depCount: contextParts.length,
      });
    }

    // Loop iteration context: on iterations after the first, prepend the
    // previous attempt's result so the agent can build on (or fix) it.
    if (
      subtask.loopMaxIterations != null &&
      subtask.loopIterationCount > 0 &&
      subtask.loopLastResult
    ) {
      const loopBudget = createContextBudget(DEP_CONTEXT_PER_ITEM_CHARS);
      const truncatedPrevious = truncateWithBudget(
        subtask.loopLastResult,
        DEP_CONTEXT_PER_ITEM_CHARS,
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
      messageContent = `${messageContent}\n\n---\n\nEnd your final message with a line "OUTCOME: <short-tag>" summarizing the outcome in a few words (e.g. "OUTCOME: approved" or "OUTCOME: needs-revision"). This is used to decide what happens next.`;
    }

    const agentId = (subtask as { assignedAgentId?: string }).assignedAgentId;
    this.logger.info('Submitting message to session', {
      subtaskId,
      sessionId: session.id,
      agentId,
    });

    const messageInput: SubmitMessageStreamingInput = {
      sessionId: session.id,
      content: messageContent,
      role: 'user',
      onStreamEvent: () => {},
    };
    if (agentId !== undefined) messageInput.agentId = agentId;

    await this.sessionService.submitMessageStreaming(messageInput);
    return { ok: true, data: { sessionId: session.id } };
  }

  async executeSubtasks(
    taskId: string,
    options: { sessionId?: string } = {},
  ): Promise<ServiceResult<{ startedCount: number }>> {
    const task = await this.tasksRepo.findById(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }

    const subtasks = await this.subtasksRepo.listByTask(taskId);
    const edges = await this.subtasksRepo.listEdgesByTask(taskId);
    const executable = subtasks
      .filter((s) => s.status === 'pending')
      .filter((subtask) => isSubtaskExecutable(subtask, subtasks, edges));

    // Executable subtasks already have every dependency in a terminal
    // `completed` state as of this snapshot, and a dependency's status
    // and result never change once completed — so it's safe to reuse
    // this same snapshot for every subtask in the batch instead of each
    // executeSubtask() call re-fetching it.
    const preloadedGraph = { allSubtasks: subtasks, edges };

    let startedCount = 0;
    for (const subtask of executable) {
      const result = await this.executeSubtask(subtask.id, {
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        preloadedGraph,
      });
      if (result.ok) startedCount++;
    }

    return { ok: true, data: { startedCount } };
  }

  async triggerSubtaskRetry(
    subtaskId: string,
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
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    const sessionId = subtask.sessionId;
    if (!sessionId) {
      return {
        ok: false,
        error: {
          code: 'subtask.no_session',
          message: `Subtask "${subtaskId}" has no linked session`,
        },
      };
    }

    const agentId = (subtask as { assignedAgentId?: string }).assignedAgentId;
    this.logger.info('Triggering retry for stuck subtask', {
      subtaskId,
      sessionId,
      agentId,
    });

    const messageInput: SubmitMessageStreamingInput = {
      sessionId,
      content:
        'Please continue and complete this subtask. Focus on delivering the actual output requested. Do not ask what to do — execute the task directly.',
      role: 'user',
      onStreamEvent: () => {},
    };
    if (agentId !== undefined) messageInput.agentId = agentId;

    await this.sessionService.submitMessageStreaming(messageInput);
    return { ok: true, data: { sessionId } };
  }

  // ========================================
  // Completion lifecycle
  // ========================================

  async completeSubtask(
    subtaskId: string,
    result: string,
    taskSessionId?: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }

    // Bounded self-loop: this subtask keeps re-running itself until its
    // own result satisfies loopConditionOperator/loopConditionValue, or
    // the iteration cap is hit (then it fails instead of completing).
    // retryCount/MAX_RETRIES is a separate concept (run-failure
    // recovery) and is untouched by this branch.
    if (subtask.loopMaxIterations != null) {
      const converged = evaluateCondition(result, {
        operator: (subtask.loopConditionOperator ??
          'contains') as ConditionOperator,
        value: subtask.loopConditionValue ?? '',
      });
      if (!converged) {
        const nextIteration = subtask.loopIterationCount + 1;
        if (nextIteration >= subtask.loopMaxIterations) {
          this.logger.warn(
            'Loop exceeded max iterations without satisfying its condition',
            { subtaskId, loopMaxIterations: subtask.loopMaxIterations },
          );
          return this.failSubtask(
            subtaskId,
            `Loop exceeded ${subtask.loopMaxIterations} iterations without satisfying its condition. Last result: ${result.slice(0, 200)}`,
          );
        }
        await this.subtasksRepo.recordLoopIteration(subtaskId, { result });
        this.logger.info('Loop condition not met, re-running subtask', {
          subtaskId,
          iteration: nextIteration,
          maxIterations: subtask.loopMaxIterations,
        });
        // Same cascade normal completion triggers below — picks this
        // subtask (now back to 'pending') straight back up.
        await this.executeSubtasks(subtask.taskId);
        const reloaded = await this.subtasksRepo.findById(subtaskId);
        return { ok: true, data: reloaded! };
      }
      // Condition holds — fall through to normal completion below.
    }

    const updated = await this.subtasksRepo.completeSubtask(subtaskId, result);

    this.logger.info('Subtask completed, checking for dependent subtasks', {
      subtaskId,
      taskId: subtask.taskId,
    });

    await this.checkTaskCompletion(subtask.taskId, taskSessionId);

    const executeResult = await this.executeSubtasks(subtask.taskId);
    if (executeResult.ok && executeResult.data.startedCount > 0) {
      this.logger.info('Started dependent subtasks after completion', {
        subtaskId,
        taskId: subtask.taskId,
        startedCount: executeResult.data.startedCount,
      });
    }

    return { ok: true, data: updated! };
  }

  /**
   * Resolve a paused approval-gate subtask with a human decision.
   * Deliberately outside handleRunEvent/session correlation — an
   * approval gate never created a session or LLM run, so there's
   * nothing for a RunEvent to correlate back to here.
   */
  async resolveApproval(
    subtaskId: string,
    decision: 'approved' | 'rejected',
    note?: string,
    approvedBy?: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }
    if (subtask.subtaskKind !== 'approval_gate') {
      return {
        ok: false,
        error: {
          code: 'subtask.not_approval_gate',
          message: `Subtask "${subtaskId}" is not an approval gate`,
        },
      };
    }
    if (subtask.awaitingApprovalSince == null) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_awaiting_approval',
          message: `Subtask "${subtaskId}" is not awaiting approval`,
        },
      };
    }

    await this.subtasksRepo.resolveApproval(subtaskId, {
      decision,
      note: note ?? null,
      approvedBy: approvedBy ?? null,
    });

    return decision === 'approved'
      ? this.completeSubtask(subtaskId, note ?? 'Approved')
      : this.failSubtask(subtaskId, `Rejected${note ? `: ${note}` : ''}`);
  }

  async failSubtask(
    subtaskId: string,
    error: string,
  ): Promise<ServiceResult<Subtask>> {
    const subtask = await this.subtasksRepo.findById(subtaskId);
    if (!subtask) {
      return {
        ok: false,
        error: {
          code: 'subtask.not_found',
          message: `Subtask "${subtaskId}" not found`,
        },
      };
    }
    const updated = await this.subtasksRepo.failSubtask(subtaskId, error);
    return { ok: true, data: updated! };
  }

  async checkStuckSubtasks(): Promise<void> {
    const allSubtasks = await this.subtasksRepo.listAll();
    // Approval gates are supposed to sit in_progress indefinitely while
    // awaiting a human decision — that's not "stuck".
    const inProgress = allSubtasks.filter(
      (s) => s.status === 'in_progress' && s.awaitingApprovalSince == null,
    );

    if (inProgress.length === 0) return;

    this.logger.info('Checking for stuck subtasks', {
      count: inProgress.length,
    });

    const now = new Date();
    for (const subtask of inProgress) {
      const updatedAt = subtask.updatedAt ? new Date(subtask.updatedAt) : null;
      if (!updatedAt) continue;

      const minutesSinceUpdate =
        (now.getTime() - updatedAt.getTime()) / (1000 * 60);
      if (minutesSinceUpdate < STUCK_TIMEOUT_MINUTES) continue;

      const retryCount = (subtask as { retryCount?: number }).retryCount ?? 0;

      if (retryCount >= MAX_RETRIES) {
        this.logger.warn('Subtask exceeded max retries, marking as failed', {
          subtaskId: subtask.id,
          retryCount,
        });
        await this.subtasksRepo.updateStatus(subtask.id, 'failed');
        continue;
      }

      this.logger.info('Auto-retrying stuck subtask', {
        subtaskId: subtask.id,
        retryCount,
        minutesStuck: Math.round(minutesSinceUpdate),
      });

      await this.subtasksRepo.incrementRetryCount(subtask.id);
      const result = await this.triggerSubtaskRetry(subtask.id);

      if (!result.ok) {
        this.logger.error('Auto-retry failed for stuck subtask', {
          subtaskId: subtask.id,
          error: result.error,
        });
      }
    }
  }

  // ========================================
  // Verification
  // ========================================

  private async submitVerificationToTaskSession(
    subtask: Subtask,
    subtaskResult: string,
    sessionMessages?: (SessionMessage | SessionMessageRecord)[],
  ): Promise<boolean> {
    if (!this.sessionService) return false;

    const task = await this.tasksRepo.findById(subtask.taskId);
    if (!task?.sessionId) {
      this.logger.warn('No task session found for subtask verification', {
        subtaskId: subtask.id,
        taskId: subtask.taskId,
      });
      return false;
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
    await this.sessionService.submitMessageStreaming(messageInput);
    return true;
  }

  private async handleVerificationResult(
    subtaskId: string,
    originalResult: string,
    verificationSessionId: string,
  ): Promise<void> {
    const messages = await this.sessionService?.listMessages(
      verificationSessionId,
    );
    const lastMsg = messages
      ?.slice()
      .reverse()
      .find((m) => (m as { role: string }).role === 'assistant');
    const rawContent = (lastMsg as { content?: string })?.content ?? '';
    const content = stripThinking(rawContent);

    let isComplete = false;
    let parsedVerdict: { verdict?: string; reason?: string } = {};

    try {
      const jsonMatch = content.match(/\{[^}]+\}/);
      if (jsonMatch) {
        parsedVerdict = JSON.parse(jsonMatch[0]);
        isComplete = parsedVerdict.verdict?.toUpperCase() === 'COMPLETED';
      } else {
        isComplete =
          /\bCOMPLETED\b/i.test(content) && !/\bINCOMPLETE\b/i.test(content);
      }
    } catch (_e) {
      isComplete =
        /\bCOMPLETED\b/i.test(content) && !/\bINCOMPLETE\b/i.test(content);
    }

    this.logger.info('Subtask verification result received', {
      subtaskId,
      isComplete,
      verdict: parsedVerdict,
      verificationSummary: content,
    });

    if (isComplete) {
      await this.completeSubtask(
        subtaskId,
        originalResult,
        verificationSessionId,
      );
    } else {
      // Guard against false-INCOMPLETE verdicts: a verifier LLM can
      // wrongly mark work as incomplete (e.g. because a tool name is
      // not in its own toolset). Re-running the subtask would repeat
      // side effects (duplicate tweets, duplicate API posts, …). If
      // the executor's final response already reports success with
      // concrete artifacts (IDs, URLs), override the verdict and
      // complete the subtask instead of retrying.
      if (hasConcreteArtifacts(originalResult)) {
        this.logger.warn(
          'Verifier said INCOMPLETE but executor response contains concrete success artifacts; overriding to COMPLETED to avoid duplicate side effects',
          { subtaskId, verdict: parsedVerdict },
        );
        await this.completeSubtask(
          subtaskId,
          originalResult,
          verificationSessionId,
        );
      } else {
        this.logger.info('Verification says incomplete, triggering retry', {
          subtaskId,
        });
        await this.triggerSubtaskRetry(subtaskId);
      }
    }
  }

  // ========================================
  // Internal helpers
  // ========================================

  private async checkTaskCompletion(
    taskId: string,
    taskSessionId?: string,
  ): Promise<void> {
    const subtasks = await this.subtasksRepo.listByTask(taskId);
    const allComplete =
      subtasks.length > 0 && subtasks.every((s) => s.status === 'completed');

    // Snapshot subtask statuses into the execution history row when
    // all subtasks have reached a terminal state (completed or failed).
    // Because subtasks are reset between recurring runs, without this
    // snapshot historical runs would have no subtask data in the UI.
    const allTerminal =
      subtasks.length > 0 &&
      subtasks.every((s) => s.status === 'completed' || s.status === 'failed');
    if (allTerminal) {
      await this.snapshotSubtaskSummary(taskId, subtasks, taskSessionId);
    }

    if (allComplete) {
      await this.tasksRepo.updateStatus(taskId, 'review');
      this.logger.info('Task moved to review', {
        taskId,
        status: 'review',
        reason: 'all_subtasks_completed',
      });

      // Trigger deliverable verification when all subtasks are complete
      await this.verifyDeliverables(taskId);
    }
  }

  /**
   * Write a JSON snapshot of the current subtask statuses into the
   * `task_execution_history` row for the task's current run.
   *
   * The history row is found by its `sessionId`. The caller MUST pass
   * `taskSessionId` from the verification flow — the task session that
   * performed the verification. This is critical for recurring tasks:
   * the next run's executor can change `task.sessionId` BEFORE the
   * current run's last verification completes, which would cause the
   * snapshot to be written to the wrong history row (or lost entirely).
   * When `taskSessionId` is unavailable (e.g. the fallback auto-complete
   * path with no task session), we fall back to `task.sessionId`.
   */
  private async snapshotSubtaskSummary(
    taskId: string,
    subtasks: Subtask[],
    taskSessionId?: string,
  ): Promise<void> {
    if (!this.taskExecutionHistoryRepo) return;

    const sessionId =
      taskSessionId ?? (await this.tasksRepo.findById(taskId))?.sessionId;
    if (!sessionId) return;

    const history =
      await this.taskExecutionHistoryRepo.findBySessionId(sessionId);
    if (!history) return;

    const summary: ExecutionSubtaskSummary = {
      total: subtasks.length,
      completed: subtasks.filter((s) => s.status === 'completed').length,
      failed: subtasks.filter((s) => s.status === 'failed').length,
      inProgress: subtasks.filter((s) => s.status === 'in_progress').length,
      pending: subtasks.filter(
        (s) => s.status === 'pending' || s.status === 'assigned',
      ).length,
      items: subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        sessionId: s.sessionId ?? null,
      })),
    };

    await this.taskExecutionHistoryRepo.update(history.id, {
      subtaskSummary: JSON.stringify(summary),
    });
    this.logger.info('Subtask summary snapshotted to history row', {
      taskId,
      historyId: history.id,
      total: summary.total,
      completed: summary.completed,
      failed: summary.failed,
    });
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
