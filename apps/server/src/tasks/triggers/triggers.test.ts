/**
 * Workflow trigger tests: webhooks and channel messages starting runs,
 * the run input reaching the steps, and results going back to the chat.
 * Real SQLite, a scripted session service and a recording fake channel.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import {
  createDatabaseAdapter,
  type DatabaseAdapter,
  type Task,
} from '@openaidy/db';
import { DEFAULT_EXECUTION_CONFIG } from '@openaidy/config';
import { TaskService, type TaskServiceOptions } from '../service';
import { FakeSessions, deferred } from '../testing/fake-sessions';
import { WorkflowTriggerService } from './service';
import { messageMatches, senderAllowed } from './matcher';
import {
  webhookRoutes,
  workflowTriggerRoutes,
} from '../../routes/workflow-triggers';
import type { AuthMiddleware } from '../../websocket/middleware/auth';
import { createLogger } from '../../lib/logger';
import { createWorkflowTriggerTools } from '../../tools/workflows/triggers';

const CTX = { agentId: 'concierge', sessionId: 'chat' };

describe('messageMatches', () => {
  it('matches by type, ignoring case and spaces', () => {
    expect(messageMatches({ type: 'any' }, 'hi')).toBe(true);
    expect(messageMatches({ type: 'equals', value: 'Quote' }, ' quote ')).toBe(
      true,
    );
    expect(messageMatches({ type: 'equals', value: 'quote' }, 'quote me')).toBe(
      false,
    );
    expect(
      messageMatches({ type: 'starts_with', value: 'quote' }, 'QUOTE 3 chairs'),
    ).toBe(true);
    expect(
      messageMatches({ type: 'contains', value: 'invoice' }, 'my Invoice pls'),
    ).toBe(true);
    expect(
      messageMatches({ type: 'regex', value: '^order #\\d+' }, 'Order #42'),
    ).toBe(true);
    expect(messageMatches({ type: 'regex', value: '(' }, 'x')).toBe(false);
    expect(messageMatches({ type: 'starts_with', value: '' }, 'x')).toBe(false);
  });

  it('narrows to listed senders, accepting bare phone numbers', () => {
    expect(senderAllowed(undefined, ['a'])).toBe(true);
    expect(
      senderAllowed(['+52 1 555 000 1111'], ['5215550001111@s.whatsapp.net']),
    ).toBe(true);
    expect(
      senderAllowed(['5215550001111'], ['5215550001111@s.whatsapp.net']),
    ).toBe(true);
    expect(senderAllowed(['other'], ['5215550001111@s.whatsapp.net'])).toBe(
      false,
    );
  });
});

describe('workflow triggers', { timeout: 20000 }, () => {
  let dir: string;
  let db: DatabaseAdapter;
  let sessions: FakeSessions;
  let service: TaskService;
  let triggers: WorkflowTriggerService;
  let task: Task;
  let sent: Array<{ channelId: string; target: string; text: string }>;
  let channelUp: boolean;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'openaidy-triggers-'));
    db = await createDatabaseAdapter({
      kind: 'sqlite',
      sqlitePath: join(dir, 'openaidy.db'),
    });
    sessions = new FakeSessions(db);
    service = new TaskService({
      tasksRepo: db.repositories.tasks,
      subtasksRepo: db.repositories.subtasks,
      taskAgentsRepo: db.repositories.taskAgents,
      workflowRunsRepo: db.repositories.workflowRuns,
      sessionService: sessions as unknown as NonNullable<
        TaskServiceOptions['sessionService']
      >,
      getExecutionConfig: () => DEFAULT_EXECUTION_CONFIG,
    });
    sent = [];
    channelUp = true;
    triggers = new WorkflowTriggerService({
      triggersRepo: db.repositories.workflowTriggers,
      taskService: service,
      listChannelIds: () => ['wa', 'discord'],
      sendToChannel: async (channelId, target, text) => {
        if (!channelUp) return false;
        sent.push({ channelId, target, text });
        return true;
      },
      logger: createLogger('test'),
    });
    task = await db.repositories.tasks.create({
      title: 'Quotes',
      description: 'Answer quote requests',
      planningEnabled: true,
    });
    await service.setWorkflowGraph(task.id, {
      nodes: [
        { key: 'price', title: 'Price', description: 'STEP-PRICE' },
        { key: 'reply', title: 'Reply', description: 'STEP-REPLY' },
      ],
      edges: [{ from: 'price', to: 'reply' }],
    });
  });

  afterEach(async () => {
    await service.whenIdle();
    triggers.destroy();
    service.destroy();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const latestRun = () => db.repositories.workflowRuns.findLatest(task.id);

  const channelTrigger = (
    overrides: Partial<
      Parameters<WorkflowTriggerService['createChannelTrigger']>[1]['config']
    > = {},
  ) =>
    triggers.createChannelTrigger(task.id, {
      config: {
        channelId: 'wa',
        match: { type: 'starts_with', value: 'quote' },
        replyWithResult: true,
        ...overrides,
      },
    });

  const message = (text: string, sender = '5215550001111@s.whatsapp.net') =>
    triggers.handleChannelMessage({
      channelId: 'wa',
      senderIds: [sender],
      text,
      replyTarget: 'chat-1@s.whatsapp.net',
    });

  describe('run input', () => {
    it('reaches every step', async () => {
      await service.startRun(task.id, { input: 'Customer wants 3 chairs' });
      await service.whenIdle();
      const steps = sessions.stepTurns();
      expect(steps).toHaveLength(2);
      for (const turn of steps) {
        expect(turn.content).toContain(
          '**Workflow input** (what started this run):\nCustomer wants 3 chairs',
        );
      }
      expect((await latestRun())?.input).toBe('Customer wants 3 chairs');
    });

    it('is left out when there is none', async () => {
      await service.startRun(task.id);
      await service.whenIdle();
      expect(sessions.stepTurns()[0]?.content).not.toContain('Workflow input');
    });
  });

  describe('webhooks', () => {
    it('starts a run with the request as input, only with the right token', async () => {
      const created = await triggers.createWebhook(task.id, 'Form');
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const { trigger, token } = created.data;
      expect(trigger.webhookPath).toBe(`/api/hooks/${trigger.id}`);
      const stored = await db.repositories.workflowTriggers.findById(
        trigger.id,
      );
      expect(stored?.secretHash).not.toContain(token);

      const wrong = await triggers.fireWebhook(trigger.id, {
        token: 'nope',
        contentType: 'application/json',
        body: {},
        query: {},
      });
      expect(!wrong.ok && wrong.error.code).toBe('trigger.unauthorized');
      expect(await latestRun()).toBeNull();

      const fired = await triggers.fireWebhook(trigger.id, {
        token,
        contentType: 'application/json',
        body: { name: 'Ada', items: 3 },
        query: { token, source: 'form' },
      });
      expect(fired.ok).toBe(true);
      const run = await latestRun();
      expect(run?.trigger).toBe('webhook');
      expect(run?.input).toContain('Webhook "Form" received a request.');
      expect(run?.input).toContain('"name": "Ada"');
      expect(run?.input).toContain('Query: source=form');
      expect(run?.input).not.toContain(token);
      expect(
        (await db.repositories.workflowTriggers.findById(trigger.id))
          ?.lastFiredAt,
      ).toBeInstanceOf(Date);
    });

    it('refuses while a run is going, and when disabled or regenerated', async () => {
      const created = await triggers.createWebhook(task.id);
      if (!created.ok) throw new Error('setup');
      const { trigger, token } = created.data;
      const gate = deferred<string>();
      sessions.reply = () => gate.promise;
      const fire = (t = token) =>
        triggers.fireWebhook(trigger.id, {
          token: t,
          contentType: undefined,
          body: '',
          query: {},
        });

      expect((await fire()).ok).toBe(true);
      const busy = await fire();
      expect(!busy.ok && busy.error.code).toBe('workflow.already_running');
      gate.resolve('Done.');
      await service.whenIdle();

      await triggers.update(trigger.id, { enabled: false });
      const disabled = await fire();
      expect(!disabled.ok && disabled.error.code).toBe('trigger.not_found');

      await triggers.update(trigger.id, { enabled: true });
      const regenerated = await triggers.regenerateToken(trigger.id);
      if (!regenerated.ok) throw new Error('regenerate');
      const old = await fire();
      expect(!old.ok && old.error.code).toBe('trigger.unauthorized');
      expect((await fire(regenerated.data.token)).ok).toBe(true);
    });

    it('accepts JSON, form and text bodies over HTTP', async () => {
      const created = await triggers.createWebhook(task.id);
      if (!created.ok) throw new Error('setup');
      const { trigger, token } = created.data;
      const app = Fastify();
      await app.register(webhookRoutes, {
        triggerService: triggers,
        prefix: '/api',
      });

      const unauthorized = await app.inject({
        method: 'POST',
        url: trigger.webhookPath!,
        payload: { a: 1 },
      });
      expect(unauthorized.statusCode).toBe(401);
      const missing = await app.inject({
        method: 'POST',
        url: '/api/hooks/nope',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(missing.statusCode).toBe(404);

      const cases = [
        {
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload: JSON.stringify({ name: 'Ada' }),
          expected: '"name": "Ada"',
        },
        {
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: 'name=Grace&items=2',
          url: `${trigger.webhookPath}?token=${token}`,
          expected: '"name": "Grace"',
        },
        {
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'text/plain',
          },
          payload: 'hello there',
          expected: 'Body:\nhello there',
        },
        {
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/xml',
          },
          payload: '<order id="7"/>',
          expected: '<order id="7"/>',
        },
      ];
      for (const c of cases) {
        const res = await app.inject({
          method: 'POST',
          url: c.url ?? trigger.webhookPath!,
          headers: c.headers,
          payload: c.payload,
        });
        expect(res.statusCode).toBe(202);
        expect(JSON.parse(res.body).data.runId).toBeTruthy();
        await service.whenIdle();
        expect((await latestRun())?.input).toContain(c.expected);
      }
      await app.close();
    });

    it('returns 422 when the workflow can’t run', async () => {
      const created = await triggers.createWebhook(task.id);
      if (!created.ok) throw new Error('setup');
      await db.repositories.subtasks.create({
        taskId: task.id,
        title: 'Broken',
        description: '',
      });
      const app = Fastify();
      await app.register(webhookRoutes, {
        triggerService: triggers,
        prefix: '/api',
      });
      const res = await app.inject({
        method: 'POST',
        url: created.data.trigger.webhookPath!,
        headers: { authorization: `Bearer ${created.data.token}` },
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });
  });

  describe('channel messages', () => {
    it('validates the rule and the channel', async () => {
      const unknown = await channelTrigger({ channelId: 'telegram' });
      expect(!unknown.ok && unknown.error.message).toContain(
        'Available: wa, discord',
      );
      const noValue = await channelTrigger({
        match: { type: 'contains' },
      });
      expect(!noValue.ok && noValue.error.message).toContain('needs a value');
      const badRegex = await channelTrigger({
        match: { type: 'regex', value: '(' },
      });
      expect(!badRegex.ok && badRegex.error.message).toContain(
        'regular expression',
      );
      const ok = await channelTrigger();
      expect(ok.ok && ok.data.name).toBe('Starts with "quote" on wa');
    });

    it('starts a run from a matching message and replies with the result', async () => {
      await channelTrigger();
      sessions.reply = (turn) =>
        turn.content.includes('STEP-REPLY')
          ? 'Your quote is $300.\nOUTCOME: done'
          : 'Priced.';

      expect(await message('hello')).toBeNull();
      const ack = await message('Quote for 3 chairs');
      expect(ack).toBe('On it — running "Quotes".');
      await service.whenIdle();

      const run = await latestRun();
      expect(run?.trigger).toBe('channel');
      expect(run?.input).toBe(
        'Message from 5215550001111@s.whatsapp.net:\nQuote for 3 chairs',
      );
      expect(run?.status).toBe('completed');
      expect(sent).toEqual([
        {
          channelId: 'wa',
          target: 'chat-1@s.whatsapp.net',
          text: 'Your quote is $300.',
        },
      ]);
    });

    it('only accepts listed senders and the right channel', async () => {
      await channelTrigger({ senders: ['5215550001111'] });
      expect(await message('quote', 'someone-else@s.whatsapp.net')).toBeNull();
      expect(
        await triggers.handleChannelMessage({
          channelId: 'discord',
          senderIds: ['5215550001111@s.whatsapp.net'],
          text: 'quote',
          replyTarget: 'c',
        }),
      ).toBeNull();
      expect(await message('quote')).not.toBeNull();
    });

    it('tells the sender when the workflow is busy, and uses the custom reply', async () => {
      await channelTrigger({ ackText: 'Got it!' });
      const gate = deferred<string>();
      sessions.reply = () => gate.promise;
      expect(await message('quote 1')).toBe('Got it!');
      expect(await message('quote 2')).toBe(
        '"Quotes" is already running. Send your message again once it has finished.',
      );
      gate.resolve('Done.');
      await service.whenIdle();
    });

    it('reports failures, waiting approvals, and stays quiet when told to', async () => {
      await service.setWorkflowGraph(task.id, {
        nodes: [
          { key: 'draft', title: 'Draft', description: 'STEP-DRAFT' },
          { key: 'ok', title: 'Sign-off', kind: 'approval_gate' },
        ],
        edges: [{ from: 'draft', to: 'ok' }],
      });
      await channelTrigger();
      await message('quote');
      await service.whenIdle();
      expect(sent.map((s) => s.text)).toEqual([
        '"Quotes" is waiting for your approval in OpenAidy: Sign-off.',
      ]);
      await service.cancelRun(task.id);
      await service.whenIdle();
      expect(sent.at(-1)?.text).toBe('"Quotes" was stopped.');

      sessions.reply = () => ({ fail: 'model down' });
      await message('quote again');
      await service.whenIdle();
      expect(sent.at(-1)?.text).toMatch(/^"Quotes" couldn't finish: /);

      const all = await triggers.listAll('channel_message');
      await triggers.update(all[0]!.id, {
        channel: { replyWithResult: false },
      });
      const before = sent.length;
      sessions.reply = () => 'Done.';
      await message('quote silently');
      await service.whenIdle();
      expect(sent.length).toBe(before);
    });

    it('survives a channel that is offline when the run ends', async () => {
      await channelTrigger();
      channelUp = false;
      await message('quote');
      await service.whenIdle();
      expect((await latestRun())?.status).toBe('completed');
      expect(sent).toEqual([]);
    });
  });

  describe('agent tools', () => {
    it('creates, lists and deletes triggers', async () => {
      const [create, list, del] = createWorkflowTriggerTools({
        getTaskService: () => service,
        getTriggerService: () => triggers,
      });
      const hook = await create!.execute(
        { workflowId: task.id, kind: 'webhook', name: 'Form' },
        CTX,
      );
      expect(hook.ok && hook.content).toContain('Token: ');

      const msg = await create!.execute(
        {
          workflowId: task.id,
          kind: 'channel_message',
          channelId: 'wa',
          matchValue: 'quote',
        },
        CTX,
      );
      expect(msg.ok && msg.content).toContain(
        'starts with "quote" on channel wa',
      );

      const bad = await create!.execute(
        { workflowId: task.id, kind: 'channel_message', channelId: 'sms' },
        CTX,
      );
      expect(!bad.ok && bad.error).toContain("doesn't exist");

      const listed = await list!.execute({}, CTX);
      expect(listed.ok && listed.content).toContain('→ workflow "Quotes"');

      const all = await triggers.listAll();
      for (const t of all) {
        expect((await del!.execute({ triggerId: t.id }, CTX)).ok).toBe(true);
      }
      expect(await triggers.listAll()).toEqual([]);
    });
  });

  describe('management routes', () => {
    it('creates, lists, updates and deletes triggers over HTTP', async () => {
      const authMiddleware = {
        validateToken: async () => ({
          sub: 'test',
          scopes: ['*'],
          type: 'access' as const,
          iat: 0,
          exp: 9999999999,
        }),
        extractFromHeader: () => 'token',
        extractFromQuery: () => null,
        hasCapability: () => true,
      } as unknown as AuthMiddleware;
      const app = Fastify();
      await app.register(workflowTriggerRoutes, {
        triggerService: triggers,
        authMiddleware,
        prefix: '/api',
      });
      const call = async (method: string, url: string, payload?: unknown) => {
        const res = await app.inject({
          method: method as 'GET',
          url,
          headers: { authorization: 'Bearer token' },
          ...(payload !== undefined ? { payload: payload as object } : {}),
        });
        return { status: res.statusCode, body: JSON.parse(res.body) };
      };

      const hook = await call('POST', `/api/tasks/${task.id}/triggers`, {
        kind: 'webhook',
        name: 'Form',
      });
      expect(hook.status).toBe(201);
      expect(hook.body.data.token).toBeTruthy();

      const msg = await call('POST', `/api/tasks/${task.id}/triggers`, {
        kind: 'channel_message',
        channel: {
          channelId: 'wa',
          match: { type: 'contains', value: 'quote' },
        },
      });
      expect(msg.status).toBe(201);
      expect(msg.body.data.channel.replyWithResult).toBe(true);

      const bad = await call('POST', `/api/tasks/${task.id}/triggers`, {
        kind: 'channel_message',
        channel: { channelId: 'wa', match: { type: 'sometimes' } },
      });
      expect(bad.status).toBe(400);
      const missing = await call('POST', '/api/tasks/nope/triggers', {
        kind: 'webhook',
      });
      expect(missing.status).toBe(404);

      const listed = await call('GET', `/api/tasks/${task.id}/triggers`);
      expect(listed.body.data).toHaveLength(2);
      const hooks = await call('GET', '/api/workflow-triggers?kind=webhook');
      expect(
        hooks.body.data.map((t: { taskTitle: string }) => t.taskTitle),
      ).toEqual(['Quotes']);

      const patched = await call(
        'PATCH',
        `/api/workflow-triggers/${msg.body.data.id}`,
        {
          enabled: false,
          channel: { match: { type: 'equals', value: 'QUOTE' } },
        },
      );
      expect(patched.body.data).toMatchObject({
        enabled: false,
        channel: { match: { type: 'equals', value: 'QUOTE' } },
      });

      const regenerated = await call(
        'POST',
        `/api/workflow-triggers/${hook.body.data.trigger.id}/regenerate-token`,
      );
      expect(regenerated.body.data.token).not.toBe(hook.body.data.token);

      expect(
        (await call('DELETE', `/api/workflow-triggers/${msg.body.data.id}`))
          .status,
      ).toBe(200);
      expect(
        (await call('DELETE', `/api/workflow-triggers/${msg.body.data.id}`))
          .status,
      ).toBe(404);
      await app.close();
    });
  });
});
