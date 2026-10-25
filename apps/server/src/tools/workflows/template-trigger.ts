import type { ResolvedTemplateTrigger } from '@openaidy/shared-types';
import type { TaskScheduleService } from '../../tasks/schedule-service';
import type { WorkflowTriggerService } from '../../tasks/triggers/service';

export type TemplateTriggerDeps = {
  getTriggerService?: (() => WorkflowTriggerService | undefined) | undefined;
  getScheduleService?: (() => TaskScheduleService | undefined) | undefined;
};

/** One line describing how a template suggests the workflow starts. */
export function describeTemplateTrigger(
  trigger: ResolvedTemplateTrigger,
): string {
  if (trigger.kind === 'webhook') return 'a webhook';
  if (trigger.kind === 'schedule') {
    return `a schedule (${JSON.stringify(trigger.schedule)})`;
  }
  const verb = {
    any: '',
    equals: 'are exactly',
    starts_with: 'start with',
    contains: 'contain',
    regex: 'match',
  }[trigger.match.type];
  const rule =
    trigger.match.type === 'any'
      ? 'any message'
      : `messages that ${verb} "${trigger.match.value ?? ''}"`;
  return `${rule} on channel ${trigger.channelId}`;
}

/**
 * Creates the trigger or schedule a template suggests, and says what
 * happened (including a webhook's one-time token).
 */
export async function setUpTemplateTrigger(
  workflowId: string,
  trigger: ResolvedTemplateTrigger,
  deps: TemplateTriggerDeps,
): Promise<string> {
  if (trigger.kind === 'schedule') {
    const schedules = deps.getScheduleService?.();
    if (!schedules) return 'Schedules are not available, so none was set up.';
    const result = await schedules.createSchedule(workflowId, {
      schedule: trigger.schedule,
    });
    return result.ok
      ? `Scheduled: ${describeTemplateTrigger(trigger)}.`
      : `Couldn't set up the schedule: ${result.error.message}`;
  }

  const triggers = deps.getTriggerService?.();
  if (!triggers) return 'Triggers are not available, so none was set up.';
  if (trigger.kind === 'webhook') {
    const result = await triggers.createWebhook(workflowId);
    return result.ok
      ? `Webhook created: POST <server URL>${result.data.trigger.webhookPath} with "Authorization: Bearer ${result.data.token}" (the token is shown only this once).`
      : `Couldn't create the webhook: ${result.error.message}`;
  }
  const result = await triggers.createChannelTrigger(workflowId, {
    config: {
      channelId: trigger.channelId,
      match: trigger.match,
      replyWithResult: trigger.replyWithResult,
      ...(trigger.ackText ? { ackText: trigger.ackText } : {}),
    },
  });
  return result.ok
    ? `Starts on ${describeTemplateTrigger(trigger)}.`
    : `Couldn't set up the message trigger: ${result.error.message}`;
}
