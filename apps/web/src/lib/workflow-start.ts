/**
 * Plain-language descriptions of how a workflow starts (a template's
 * suggested trigger, or one from a drafted workflow).
 */

import type {
  ResolvedTemplateTrigger,
  ScheduleInput,
  WorkflowTemplate,
} from '@openaidy/shared-types';
import { substitutePlaceholders } from '@openaidy/workflow-templates';

const EVERY_LABEL: Record<string, string> = {
  '15m': 'Every 15 minutes',
  '30m': 'Every 30 minutes',
  '1h': 'Every hour',
  '6h': 'Every 6 hours',
  '12h': 'Every 12 hours',
  '1d': 'Every day',
  '1w': 'Every week',
};

export function describeSchedule(schedule: ScheduleInput): string {
  if ('every' in schedule) return EVERY_LABEL[schedule.every] ?? 'Repeatedly';
  if ('daily' in schedule) {
    const { hour, minute } = schedule.daily;
    return `Every day at ${hour}:${String(minute).padStart(2, '0')}`;
  }
  if ('cron' in schedule) return `On a schedule (${schedule.cron})`;
  return `Once, at ${new Date(schedule.at).toLocaleString()}`;
}

const MATCH_VERB = {
  any: '',
  equals: 'is exactly',
  starts_with: 'starts with',
  contains: 'contains',
  regex: 'matches',
} as const;

export function describeStart(
  trigger: ResolvedTemplateTrigger | null | undefined,
): string {
  if (!trigger) return 'When you press Run';
  if (trigger.kind === 'webhook')
    return 'When another service calls its webhook';
  if (trigger.kind === 'schedule') return describeSchedule(trigger.schedule);
  const on = trigger.channelId ? ` on ${trigger.channelId}` : '';
  return trigger.match.type === 'any'
    ? `When any message arrives${on}`
    : `When a message${on} ${MATCH_VERB[trigger.match.type]} "${trigger.match.value ?? ''}"`;
}

/**
 * A template's suggested trigger with the current form values filled in,
 * for display (the server resolves it again when applying).
 */
export function templateStart(
  template: WorkflowTemplate,
  values: Record<string, string>,
): ResolvedTemplateTrigger | undefined {
  const trigger = template.trigger;
  if (!trigger || trigger.kind !== 'channel_message') return trigger;
  const filled = Object.fromEntries(
    template.inputs.map((i) => [i.key, values[i.key] || i.default || '']),
  );
  const fill = (text: string) => substitutePlaceholders(text, filled);
  const value = trigger.match.value ? fill(trigger.match.value) : undefined;
  return {
    kind: 'channel_message',
    channelId: fill(trigger.channel).replace(/\{\{\w+\}\}/g, ''),
    match: { type: trigger.match.type, ...(value ? { value } : {}) },
    replyWithResult: trigger.replyWithResult,
  };
}
