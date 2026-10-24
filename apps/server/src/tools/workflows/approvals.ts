import type { BuiltinTool } from '@openaidy/runtime';
import type { TaskService } from '../../tasks/service';
import {
  formatToolError,
  optionalString,
  requireService,
  requireString,
} from '../shared.js';
import {
  workflowApprovalListMeta,
  workflowApprovalResolveMeta,
} from '../catalog.js';

/**
 * workflow_approval_list
 *
 * Approval steps waiting for a decision, across every workflow, so an
 * agent talking to the user (e.g. on WhatsApp) can tell them what is
 * waiting on them.
 */
export function createWorkflowApprovalListTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowApprovalListMeta.name,
    description: workflowApprovalListMeta.description,
    parameters: { type: 'object', properties: {} },

    async execute(_args, _ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;
      try {
        const pending = await resolved.service.listPendingApprovals();
        if (pending.length === 0) {
          return { ok: true, content: 'No approvals are waiting.' };
        }
        const lines = pending.map((s) => {
          const since = s.awaitingApprovalSince
            ? new Date(s.awaitingApprovalSince).toISOString()
            : 'unknown';
          return `- ${s.title} (step ${s.id}) in workflow "${s.taskTitle}" (${s.taskId}), waiting since ${since}${s.description ? `\n  ${s.description}` : ''}`;
        });
        return {
          ok: true,
          content: `${pending.length} approval(s) waiting:\n${lines.join('\n')}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error listing approvals', err);
      }
    },
  };
}

/**
 * workflow_approval_resolve
 *
 * Records the user's approve/reject decision on a waiting approval step
 * and lets the workflow continue. The decision is attributed to the
 * agent that relayed it.
 */
export function createWorkflowApprovalResolveTool(
  getTaskService: () => TaskService | undefined,
): BuiltinTool {
  return {
    name: workflowApprovalResolveMeta.name,
    description: workflowApprovalResolveMeta.description,
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the waiting approval step.',
        },
        decision: {
          type: 'string',
          enum: ['approved', 'rejected'],
          description: 'The decision the user gave.',
        },
        note: {
          type: 'string',
          description:
            "Optional note with the user's reasons; passed to the next steps.",
        },
      },
      required: ['nodeId', 'decision'],
    },

    async execute(args, ctx) {
      const resolved = requireService(getTaskService, 'Task service');
      if (!resolved.ok) return resolved;

      const idError = requireString(args['nodeId'], 'nodeId');
      if (idError) return { ok: false, error: idError };
      const decision = args['decision'];
      if (decision !== 'approved' && decision !== 'rejected') {
        return {
          ok: false,
          error: 'decision must be "approved" or "rejected"',
        };
      }
      const noteError = optionalString(args['note'], 'note');
      if (noteError) return { ok: false, error: noteError };
      const nodeId = args['nodeId'] as string;
      const note = args['note'] as string | undefined;

      try {
        const result = await resolved.service.resolveApproval(
          nodeId,
          decision,
          note,
          `agent:${ctx.agentId}`,
        );
        if (!result.ok) return { ok: false, error: result.error.message };
        return {
          ok: true,
          content: `Step "${result.data.title}" ${decision}. The workflow is continuing.`,
        };
      } catch (err) {
        return formatToolError('Unexpected error resolving approval', err);
      }
    },
  };
}
