import type { BuiltinTool } from '@openaidy/runtime';
import type { AssistantService } from '../../assistant/service';
import { formatWhen, parseWhen } from '../../assistant/when';
import type { PulseService } from '../../pulses/service';
import {
  formatToolError,
  optionalString,
  requireService,
  requireString,
} from '../shared.js';
import {
  notifyOwnerMeta,
  reminderCancelMeta,
  reminderCreateMeta,
  reminderListMeta,
} from '../catalog.js';

export type AssistantToolDeps = {
  getAssistant: () => AssistantService | undefined;
  getPulseService: () => PulseService | undefined;
  getTimezone: () => string;
};

/** notify_owner — message the owner on their channel (WhatsApp etc.). */
export function createNotifyOwnerTool(deps: AssistantToolDeps): BuiltinTool {
  return {
    name: notifyOwnerMeta.name,
    description: notifyOwnerMeta.description,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The message for the owner.' },
        urgent: {
          type: 'boolean',
          description:
            'Send even during their quiet hours. Only for things that really can’t wait.',
        },
      },
      required: ['text'],
    },
    async execute(args) {
      const assistant = requireService(deps.getAssistant, 'Assistant');
      if (!assistant.ok) return assistant;
      const textError = requireString(args['text'], 'text');
      if (textError) return { ok: false, error: textError };
      const result = await assistant.service.notifyOwner(
        args['text'] as string,
        { urgent: args['urgent'] === true },
      );
      if (!result.ok) return { ok: false, error: result.error };
      return {
        ok: true,
        content: result.queued
          ? "Held: it's the owner's quiet hours; it will be sent when they end."
          : 'Sent to the owner.',
      };
    },
  };
}

/**
 * reminder_create — schedule something to happen later in this same
 * conversation ("remind me Friday at 9", "check tomorrow whether they
 * paid"). It runs here, with this agent; if the conversation is on
 * WhatsApp, the reply goes to that chat.
 */
export function createReminderCreateTool(deps: AssistantToolDeps): BuiltinTool {
  return {
    name: reminderCreateMeta.name,
    description: reminderCreateMeta.description,
    parameters: {
      type: 'object',
      properties: {
        when: {
          type: 'string',
          description:
            'When: "in 2 hours", "in 30 minutes", "in 3 days", or a date and time like "2026-10-31T09:00" (owner timezone; see [NOW]) or with an offset.',
        },
        instructions: {
          type: 'string',
          description:
            'What to do then, written for your future self, with all the context needed (who, what, why). E.g. "Remind Ana to send the signed contract" or "Check in Stripe whether invoice INV-12 was paid; if not, draft a friendly reminder".',
        },
        title: {
          type: 'string',
          description: 'Short label shown in lists, e.g. "Call Ana".',
        },
        onlyIfNeeded: {
          type: 'boolean',
          description:
            'Stay quiet if, when it runs, there turns out to be nothing to say (e.g. they already paid).',
        },
      },
      required: ['when', 'instructions'],
    },
    async execute(args, ctx) {
      const pulses = requireService(deps.getPulseService, 'Pulse service');
      if (!pulses.ok) return pulses;
      for (const field of ['when', 'instructions']) {
        const error = requireString(args[field], field);
        if (error) return { ok: false, error };
      }
      const titleError = optionalString(args['title'], 'title');
      if (titleError) return { ok: false, error: titleError };
      if (!ctx.sessionId) {
        return {
          ok: false,
          error: 'Reminders can only be created from a conversation.',
        };
      }

      const timezone = deps.getTimezone();
      const when = parseWhen(args['when'] as string, timezone);
      if (!when.ok) return { ok: false, error: when.error };
      const instructions = (args['instructions'] as string).trim();
      const title =
        (args['title'] as string | undefined)?.trim() ||
        (instructions.length > 60
          ? `${instructions.slice(0, 57).trimEnd()}…`
          : instructions);

      try {
        const reminder = await pulses.service.createPulse({
          kind: 'reminder',
          name: title,
          prompt: instructions,
          schedule: { at: when.date.toISOString() },
          sessionId: ctx.sessionId,
          ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
          ...(args['onlyIfNeeded'] === true
            ? { delivery: { onlyIfNeeded: true } }
            : {}),
        });
        return {
          ok: true,
          content: `Reminder set for ${formatWhen(when.date, timezone)} (${timezone}): "${title}". ID: ${reminder.id}. It will run in this conversation.`,
        };
      } catch (err) {
        return formatToolError('Could not create the reminder', err);
      }
    },
  };
}

/** reminder_list — this conversation's upcoming reminders (or all). */
export function createReminderListTool(deps: AssistantToolDeps): BuiltinTool {
  return {
    name: reminderListMeta.name,
    description: reminderListMeta.description,
    parameters: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description:
            'List reminders from every conversation, not just this one.',
        },
      },
    },
    async execute(args, ctx) {
      const pulses = requireService(deps.getPulseService, 'Pulse service');
      if (!pulses.ok) return pulses;
      const timezone = deps.getTimezone();
      const reminders = await pulses.service.listByKind('reminder', {
        status: 'active',
        ...(args['all'] === true || !ctx.sessionId
          ? {}
          : { sessionId: ctx.sessionId }),
      });
      if (reminders.length === 0) {
        return { ok: true, content: 'No upcoming reminders.' };
      }
      return {
        ok: true,
        content: reminders
          .map(
            (r) =>
              `- ${formatWhen(r.nextRunAt, timezone)}: ${r.name} (ID: ${r.id})`,
          )
          .join('\n'),
      };
    },
  };
}

/** reminder_cancel */
export function createReminderCancelTool(deps: AssistantToolDeps): BuiltinTool {
  return {
    name: reminderCancelMeta.name,
    description: reminderCancelMeta.description,
    parameters: {
      type: 'object',
      properties: {
        reminderId: { type: 'string', description: 'From reminder_list.' },
      },
      required: ['reminderId'],
    },
    async execute(args) {
      const pulses = requireService(deps.getPulseService, 'Pulse service');
      if (!pulses.ok) return pulses;
      const idError = requireString(args['reminderId'], 'reminderId');
      if (idError) return { ok: false, error: idError };
      try {
        const reminder = await pulses.service.getPulse(
          args['reminderId'] as string,
        );
        if (reminder.kind !== 'reminder') {
          return { ok: false, error: 'That id is not a reminder.' };
        }
        await pulses.service.deletePulse(reminder.id);
        return { ok: true, content: `Cancelled "${reminder.name}".` };
      } catch (err) {
        return formatToolError('Could not cancel the reminder', err);
      }
    },
  };
}

export function createAssistantTools(deps: AssistantToolDeps): BuiltinTool[] {
  return [
    createNotifyOwnerTool(deps),
    createReminderCreateTool(deps),
    createReminderListTool(deps),
    createReminderCancelTool(deps),
  ];
}
