import type {
  JobsStore,
  ScheduledJob,
  SessionChannelsStore,
} from '@openaidy/db';
import type { OwnerConfig } from '@openaidy/config';
import type { PulseDelivery } from '@openaidy/shared-types';
import type { createLogger } from '../lib/logger';
import { stripThinking } from '../lib/message';
import type { PromptContext } from '../prompts/build-system-prompt';

/** What a scheduled prompt's answer does, after it runs. */
export type PulseDeliveryResult = {
  /** Where it was sent ('owner', 'chat'), if anywhere beyond its session. */
  deliveredTo: Array<'owner' | 'chat'>;
  /** The agent said there was nothing to report (NO_UPDATE). */
  suppressed: boolean;
  /** Held until quiet hours end. */
  queued: boolean;
  error?: string;
};

export type NotifyOwnerResult =
  | { ok: true; queued: boolean }
  | { ok: false; error: string };

export type AssistantServiceDeps = {
  getOwner: () => OwnerConfig | undefined;
  getTimezone: () => string;
  sessionChannels: SessionChannelsStore | undefined;
  jobsRepo: JobsStore | undefined;
  sendToChannel: (
    channelId: string,
    target: string,
    text: string,
  ) => Promise<boolean>;
  /**
   * OpenAidy's own state for the briefing (approvals waiting, failed
   * runs…), as plain text lines.
   */
  getBriefingFacts?: () => Promise<string[]>;
  logger: ReturnType<typeof createLogger>;
  /** For tests. */
  now?: () => Date;
};

/** The agent's answer when nothing needs saying. */
export const NO_UPDATE = 'NO_UPDATE';
/** Longest message sent to a chat. */
const MAX_MESSAGE_CHARS = 3500;

const digits = (value: string) => value.split('@')[0]!.replace(/\D/g, '');

/** Minutes since midnight in `timeZone`. */
function minutesInZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function metadataOf(job: ScheduledJob): Record<string, unknown> {
  return (job.metadata as Record<string, unknown> | null) ?? {};
}

/**
 * The "always on" layer: who the owner is and how to reach them, the
 * date/time context agents see, and what happens before and after a
 * scheduled prompt (pulse, reminder, briefing) runs — extra instructions
 * going in, and sending the answer to the owner or back to the chat it
 * came from coming out.
 */
export class AssistantService {
  private readonly held: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: AssistantServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Flush messages held during quiet hours, once a minute. */
  start(): void {
    this.flushTimer ??= setInterval(() => void this.flushHeld(), 60_000);
    this.flushTimer.unref?.();
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = undefined;
  }

  // ── Owner ──────────────────────────────────────────────────────────────────

  /** Whether OpenAidy knows where to reach the owner. */
  ownerReachable(): boolean {
    const owner = this.deps.getOwner();
    return Boolean(owner?.channelId && owner.contact?.trim());
  }

  /** Whether a channel sender is the owner. */
  isOwner(channelId: string, senderId: string, target?: string): boolean {
    const owner = this.deps.getOwner();
    if (!owner?.channelId || !owner.contact || owner.channelId !== channelId) {
      return false;
    }
    const contact = owner.contact.trim();
    if (contact === senderId || contact === target) return true;
    const contactDigits = digits(contact);
    return (
      contactDigits.length >= 6 &&
      (digits(senderId) === contactDigits ||
        (target !== undefined && digits(target) === contactDigits))
    );
  }

  inQuietHours(date: Date = this.now()): boolean {
    const quiet = this.deps.getOwner()?.quietHours;
    if (!quiet) return false;
    const now = minutesInZone(date, this.deps.getTimezone());
    const from = toMinutes(quiet.from);
    const to = toMinutes(quiet.to);
    return from <= to ? now >= from && now < to : now >= from || now < to;
  }

  /**
   * Message the owner on their channel. During quiet hours the message is
   * held until they end (unless urgent). Held messages live in memory, so
   * a restart during quiet hours drops them.
   */
  async notifyOwner(
    text: string,
    options: { urgent?: boolean } = {},
  ): Promise<NotifyOwnerResult> {
    const owner = this.deps.getOwner();
    if (!owner?.channelId || !owner.contact?.trim()) {
      return {
        ok: false,
        error:
          "The owner's WhatsApp (or other channel) isn't set up. Add it in Settings → You.",
      };
    }
    const message = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!message) return { ok: false, error: 'Nothing to send.' };
    if (!options.urgent && this.inQuietHours()) {
      this.held.push(message);
      return { ok: true, queued: true };
    }
    const sent = await this.deps.sendToChannel(
      owner.channelId,
      owner.contact.trim(),
      message,
    );
    return sent
      ? { ok: true, queued: false }
      : {
          ok: false,
          error: `Couldn't reach the owner on "${owner.channelId}" (is it connected?).`,
        };
  }

  /** Sends what was held during quiet hours, once they're over. */
  async flushHeld(): Promise<void> {
    if (this.held.length === 0 || this.inQuietHours()) return;
    const messages = this.held.splice(0, this.held.length);
    const owner = this.deps.getOwner();
    if (!owner?.channelId || !owner.contact) return;
    for (const message of messages) {
      const sent = await this.deps.sendToChannel(
        owner.channelId,
        owner.contact.trim(),
        message,
      );
      if (!sent) {
        this.deps.logger.warn('Could not send a held message to the owner');
      }
    }
  }

  /**
   * Tells the owner when any workflow needs their approval or fails
   * (`owner.notifyWorkflowEvents`, on by default).
   */
  async onWorkflowEvent(
    event:
      | { type: 'run.finished'; run: { status: string; error: string | null } }
      | { type: 'approval.waiting'; subtask: { title: string } },
    workflowTitle: string,
  ): Promise<void> {
    const owner = this.deps.getOwner();
    if (
      !owner ||
      owner.notifyWorkflowEvents === false ||
      !this.ownerReachable()
    ) {
      return;
    }
    let text: string | null = null;
    if (event.type === 'approval.waiting') {
      text = `⏳ "${workflowTitle}" needs your approval: ${event.subtask.title}. Open it in OpenAidy to approve or reject.`;
    } else if (event.run.status === 'failed') {
      text = `⚠️ "${workflowTitle}" failed: ${event.run.error ?? 'a step failed'}`;
    }
    if (!text) return;
    const sent = await this.notifyOwner(text);
    if (!sent.ok) {
      this.deps.logger.warn('Could not tell the owner about a workflow event', {
        error: sent.error,
      });
    }
  }

  // ── Conversation context ───────────────────────────────────────────────────

  async promptContext(sessionId: string): Promise<PromptContext> {
    const timezone = this.deps.getTimezone();
    const route = await this.deps.sessionChannels?.find(sessionId);
    if (!route) return { timezone };
    return {
      timezone,
      conversation: {
        channelType: route.channelType,
        channelId: route.channelId,
        senderId: route.senderId,
        isOwner: this.isOwner(route.channelId, route.senderId, route.target),
      },
    };
  }

  /** Sends text to the chat a session's conversation came from, if any. */
  async sendToConversation(sessionId: string, text: string): Promise<boolean> {
    const route = await this.deps.sessionChannels?.find(sessionId);
    if (!route) return false;
    return this.deps.sendToChannel(
      route.channelId,
      route.target,
      text.slice(0, MAX_MESSAGE_CHARS),
    );
  }

  // ── Scheduled prompts ──────────────────────────────────────────────────────

  /** The message a scheduled prompt runs with. */
  async preparePulseMessage(job: ScheduledJob): Promise<string> {
    const metadata = metadataOf(job);
    const kind = metadata['kind'];
    const base = (job.payload['message'] as string | undefined) ?? '';
    const delivery = (metadata['delivery'] as PulseDelivery | undefined) ?? {};
    const lastDelivered = metadata['lastDelivered'] as string | undefined;
    const parts: string[] = [];

    if (kind === 'reminder') {
      const inChat =
        job.targetSessionId &&
        (await this.deps.sessionChannels?.find(job.targetSessionId));
      parts.push(
        `It's time for something you scheduled earlier in this conversation:\n\n${base}\n\n` +
          `Do it now. Your reply is ${inChat ? 'sent to this chat' : 'shown in this conversation'}, so write it for the person you're talking to.`,
      );
    } else if (kind === 'briefing') {
      const facts = (await this.deps.getBriefingFacts?.()) ?? [];
      parts.push(
        "Write the owner's daily briefing, to be sent to them on WhatsApp. " +
          'Use your tools to look things up. Keep it short and scannable: a greeting, then the few things that matter today, most important first, then anything waiting on them. ' +
          "Skip sections with nothing in them. Don't invent anything.",
      );
      if (base.trim()) parts.push(`What the owner wants covered:\n${base}`);
      parts.push(
        facts.length
          ? `From OpenAidy itself:\n${facts.map((f) => `- ${f}`).join('\n')}`
          : 'From OpenAidy itself: nothing is waiting for their approval, no workflow failed in the last 24 hours, and no reminders are due today. No need to look these up.',
      );
    } else {
      parts.push(base);
    }

    if (delivery.toOwner && kind !== 'briefing') {
      parts.push(
        'Your answer is sent to the owner on WhatsApp: write it as a short message to them.',
      );
    }
    if (delivery.toOwner || kind === 'briefing') {
      parts.push(
        "Don't use notify_owner or channel_send for this: your reply is delivered automatically. Reply with only the message itself.",
      );
    }
    if (delivery.onlyIfNeeded) {
      parts.push(
        `If there is nothing worth telling them right now, reply with exactly ${NO_UPDATE} and nothing else.`,
      );
    }
    if (lastDelivered && (delivery.toOwner || delivery.onlyIfNeeded)) {
      parts.push(
        `Last time you sent: "${lastDelivered.slice(0, 500)}". Don't repeat it unless something changed.`,
      );
    }
    return parts.join('\n\n---\n\n');
  }

  /** Sends a scheduled prompt's answer where it should go. */
  async deliverPulseResult(
    job: ScheduledJob,
    result: { sessionId: string; reply: string },
  ): Promise<PulseDeliveryResult> {
    const metadata = metadataOf(job);
    const kind = metadata['kind'];
    const delivery = (metadata['delivery'] as PulseDelivery | undefined) ?? {};
    const text = stripThinking(result.reply).trim();
    const outcome: PulseDeliveryResult = {
      deliveredTo: [],
      suppressed: false,
      queued: false,
    };
    if (!text || new RegExp(`^${NO_UPDATE}\\b`, 'i').test(text)) {
      outcome.suppressed = true;
      return outcome;
    }

    if (kind === 'reminder' && job.targetSessionId) {
      if (await this.sendToConversation(job.targetSessionId, text)) {
        outcome.deliveredTo.push('chat');
      }
    }
    if (kind === 'briefing' || delivery.toOwner) {
      const sent = await this.notifyOwner(text);
      if (sent.ok) {
        outcome.deliveredTo.push('owner');
        outcome.queued = sent.queued;
      } else {
        outcome.error = sent.error;
      }
    }

    if (outcome.deliveredTo.length > 0 && this.deps.jobsRepo) {
      // Remembered so the next run doesn't send the same alert again.
      await this.deps.jobsRepo
        .update(job.id, {
          metadata: { ...metadata, lastDelivered: text.slice(0, 1000) },
        })
        .catch(() => undefined);
    }
    return outcome;
  }
}
