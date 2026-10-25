/**
 * The proactive layer: owner detection, quiet hours, "now" in prompts,
 * reminders created from a conversation and sent back to its chat, alerts
 * that stay quiet when there's nothing to say, and the daily briefing.
 * Real SQLite; a recording fake channel; a scripted agent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDatabaseAdapter,
  type DatabaseAdapter,
  type ScheduledJob,
} from '@openaidy/db';
import type { OwnerConfig } from '@openaidy/config';
import { createLogger } from '../lib/logger';
import { PulseService } from '../pulses/service';
import { createPulseRunnableAdapter } from '../scheduler/pulse-runnable-adapter';
import { setScheduleTimezone } from '../scheduler/cron-utils';
import { buildNowBlock } from '../prompts/build-system-prompt';
import { createAssistantTools } from '../tools/assistant';
import { handleInboundChannelMessage } from '../channels/message-handler';
import { AssistantService, NO_UPDATE } from './service';
import { parseWhen } from './when';
import { collectBriefingFacts } from './briefing';
import { syncBriefing } from './briefing-sync';

const TZ = 'America/Mexico_City';
const OWNER: OwnerConfig = {
  name: 'Irving',
  channelId: 'wa',
  contact: '+52 1 555 000 1111',
  notifyWorkflowEvents: true,
};

describe('parseWhen', () => {
  const now = new Date('2026-10-25T15:00:00Z'); // 09:00 in Mexico City

  it('reads relative times', () => {
    const r = parseWhen('in 2 hours', TZ, now);
    expect(r.ok && r.date.toISOString()).toBe('2026-10-25T17:00:00.000Z');
    const m = parseWhen('in 30 minutes', TZ, now);
    expect(m.ok && m.date.toISOString()).toBe('2026-10-25T15:30:00.000Z');
  });

  it('reads a local time in the owner timezone, or an explicit offset', () => {
    const local = parseWhen('2026-10-31T09:00', TZ, now);
    expect(local.ok && local.date.toISOString()).toBe(
      '2026-10-31T15:00:00.000Z',
    );
    const offset = parseWhen('2026-10-31T09:00:00-03:00', TZ, now);
    expect(offset.ok && offset.date.toISOString()).toBe(
      '2026-10-31T12:00:00.000Z',
    );
  });

  it('rejects past, far-off and unreadable times', () => {
    expect(parseWhen('2026-10-24T09:00', TZ, now).ok).toBe(false);
    expect(parseWhen('in 500 days', TZ, now).ok).toBe(false);
    expect(parseWhen('next blue moon', TZ, now).ok).toBe(false);
  });
});

describe('buildNowBlock', () => {
  it('states the local date, time and offset', () => {
    const block = buildNowBlock({
      timezone: TZ,
      now: new Date('2026-10-25T15:00:00Z'),
    });
    expect(block).toContain('Sunday, October 25, 2026');
    expect(block).toContain('09:00');
    expect(block).toContain('America/Mexico_City, UTC-06:00');
  });
});

describe('assistant', { timeout: 20000 }, () => {
  let dir: string;
  let db: DatabaseAdapter;
  let owner: OwnerConfig | undefined;
  let sent: Array<{ channelId: string; target: string; text: string }>;
  let now: Date;
  let assistant: AssistantService;
  let pulses: PulseService;
  let replies: string[];
  let turns: Array<{ sessionId: string; content: string }>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'openaidy-assistant-'));
    db = await createDatabaseAdapter({
      kind: 'sqlite',
      sqlitePath: join(dir, 'openaidy.db'),
    });
    owner = { ...OWNER };
    sent = [];
    now = new Date('2026-10-25T15:00:00Z');
    replies = [];
    turns = [];
    setScheduleTimezone(TZ);
    assistant = new AssistantService({
      getOwner: () => owner,
      getTimezone: () => TZ,
      sessionChannels: db.repositories.sessionChannels,
      jobsRepo: db.repositories.jobs,
      sendToChannel: async (channelId, target, text) => {
        sent.push({ channelId, target, text });
        return true;
      },
      getBriefingFacts: async () => ['Waiting for approval: "Send quote".'],
      logger: createLogger('test'),
      now: () => now,
    });
    pulses = new PulseService(
      db.repositories.jobs,
      db.repositories.jobRuns,
      db.repositories.sessions,
    );
  });

  afterEach(async () => {
    setScheduleTimezone(undefined);
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs a job through the real pulse runner with the assistant hooks. */
  const run = async (job: ScheduledJob) => {
    const runner = createPulseRunnableAdapter({
      jobsRepo: db.repositories.jobs,
      jobRunsRepo: db.repositories.jobRuns,
      sessionsStore: db.repositories.sessions,
      sessionMessageService: {
        submitMessageStreaming: async (input: {
          sessionId: string;
          content: string;
        }) => {
          turns.push({ sessionId: input.sessionId, content: input.content });
          return {
            ok: true,
            assistantMessage: { content: replies.shift() ?? 'Done.' },
          };
        },
      } as never,
      logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
      prepareMessage: (j) => assistant.preparePulseMessage(j),
      deliver: async (j, r) =>
        (await assistant.deliverPulseResult(j, r)) as unknown as Record<
          string,
          unknown
        >,
    });
    const result = await runner.execute(job.id, { job });
    await runner.reschedule(job.id, { job }, result);
    return result;
  };

  const whatsappSession = async () => {
    const session = await db.repositories.sessions.create({
      title: 'whatsapp:wa:5215550002222',
    });
    await db.repositories.sessionChannels.record({
      sessionId: session.id,
      channelId: 'wa',
      channelType: 'whatsapp',
      target: '5215550002222@s.whatsapp.net',
      senderId: '5215550002222',
    });
    return session;
  };

  describe('owner', () => {
    it('recognises the owner by number, whatever the formatting', () => {
      expect(assistant.isOwner('wa', '5215550001111@s.whatsapp.net')).toBe(
        true,
      );
      expect(assistant.isOwner('wa', '5215550002222')).toBe(false);
      expect(assistant.isOwner('other', '5215550001111')).toBe(false);
    });

    it('holds messages during quiet hours and sends them after', async () => {
      owner = { ...OWNER, quietHours: { from: '22:00', to: '07:00' } };
      now = new Date('2026-10-26T05:30:00Z'); // 23:30 local
      const held = await assistant.notifyOwner('New order #42');
      expect(held).toEqual({ ok: true, queued: true });
      expect(sent).toEqual([]);

      const urgent = await assistant.notifyOwner('Server down', {
        urgent: true,
      });
      expect(urgent).toEqual({ ok: true, queued: false });
      expect(sent.map((s) => s.text)).toEqual(['Server down']);

      await assistant.flushHeld();
      expect(sent).toHaveLength(1);
      now = new Date('2026-10-26T13:30:00Z'); // 07:30 local
      await assistant.flushHeld();
      expect(sent.map((s) => s.text)).toEqual(['Server down', 'New order #42']);
      expect(sent[1]).toMatchObject({ channelId: 'wa', target: OWNER.contact });
    });

    it('explains when the owner is not set up', async () => {
      owner = undefined;
      const result = await assistant.notifyOwner('hi');
      expect(!result.ok && result.error).toContain('Settings → You');
    });
  });

  describe('conversation context', () => {
    it('knows the chat and whether it is the owner', async () => {
      const session = await whatsappSession();
      expect(await assistant.promptContext(session.id)).toEqual({
        timezone: TZ,
        conversation: {
          channelType: 'whatsapp',
          channelId: 'wa',
          senderId: '5215550002222',
          isOwner: false,
        },
      });
      const web = await db.repositories.sessions.create({ title: 'Chat' });
      expect(await assistant.promptContext(web.id)).toEqual({ timezone: TZ });
    });

    it('is recorded when a channel message arrives', async () => {
      const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;
      await handleInboundChannelMessage({
        channelType: 'whatsapp',
        senderId: '5215550003333',
        text: 'hola',
        channelId: 'wa',
        agentId: 'a',
        allowlist: undefined,
        sessionService: {
          listSessions: async () => [],
          createSession: (title: string) =>
            db.repositories.sessions.create({ title }),
          submitMessageNonStreaming: async () => ({
            ok: true,
            assistantMessage: { content: 'hola!' },
          }),
        } as never,
        logger,
        replyTarget: '5215550003333@s.whatsapp.net',
        recordRoute: (route) => db.repositories.sessionChannels.record(route),
      });
      const [session] = (await db.repositories.sessions.list()).filter((s) =>
        s.title.includes('5215550003333'),
      );
      expect(
        await db.repositories.sessionChannels.find(session!.id),
      ).toMatchObject({
        target: '5215550003333@s.whatsapp.net',
      });
    });
  });

  describe('reminders', () => {
    const tools = () =>
      Object.fromEntries(
        createAssistantTools({
          getAssistant: () => assistant,
          getPulseService: () => pulses,
          getTimezone: () => TZ,
        }).map((t) => [t.name, t]),
      );

    it('are created in this conversation and fire once into its chat', async () => {
      const session = await whatsappSession();
      const created = await tools()['reminder_create']!.execute(
        {
          when: 'in 2 hours',
          instructions: 'Remind Ana to send the signed contract.',
          title: 'Contract',
        },
        { agentId: 'sales', sessionId: session.id },
      );
      expect(created.ok && created.content).toContain('Reminder set for');

      const [reminder] = await pulses.listByKind('reminder');
      expect(reminder).toMatchObject({
        kind: 'reminder',
        name: 'Contract',
        sessionId: session.id,
        agentId: 'sales',
      });
      const listed = await tools()['reminder_list']!.execute(
        {},
        { agentId: 'sales', sessionId: session.id },
      );
      expect(listed.ok && listed.content).toContain('Contract');

      replies.push('Ana, ¿ya pudiste enviar el contrato firmado?');
      const job = (await db.repositories.jobs.findById(reminder!.id))!;
      const result = await run(job);
      expect(result.ok).toBe(true);
      expect(turns[0]?.sessionId).toBe(session.id);
      expect(turns[0]?.content).toContain(
        "It's time for something you scheduled earlier in this conversation",
      );
      expect(turns[0]?.content).toContain('sent to this chat');
      expect(sent).toEqual([
        {
          channelId: 'wa',
          target: '5215550002222@s.whatsapp.net',
          text: 'Ana, ¿ya pudiste enviar el contrato firmado?',
        },
      ]);
      expect((await db.repositories.jobs.findById(job.id))?.status).toBe(
        'completed',
      );
    });

    it('stay quiet when there is nothing to say', async () => {
      const session = await whatsappSession();
      await tools()['reminder_create']!.execute(
        {
          when: 'in 1 day',
          instructions: 'Check whether invoice INV-12 was paid.',
          onlyIfNeeded: true,
        },
        { agentId: 'sales', sessionId: session.id },
      );
      const [reminder] = await pulses.listByKind('reminder');
      replies.push(NO_UPDATE);
      const result = await run(
        (await db.repositories.jobs.findById(reminder!.id))!,
      );
      expect(turns[0]?.content).toContain(`reply with exactly ${NO_UPDATE}`);
      expect(result.ok && result.output).toMatchObject({ suppressed: true });
      expect(sent).toEqual([]);
    });

    it('can be cancelled', async () => {
      const session = await whatsappSession();
      await tools()['reminder_create']!.execute(
        { when: 'in 3 hours', instructions: 'Call the supplier' },
        { agentId: 'sales', sessionId: session.id },
      );
      const [reminder] = await pulses.listByKind('reminder');
      const cancelled = await tools()['reminder_cancel']!.execute(
        { reminderId: reminder!.id },
        { agentId: 'sales', sessionId: session.id },
      );
      expect(cancelled.ok).toBe(true);
      expect(await pulses.listByKind('reminder')).toEqual([]);
    });
  });

  describe('alerts and briefing', () => {
    it('sends a pulse answer to the owner and does not repeat it', async () => {
      const pulse = await pulses.createPulse({
        name: 'Big orders',
        prompt: 'Check for orders over $500.',
        schedule: { every: '30m' },
        delivery: { toOwner: true, onlyIfNeeded: true },
      });
      replies.push('Order #77 for $820 from Acme.');
      await run((await db.repositories.jobs.findById(pulse.id))!);
      expect(sent.map((s) => s.text)).toEqual([
        'Order #77 for $820 from Acme.',
      ]);

      replies.push(NO_UPDATE);
      await run((await db.repositories.jobs.findById(pulse.id))!);
      expect(turns[1]?.content).toContain(
        'Last time you sent: "Order #77 for $820 from Acme."',
      );
      expect(sent).toHaveLength(1);
    });

    it('writes the briefing with OpenAidy facts and sends it to the owner', async () => {
      await syncBriefing(pulses, {
        ...OWNER,
        briefing: {
          enabled: true,
          time: '07:30',
          instructions: "Today's calendar and unpaid invoices.",
        },
      });
      const [briefing] = await pulses.listByKind('briefing');
      expect(briefing?.schedule).toEqual({ cron: '30 7 * * *' });
      replies.push('Buenos días…');
      await run((await db.repositories.jobs.findById(briefing!.id))!);
      expect(turns[0]?.content).toContain("Write the owner's daily briefing");
      expect(turns[0]?.content).toContain(
        "Today's calendar and unpaid invoices.",
      );
      expect(turns[0]?.content).toContain(
        'Waiting for approval: "Send quote".',
      );
      expect(turns[0]?.content).toContain("Don't use notify_owner");
      expect(sent.map((s) => s.text)).toEqual(['Buenos días…']);

      await syncBriefing(pulses, {
        ...OWNER,
        briefing: { enabled: false, time: '07:30' },
      });
      expect((await pulses.listByKind('briefing'))[0]?.status).toBe('paused');
    });

    it('collects approvals, failures and today’s reminders', async () => {
      const task = await db.repositories.tasks.create({
        title: 'Quotes',
        description: 'x',
      });
      const failedRun = await db.repositories.workflowRuns.create({
        taskId: task.id,
        trigger: 'manual',
      });
      await db.repositories.workflowRuns.finish(failedRun.id, {
        status: 'failed',
        error: '"Price" failed: no stock data',
      });
      const session = await db.repositories.sessions.create({ title: 'Chat' });
      await pulses.createPulse({
        kind: 'reminder',
        name: 'Call Ana',
        prompt: 'Call Ana',
        sessionId: session.id,
        schedule: { at: new Date(Date.now() + 60 * 60_000).toISOString() },
      });
      const facts = await collectBriefingFacts({
        taskService: {
          listPendingApprovals: async () =>
            [{ title: 'Approve quote', taskTitle: 'Quotes' }] as never,
        },
        workflowRuns: db.repositories.workflowRuns,
        tasks: db.repositories.tasks,
        jobs: db.repositories.jobs,
        timezone: TZ,
      });
      expect(facts).toEqual(
        expect.arrayContaining([
          `Waiting for the owner's approval: "Approve quote" in workflow "Quotes".`,
          'Workflow "Quotes" failed: "Price" failed: no stock data.',
        ]),
      );
    });

    it('tells the owner about approvals and failures', async () => {
      await assistant.onWorkflowEvent(
        { type: 'approval.waiting', subtask: { title: 'Approve quote' } },
        'Quotes',
      );
      await assistant.onWorkflowEvent(
        { type: 'run.finished', run: { status: 'failed', error: 'boom' } },
        'Quotes',
      );
      await assistant.onWorkflowEvent(
        { type: 'run.finished', run: { status: 'completed', error: null } },
        'Quotes',
      );
      expect(sent.map((s) => s.text)).toEqual([
        '⏳ "Quotes" needs your approval: Approve quote. Open it in OpenAidy to approve or reject.',
        '⚠️ "Quotes" failed: boom',
      ]);
      owner = { ...OWNER, notifyWorkflowEvents: false };
      await assistant.onWorkflowEvent(
        { type: 'run.finished', run: { status: 'failed', error: 'again' } },
        'Quotes',
      );
      expect(sent).toHaveLength(2);
    });
  });
});
