import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import { formatToolError, requireService, requireString } from '../shared.js';
import { workflowExecuteMeta } from '../catalog.js';
import { assertWorkflow } from './assert-workflow.js';

/**
 * workflow_execute
 *
 * Starts a workflow run. Two modes:
 *
 * - Default: a new run of the whole workflow (every node reset), the
 *   same as the Run button. Backed by `TaskService.startRun`.
 *
 * - subtaskId provided: starts one ready node of the current run.
 *   Backed by `TaskService.executeSubtask`.
 *
 * Both return as soon as the work has started; nodes run in the
 * background.
 */
export function createWorkflowExecuteTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowExecuteMeta.name,
    description: workflowExecuteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'ID of the workflow to execute.',
        },
        subtaskId: {
          type: 'string',
          description:
            'Optional ID of a specific node to execute. If omitted, the ' +
            'workflow starts from all ready-to-execute entry nodes.',
        },
        input: {
          type: 'string',
          description:
            'Optional text the run should work on, e.g. the details the ' +
            'user just gave you. Every step sees it as the workflow input.',
        },
      },
      required: ['workflowId'],
    },

    async execute(args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      const taskService = resolved.service;

      const idError = requireString(args['workflowId'], 'workflowId');
      if (idError) return { ok: false, error: idError };
      const workflowId = args['workflowId'] as string;

      const subtaskId = args['subtaskId'];
      const subtaskIdError =
        subtaskId === undefined ? null : requireString(subtaskId, 'subtaskId');
      if (subtaskIdError) return { ok: false, error: subtaskIdError };

      try {
        const existing = await taskService.getTask(workflowId);
        if (!existing) {
          return {
            ok: false,
            error: `Workflow "${workflowId}" not found`,
          };
        }
        const workflowCheck = assertWorkflow(existing);
        if (!workflowCheck.ok) return workflowCheck;

        if (typeof subtaskId === 'string' && subtaskId) {
          const node = await taskService.getSubtask(subtaskId);
          if (!node || node.taskId !== workflowId) {
            return {
              ok: false,
              error: `Node "${subtaskId}" is not part of workflow "${workflowId}"`,
            };
          }
          const result = await taskService.executeSubtask(subtaskId);
          if (!result.ok) {
            return { ok: false, error: result.error.message };
          }
          const sessionInfo = result.data.sessionId
            ? `Session: ${result.data.sessionId}`
            : 'Session: (none started)';
          return {
            ok: true,
            content: `Workflow node "${subtaskId}" execution started.\n\n${sessionInfo}`,
          };
        }

        const input = args['input'];
        const result = await taskService.startRun(workflowId, {
          trigger: 'agent',
          ...(typeof input === 'string' && input.trim() ? { input } : {}),
        });
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }
        return {
          ok: true,
          content: `Workflow "${workflowId}" run started.\n\nRun: ${result.data.runId}\nNodes run in the background; use workflow_get to check their status.`,
        };
      } catch (err) {
        return formatToolError('Unexpected error executing workflow', err);
      }
    },
  };
}
