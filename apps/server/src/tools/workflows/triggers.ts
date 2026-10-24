import type { BuiltinTool } from '@openaidy/runtime';
import { MESSAGE_MATCH_TYPE_VALUES } from '@openaidy/shared-types';
import type { WorkflowTriggerDto } from '@openaidy/shared-types';
import type { TaskService } from '../../tasks/service';
import type { WorkflowTriggerService } from '../../tasks/triggers/service';
import {
  formatToolError,
  optionalString,
  requireService,
  requireString,
} from '../shared.js';
import {
  workflowTriggerCreateMeta,
  workflowTriggerDeleteMeta,
  workflowTriggerListMeta,
} from '../catalog.js';
import { assertWorkflow } from './assert-workflow.js';

type Getters = {
  getTaskService: () => TaskService | undefined;
  getTriggerService: () => WorkflowTriggerService | undefined;
};

function describe(trigger: WorkflowTriggerDto): string {
  const state = trigger.enabled ? '' : ' (disabled)';
  const fired = trigger.lastFiredAt
    ? `last fired ${trigger.lastFiredAt}`
    : 'never fired';
  if (trigger.kind === 'webhook') {
    return `- ${trigger.name}${state} [${trigger.id}]: webhook POST ${trigger.webhookPath}, ${fired}`;
  }
  const c = trigger.channel!;
  const match =
    c.match.type === 'any'
      ? 'any message'
      : `${c.match.type.replace('_', ' ')} "${c.match.value ?? ''}"`;
  return `- ${trigger.name}${state} [${trigger.id}]: ${match} on channel ${c.channelId}${c.senders?.length ? ` from ${c.senders.join(', ')}` : ''}, ${c.replyWithResult ? 'replies with the result' : 'no reply'}, ${fired}`;
}

/**
 * workflow_trigger_create
 *
 * Makes a workflow start by itself: from a webhook URL, or from a matching
 * message on a channel (WhatsApp, Discord), whose result is sent back to
 * the same chat.
 */
export function createWorkflowTriggerCreateTool(g: Getters): BuiltinTool {
  return {
    name: workflowTriggerCreateMeta.name,
    description: workflowTriggerCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow to start.' },
        kind: {
          type: 'string',
          enum: ['webhook', 'channel_message'],
          description:
            '"webhook": a URL other services POST to. "channel_message": a ' +
            'message on a channel.',
        },
        name: { type: 'string', description: 'Optional label.' },
        channelId: {
          type: 'string',
          description: 'channel_message only: the channel id.',
        },
        matchType: {
          type: 'string',
          enum: [...MESSAGE_MATCH_TYPE_VALUES],
          description:
            'channel_message only: which messages start the workflow. ' +
            '"any" takes every message on the channel away from the chat ' +
            'agent, so prefer a keyword. Default "starts_with".',
        },
        matchValue: {
          type: 'string',
          description:
            'channel_message only: the word or text to look for (ignores case).',
        },
        senders: {
          type: 'array',
          items: { type: 'string' },
          description:
            'channel_message only: limit to these senders (phone numbers / user ids).',
        },
        replyWithResult: {
          type: 'boolean',
          description:
            'channel_message only: send the result back to the chat. Default true.',
        },
        ackText: {
          type: 'string',
          description:
            'channel_message only: immediate reply. Default "On it — running <workflow>."',
        },
      },
      required: ['workflowId', 'kind'],
    },

    async execute(args, _ctx) {
      const tasks = requireService(g.getTaskService, 'Task service');
      if (!tasks.ok) return tasks;
      const triggers = requireService(g.getTriggerService, 'Trigger service');
      if (!triggers.ok) return triggers;

      const idError = requireString(args['workflowId'], 'workflowId');
      if (idError) return { ok: false, error: idError };
      const nameError = optionalString(args['name'], 'name');
      if (nameError) return { ok: false, error: nameError };
      const workflowId = args['workflowId'] as string;
      const name = args['name'] as string | undefined;

      try {
        const task = await tasks.service.getTask(workflowId);
        if (!task) {
          return { ok: false, error: `Workflow "${workflowId}" not found` };
        }
        const check = assertWorkflow(task);
        if (!check.ok) return check;

        if (args['kind'] === 'webhook') {
          const result = await triggers.service.createWebhook(workflowId, name);
          if (!result.ok) return { ok: false, error: result.error.message };
          return {
            ok: true,
            content:
              `Webhook created.\n\nPOST <server URL>${result.data.trigger.webhookPath}\n` +
              `Token: ${result.data.token}\n` +
              'Send it as "Authorization: Bearer <token>" (or ?token=<token>). ' +
              'The token is shown only this once; the request body becomes the workflow input.',
          };
        }
        if (args['kind'] !== 'channel_message') {
          return {
            ok: false,
            error: 'kind must be "webhook" or "channel_message"',
          };
        }

        const channelError = requireString(args['channelId'], 'channelId');
        if (channelError) return { ok: false, error: channelError };
        const senders = Array.isArray(args['senders'])
          ? (args['senders'] as unknown[]).filter(
              (s): s is string => typeof s === 'string',
            )
          : [];
        const result = await triggers.service.createChannelTrigger(workflowId, {
          ...(name ? { name } : {}),
          config: {
            channelId: args['channelId'] as string,
            match: {
              type: (typeof args['matchType'] === 'string'
                ? args['matchType']
                : 'starts_with') as (typeof MESSAGE_MATCH_TYPE_VALUES)[number],
              ...(typeof args['matchValue'] === 'string'
                ? { value: args['matchValue'] }
                : {}),
            },
            ...(senders.length ? { senders } : {}),
            replyWithResult: args['replyWithResult'] !== false,
            ...(typeof args['ackText'] === 'string'
              ? { ackText: args['ackText'] }
              : {}),
          },
        });
        if (!result.ok) return { ok: false, error: result.error.message };
        return {
          ok: true,
          content: `Message trigger created.\n\n${describe(result.data)}`,
        };
      } catch (err) {
        return formatToolError('Unexpected error creating trigger', err);
      }
    },
  };
}

/** workflow_trigger_list — one workflow's triggers, or all of them. */
export function createWorkflowTriggerListTool(g: Getters): BuiltinTool {
  return {
    name: workflowTriggerListMeta.name,
    description: workflowTriggerListMeta.description,
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'Optional: only this workflow’s triggers.',
        },
      },
    },

    async execute(args, _ctx) {
      const triggers = requireService(g.getTriggerService, 'Trigger service');
      if (!triggers.ok) return triggers;
      const idError = optionalString(args['workflowId'], 'workflowId');
      if (idError) return { ok: false, error: idError };
      try {
        const workflowId = args['workflowId'] as string | undefined;
        let list: WorkflowTriggerDto[];
        if (workflowId) {
          const result = await triggers.service.listForTask(workflowId);
          if (!result.ok) return { ok: false, error: result.error.message };
          list = result.data;
        } else {
          list = await triggers.service.listAll();
        }
        if (list.length === 0) return { ok: true, content: 'No triggers.' };
        const lines = list.map(
          (t) =>
            `${describe(t)}${t.taskTitle ? ` → workflow "${t.taskTitle}" (${t.taskId})` : ''}`,
        );
        return { ok: true, content: lines.join('\n') };
      } catch (err) {
        return formatToolError('Unexpected error listing triggers', err);
      }
    },
  };
}

/** workflow_trigger_delete */
export function createWorkflowTriggerDeleteTool(g: Getters): BuiltinTool {
  return {
    name: workflowTriggerDeleteMeta.name,
    description: workflowTriggerDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        triggerId: { type: 'string', description: 'Trigger to delete.' },
      },
      required: ['triggerId'],
    },

    async execute(args, _ctx) {
      const triggers = requireService(g.getTriggerService, 'Trigger service');
      if (!triggers.ok) return triggers;
      const idError = requireString(args['triggerId'], 'triggerId');
      if (idError) return { ok: false, error: idError };
      try {
        const result = await triggers.service.delete(
          args['triggerId'] as string,
        );
        if (!result.ok) return { ok: false, error: result.error.message };
        return { ok: true, content: 'Trigger deleted.' };
      } catch (err) {
        return formatToolError('Unexpected error deleting trigger', err);
      }
    },
  };
}

export function createWorkflowTriggerTools(g: Getters): BuiltinTool[] {
  return [
    createWorkflowTriggerCreateTool(g),
    createWorkflowTriggerListTool(g),
    createWorkflowTriggerDeleteTool(g),
  ];
}
