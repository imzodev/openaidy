import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  WorkflowRun,
  WorkflowTrigger,
  WorkflowTriggersRepository,
} from '@openaidy/db';
import type {
  ChannelMessageTriggerConfig,
  WebhookTokenDto,
  WorkflowTriggerDto,
} from '@openaidy/shared-types';
import type { createLogger } from '../../lib/logger';
import type { ServiceResult } from '../../types';
import type { WorkflowRunEvent } from '../execution/task-execution';
import type { TaskService } from '../service';
import { matchRuleProblem, messageMatches, senderAllowed } from './matcher';

/** Longest result sent back to a chat. */
const MAX_REPLY_CHARS = 3500;

export const WEBHOOK_PATH_PREFIX = '/api/hooks/';

export type ChannelMessageInput = {
  channelId: string;
  /** Every id form of the sender (WhatsApp phone + LID, Discord user id). */
  senderIds: string[];
  text: string;
  /** Where a reply goes: WhatsApp chat JID, Discord channel id. */
  replyTarget: string;
};

export type WebhookRequest = {
  token: string | undefined;
  contentType: string | undefined;
  body: unknown;
  query: Record<string, string>;
};

type ReplyTarget = { channelId: string; target: string; triggerId: string };

export type WorkflowTriggerServiceDeps = {
  triggersRepo: WorkflowTriggersRepository;
  taskService: Pick<
    TaskService,
    'getTask' | 'startRun' | 'getSubtasks' | 'onRunEvent'
  >;
  /** Ids of the channels in the config, to validate channel triggers. */
  listChannelIds: () => string[];
  /** Send a message to a chat on a channel; false if it couldn't be sent. */
  sendToChannel: (
    channelId: string,
    target: string,
    text: string,
  ) => Promise<boolean>;
  logger: ReturnType<typeof createLogger>;
};

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

function notFound<T>(id: string): ServiceResult<T> {
  return {
    ok: false,
    error: { code: 'trigger.not_found', message: `Trigger "${id}" not found` },
  };
}

function invalid<T>(message: string): ServiceResult<T> {
  return { ok: false, error: { code: 'trigger.invalid', message } };
}

function parseChannelConfig(
  trigger: WorkflowTrigger,
): ChannelMessageTriggerConfig | null {
  if (trigger.kind !== 'channel_message') return null;
  try {
    return JSON.parse(trigger.config) as ChannelMessageTriggerConfig;
  } catch {
    return null;
  }
}

/** Drop OUTCOME tags: they're for the workflow, not the person. */
function cleanResult(result: string): string {
  return result.replace(/^OUTCOME:.*$/gim, '').trim();
}

/**
 * Things outside OpenAidy that start a workflow run: webhooks and channel
 * messages. Starts the run with what arrived as its input and, for
 * channel messages, sends the outcome back to the same chat.
 */
export class WorkflowTriggerService {
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: WorkflowTriggerServiceDeps) {
    this.unsubscribe = deps.taskService.onRunEvent((event) =>
      this.onRunEvent(event),
    );
  }

  destroy(): void {
    this.unsubscribe();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  toDto(trigger: WorkflowTrigger, taskTitle?: string): WorkflowTriggerDto {
    const channel = parseChannelConfig(trigger);
    return {
      id: trigger.id,
      taskId: trigger.taskId,
      ...(taskTitle !== undefined ? { taskTitle } : {}),
      kind: trigger.kind,
      name: trigger.name,
      enabled: trigger.enabled,
      ...(channel ? { channel } : {}),
      ...(trigger.kind === 'webhook'
        ? { webhookPath: `${WEBHOOK_PATH_PREFIX}${trigger.id}` }
        : {}),
      lastFiredAt: trigger.lastFiredAt
        ? new Date(trigger.lastFiredAt).toISOString()
        : null,
      createdAt: new Date(trigger.createdAt).toISOString(),
    };
  }

  async listForTask(
    taskId: string,
  ): Promise<ServiceResult<WorkflowTriggerDto[]>> {
    const task = await this.deps.taskService.getTask(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }
    const triggers = await this.deps.triggersRepo.listByTask(taskId);
    return { ok: true, data: triggers.map((t) => this.toDto(t, task.title)) };
  }

  /** Every trigger (optionally of one kind) with its workflow's title. */
  async listAll(kind?: WorkflowTrigger['kind']): Promise<WorkflowTriggerDto[]> {
    const triggers = await this.deps.triggersRepo.list(kind);
    const titles = new Map<string, string>();
    for (const t of triggers) {
      if (!titles.has(t.taskId)) {
        const task = await this.deps.taskService.getTask(t.taskId);
        titles.set(t.taskId, task?.title ?? '');
      }
    }
    return triggers.map((t) => this.toDto(t, titles.get(t.taskId)));
  }

  async createWebhook(
    taskId: string,
    name?: string,
  ): Promise<ServiceResult<WebhookTokenDto>> {
    const task = await this.deps.taskService.getTask(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }
    const token = randomBytes(24).toString('base64url');
    const trigger = await this.deps.triggersRepo.create({
      taskId,
      kind: 'webhook',
      name: name?.trim() || 'Webhook',
      config: '{}',
      secretHash: hashToken(token),
    });
    return { ok: true, data: { trigger: this.toDto(trigger), token } };
  }

  async regenerateToken(id: string): Promise<ServiceResult<WebhookTokenDto>> {
    const trigger = await this.deps.triggersRepo.findById(id);
    if (!trigger || trigger.kind !== 'webhook') return notFound(id);
    const token = randomBytes(24).toString('base64url');
    const updated = await this.deps.triggersRepo.update(id, {
      secretHash: hashToken(token),
    });
    return { ok: true, data: { trigger: this.toDto(updated!), token } };
  }

  private validateChannelConfig(
    config: ChannelMessageTriggerConfig,
  ): string | null {
    if (!config.channelId?.trim()) return 'Choose a channel.';
    const channels = this.deps.listChannelIds();
    if (!channels.includes(config.channelId)) {
      return channels.length > 0
        ? `Channel "${config.channelId}" doesn't exist. Available: ${channels.join(', ')}`
        : `Channel "${config.channelId}" doesn't exist; no channels are set up yet`;
    }
    return matchRuleProblem(config.match ?? { type: '' });
  }

  async createChannelTrigger(
    taskId: string,
    input: { name?: string; config: ChannelMessageTriggerConfig },
  ): Promise<ServiceResult<WorkflowTriggerDto>> {
    const task = await this.deps.taskService.getTask(taskId);
    if (!task) {
      return {
        ok: false,
        error: {
          code: 'task.not_found',
          message: `Task "${taskId}" not found`,
        },
      };
    }
    const config = normaliseChannelConfig(input.config);
    const problem = this.validateChannelConfig(config);
    if (problem) return invalid(problem);
    const trigger = await this.deps.triggersRepo.create({
      taskId,
      kind: 'channel_message',
      name: input.name?.trim() || describeMatch(config),
      config: JSON.stringify(config),
    });
    return { ok: true, data: this.toDto(trigger) };
  }

  async update(
    id: string,
    input: {
      name?: string;
      enabled?: boolean;
      channel?: Partial<ChannelMessageTriggerConfig>;
    },
  ): Promise<ServiceResult<WorkflowTriggerDto>> {
    const trigger = await this.deps.triggersRepo.findById(id);
    if (!trigger) return notFound(id);
    let config: string | undefined;
    if (input.channel) {
      const current = parseChannelConfig(trigger);
      if (!current)
        return invalid('Only message triggers have channel settings');
      const next = normaliseChannelConfig({ ...current, ...input.channel });
      const problem = this.validateChannelConfig(next);
      if (problem) return invalid(problem);
      config = JSON.stringify(next);
    }
    const updated = await this.deps.triggersRepo.update(id, {
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(config ? { config } : {}),
    });
    return { ok: true, data: this.toDto(updated!) };
  }

  async delete(id: string): Promise<ServiceResult<true>> {
    const deleted = await this.deps.triggersRepo.delete(id);
    return deleted ? { ok: true, data: true } : notFound(id);
  }

  // ── Firing ────────────────────────────────────────────────────────────────

  /**
   * An HTTP request to a webhook URL. Unknown and disabled triggers both
   * look like "not found", so a URL can't be probed for whether it exists.
   */
  async fireWebhook(
    id: string,
    request: WebhookRequest,
  ): Promise<ServiceResult<{ runId: string }>> {
    const trigger = await this.deps.triggersRepo.findById(id);
    if (!trigger || trigger.kind !== 'webhook' || !trigger.enabled) {
      return notFound(id);
    }
    const expected = Buffer.from(trigger.secretHash ?? '', 'hex');
    const given = Buffer.from(hashToken(request.token ?? ''), 'hex');
    if (
      !request.token ||
      expected.length !== given.length ||
      !timingSafeEqual(expected, given)
    ) {
      return {
        ok: false,
        error: {
          code: 'trigger.unauthorized',
          message: 'Missing or wrong webhook token',
        },
      };
    }

    const started = await this.deps.taskService.startRun(trigger.taskId, {
      trigger: 'webhook',
      input: formatWebhookInput(trigger.name, request),
    });
    if (!started.ok) return started;
    await this.deps.triggersRepo.markFired(trigger.id);
    this.deps.logger.info('Webhook started a workflow run', {
      triggerId: trigger.id,
      taskId: trigger.taskId,
      runId: started.data.runId,
    });
    return { ok: true, data: { runId: started.data.runId } };
  }

  /**
   * A message that arrived on a channel. Returns the reply to send right
   * away when a trigger matched (the message is then handled here and
   * doesn't go to the channel's chat agent), or null when none matched.
   */
  async handleChannelMessage(
    message: ChannelMessageInput,
  ): Promise<string | null> {
    const triggers =
      await this.deps.triggersRepo.listEnabled('channel_message');
    for (const trigger of triggers) {
      const config = parseChannelConfig(trigger);
      if (
        !config ||
        config.channelId !== message.channelId ||
        !messageMatches(config.match, message.text) ||
        !senderAllowed(config.senders, message.senderIds)
      ) {
        continue;
      }
      return this.startFromMessage(trigger, config, message);
    }
    return null;
  }

  private async startFromMessage(
    trigger: WorkflowTrigger,
    config: ChannelMessageTriggerConfig,
    message: ChannelMessageInput,
  ): Promise<string> {
    const task = await this.deps.taskService.getTask(trigger.taskId);
    const title = task?.title ?? 'The workflow';
    const sender = message.senderIds[0] ?? 'unknown';
    const replyTarget: ReplyTarget = {
      channelId: message.channelId,
      target: message.replyTarget,
      triggerId: trigger.id,
    };
    const started = await this.deps.taskService.startRun(trigger.taskId, {
      trigger: 'channel',
      input: `Message from ${sender}:\n${message.text}`,
      ...(config.replyWithResult
        ? { replyTarget: JSON.stringify(replyTarget) }
        : {}),
    });

    if (!started.ok) {
      this.deps.logger.warn(
        'Channel message matched a trigger but no run started',
        {
          triggerId: trigger.id,
          code: started.error.code,
        },
      );
      return started.error.code === 'workflow.already_running'
        ? `"${title}" is already running. Send your message again once it has finished.`
        : `"${title}" can't run right now. Please check it in OpenAidy.`;
    }
    await this.deps.triggersRepo.markFired(trigger.id);
    this.deps.logger.info('Channel message started a workflow run', {
      triggerId: trigger.id,
      taskId: trigger.taskId,
      runId: started.data.runId,
    });
    return config.ackText?.trim() || `On it — running "${title}".`;
  }

  // ── Replies ───────────────────────────────────────────────────────────────

  private async onRunEvent(event: WorkflowRunEvent): Promise<void> {
    const target = parseReplyTarget(event.run);
    if (!target) return;
    const task = await this.deps.taskService.getTask(event.run.taskId);
    const title = task?.title ?? 'The workflow';

    const text =
      event.type === 'approval.waiting'
        ? `"${title}" is waiting for your approval in OpenAidy: ${event.subtask.title}.`
        : await this.finalMessage(event.run, title);
    const sent = await this.deps.sendToChannel(
      target.channelId,
      target.target,
      text,
    );
    if (!sent) {
      this.deps.logger.warn('Could not send a workflow update to the chat', {
        runId: event.run.id,
        channelId: target.channelId,
        type: event.type,
      });
    }
  }

  /**
   * What the person gets back: the result of the last steps that ran (the
   * ones nothing else ran after), or why the run didn't finish.
   */
  private async finalMessage(run: WorkflowRun, title: string): Promise<string> {
    if (run.status === 'cancelled') return `"${title}" was stopped.`;
    if (run.status === 'failed') {
      return `"${title}" couldn't finish: ${run.error ?? 'a step failed'}`;
    }
    const steps = await this.deps.taskService.getSubtasks(run.taskId);
    const ran = steps.filter(
      (s) => s.status === 'completed' && s.subtaskKind !== 'approval_gate',
    );
    const ranIds = new Set(ran.map((s) => s.id));
    const followedBy = new Set(
      ran.flatMap((s) => s.dependsOnSubtaskIds.filter((id) => ranIds.has(id))),
    );
    const results = ran
      .filter((s) => !followedBy.has(s.id) && s.result)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((s) => cleanResult(s.result!))
      .filter(Boolean);
    const text = results.join('\n\n') || `"${title}" finished.`;
    return text.length > MAX_REPLY_CHARS
      ? `${text.slice(0, MAX_REPLY_CHARS)}…`
      : text;
  }
}

function parseReplyTarget(run: WorkflowRun): ReplyTarget | null {
  if (!run.replyTarget) return null;
  try {
    const parsed = JSON.parse(run.replyTarget) as Partial<ReplyTarget>;
    return parsed.channelId && parsed.target ? (parsed as ReplyTarget) : null;
  } catch {
    return null;
  }
}

function normaliseChannelConfig(
  config: ChannelMessageTriggerConfig,
): ChannelMessageTriggerConfig {
  const senders = (config.senders ?? []).map((s) => s.trim()).filter(Boolean);
  return {
    channelId: config.channelId?.trim() ?? '',
    match: {
      type: config.match?.type ?? 'any',
      ...(config.match?.value?.trim()
        ? { value: config.match.value.trim() }
        : {}),
    },
    ...(senders.length ? { senders } : {}),
    replyWithResult: config.replyWithResult !== false,
    ...(config.ackText?.trim() ? { ackText: config.ackText.trim() } : {}),
  };
}

function describeMatch(config: ChannelMessageTriggerConfig): string {
  const value = config.match.value ?? '';
  switch (config.match.type) {
    case 'any':
      return `Any message on ${config.channelId}`;
    case 'equals':
      return `"${value}" on ${config.channelId}`;
    case 'starts_with':
      return `Starts with "${value}" on ${config.channelId}`;
    case 'contains':
      return `Contains "${value}" on ${config.channelId}`;
    default:
      return `Matches /${value}/ on ${config.channelId}`;
  }
}

function formatWebhookInput(name: string, request: WebhookRequest): string {
  let body: string;
  if (
    request.body === undefined ||
    request.body === null ||
    request.body === ''
  ) {
    body = '(empty)';
  } else if (typeof request.body === 'string') {
    body = request.body;
  } else if (Buffer.isBuffer(request.body)) {
    body = request.body.toString('utf8');
  } else {
    body = JSON.stringify(request.body, null, 2);
  }
  const query = Object.entries(request.query).filter(([k]) => k !== 'token');
  return [
    `Webhook "${name}" received a request.`,
    ...(request.contentType ? [`Content-Type: ${request.contentType}`] : []),
    ...(query.length
      ? [`Query: ${query.map(([k, v]) => `${k}=${v}`).join('&')}`]
      : []),
    `Body:\n${body}`,
  ].join('\n');
}
