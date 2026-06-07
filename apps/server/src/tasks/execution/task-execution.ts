import type {
  TasksRepository,
  SubtasksRepository,
  TaskAgentsRepository,
  DeliverablesRepository,
  Subtask,
  SessionMessage,
} from '@openaidy/db';
import type { AgentRegistry } from '../../agents';
import type { SessionMessageService } from '../../sessions/service';
import type { SubmitMessageStreamingInput } from '../../sessions/types';
import type { RunEventEmitter } from '../../dispatch/events';
import type { SessionType } from '@openaidy/shared-types';
import { createLogger } from '../../lib/logger';
import { stripThinking } from '../../lib/message.js';
import type { SessionMessageRecord, ServiceResult } from '../../types';

const MAX_RETRIES = 5;
const STUCK_TIMEOUT_MINUTES = 3;

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
      // Pass the session down so subtasks also reuse it instead of
      // creating "Subtask: <title>" sessions.
      const result = await this.executeSubtasks(taskId, {
        sessionId: session.id,
      });
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

    if (subtask.parentSubtaskId) {
      const parent = await this.subtasksRepo.findById(subtask.parentSubtaskId);
      if (parent?.status !== 'completed') {
        return {
          ok: false,
          error: {
            code: 'subtask.dependency_not_met',
            message: 'Parent subtask not completed',
          },
        };
      }
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

    const allSubtasks = await this.subtasksRepo.listByTask(subtask.taskId);
    const completedDeps = allSubtasks.filter(
      (s) => s.status === 'completed' && s.result,
    );

    let messageContent = subtask.description;
    if (completedDeps.length > 0) {
      const contextParts = completedDeps.map(
        (dep) => `## Result from "${dep.title}":\n${dep.result}`,
      );
      messageContent = `${subtask.description}\n\n---\n\n**Context from completed work:**\n\n${contextParts.join('\n\n')}`;
      this.logger.info('Including context from completed dependencies', {
        subtaskId,
        depCount: completedDeps.length,
      });
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
    const executable = subtasks
      .filter((s) => s.status === 'pending')
      .filter((subtask) => {
        if (!subtask.parentSubtaskId) return true;
        const parent = subtasks.find((s) => s.id === subtask.parentSubtaskId);
        return parent?.status === 'completed';
      });

    let startedCount = 0;
    for (const subtask of executable) {
      const result = options.sessionId
        ? await this.executeSubtask(subtask.id, {
            sessionId: options.sessionId,
          })
        : await this.executeSubtask(subtask.id);
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

    const updated = await this.subtasksRepo.completeSubtask(subtaskId, result);

    this.logger.info('Subtask completed, checking for dependent subtasks', {
      subtaskId,
      taskId: subtask.taskId,
    });

    await this.checkTaskCompletion(subtask.taskId);

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
    const inProgress = allSubtasks.filter((s) => s.status === 'in_progress');

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

    const toolCallsMade: string[] = [];
    const consultedSkills = new Set<string>();

    if (sessionMessages && sessionMessages.length > 0) {
      for (const m of sessionMessages) {
        if (m.role === 'assistant') {
          const metadata = (m as { metadata?: Record<string, unknown> })
            .metadata;
          const toolCalls = metadata?.toolCalls as
            | Array<{ name: string; arguments: string }>
            | undefined;
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              toolCallsMade.push(`${tc.name}(${tc.arguments})`);
            }
          }
          // Extract consulted skills from metadata
          const skills = metadata?.consultedSkills as string[] | undefined;
          if (skills && skills.length > 0) {
            for (const skillId of skills) {
              consultedSkills.add(skillId);
            }
          }
        }
      }
    }

    const consultedSkillsList = Array.from(consultedSkills);

    const verificationPrompt = [
      `Evaluate whether this subtask was successfully completed.`,
      ``,
      `**Subtask**: ${subtask.title}`,
      `**Objective**: ${subtask.description}`,
      ``,
      ...(toolCallsMade.length > 0
        ? [
            `**Tools invoked during execution** (${toolCallsMade.length} calls):`,
            ...toolCallsMade.map((tc) => `- ${tc}`),
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
      `Use COMPLETED only if the work was actually done and tool usage confirms it. Use INCOMPLETE if the agent failed, encountered errors, or no actual work was performed.`,
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
      await this.completeSubtask(subtaskId, originalResult);
    } else {
      this.logger.info('Verification says incomplete, triggering retry', {
        subtaskId,
      });
      await this.triggerSubtaskRetry(subtaskId);
    }
  }

  // ========================================
  // Internal helpers
  // ========================================

  private async checkTaskCompletion(taskId: string): Promise<void> {
    const subtasks = await this.subtasksRepo.listByTask(taskId);
    const allComplete =
      subtasks.length > 0 && subtasks.every((s) => s.status === 'completed');

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
