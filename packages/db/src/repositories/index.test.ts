import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema/sessions';
import { SessionsRepository } from './sessions';
import { SessionMessagesRepository } from './session-messages';
import { SessionRunsRepository } from './session-runs';

// Typed database
type Database = NodePgDatabase<typeof schema>;

/**
 * Integration tests for session repositories
 * 
 * These tests require a PostgreSQL database. Set DATABASE_URL to run.
 */
describe('Session Repositories (integration)', () => {
  // Skip tests if no DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  const shouldRun = !!databaseUrl;

  let pool: Pool | undefined;
  let db: Database | undefined;
  let sessionsRepo: SessionsRepository | undefined;
  let messagesRepo: SessionMessagesRepository | undefined;
  let runsRepo: SessionRunsRepository | undefined;

  beforeEach(async () => {
    if (!shouldRun || !databaseUrl) return;

    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema }) as Database;
    
    sessionsRepo = new SessionsRepository(db);
    messagesRepo = new SessionMessagesRepository(db);
    runsRepo = new SessionRunsRepository(db);

    // Clean up test data
    await db.delete(schema.sessionRuns);
    await db.delete(schema.sessionMessages);
    await db.delete(schema.sessions);
  });

  afterEach(async () => {
    if (pool) {
      await pool.end();
    }
  });

  // Mark tests as skipped when no database
  const test = shouldRun ? it : it.skip;

  describe('SessionsRepository', () => {
    test('should create a session', async () => {
      const session = await sessionsRepo!.create({ title: 'Test Session' });
      
      expect(session.id).toBeDefined();
      expect(session.title).toBe('Test Session');
      expect(session.status).toBe('active');
      expect(session.createdAt).toBeInstanceOf(Date);
    });

    test('should find session by id', async () => {
      const created = await sessionsRepo!.create({ title: 'Find Me' });
      const found = await sessionsRepo!.findById(created.id);
      
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.title).toBe('Find Me');
    });

    test('should list sessions', async () => {
      await sessionsRepo!.create({ title: 'Session 1' });
      await sessionsRepo!.create({ title: 'Session 2' });
      
      const list = await sessionsRepo!.list();
      expect(list).toHaveLength(2);
    });

    test('should update session status', async () => {
      const session = await sessionsRepo!.create({ title: 'To Archive' });
      const updated = await sessionsRepo!.updateStatus(session.id, 'archived');
      
      expect(updated?.status).toBe('archived');
      expect(updated?.archivedAt).toBeInstanceOf(Date);
    });
  });

  describe('SessionMessagesRepository', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await sessionsRepo!.create({ title: 'Messages Test' });
      sessionId = session.id;
    });

    test('should append messages in order', async () => {
      const msg1 = await messagesRepo!.append({
        sessionId,
        role: 'user',
        content: 'Hello',
      });
      const msg2 = await messagesRepo!.append({
        sessionId,
        role: 'assistant',
        content: 'Hi there!',
      });

      expect(msg1.sequence).toBe(1);
      expect(msg2.sequence).toBe(2);

      const messages = await messagesRepo!.listBySession(sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[0]?.content).toBe('Hello');
      expect(messages[1]?.content).toBe('Hi there!');
    });

    test('should get latest message', async () => {
      await messagesRepo!.append({ sessionId, role: 'user', content: 'First' });
      await messagesRepo!.append({ sessionId, role: 'assistant', content: 'Second' });
      
      const latest = await messagesRepo!.getLatest(sessionId);
      expect(latest?.content).toBe('Second');
    });

    test('should count messages', async () => {
      await messagesRepo!.append({ sessionId, role: 'user', content: 'A' });
      await messagesRepo!.append({ sessionId, role: 'assistant', content: 'B' });
      
      const count = await messagesRepo!.countBySession(sessionId);
      expect(count).toBe(2);
    });

    test('should isolate messages between sessions', async () => {
      const otherSession = await sessionsRepo!.create({ title: 'Other' });
      
      await messagesRepo!.append({ sessionId, role: 'user', content: 'Session 1' });
      await messagesRepo!.append({ sessionId: otherSession.id, role: 'user', content: 'Session 2' });
      
      const session1Messages = await messagesRepo!.listBySession(sessionId);
      const session2Messages = await messagesRepo!.listBySession(otherSession.id);
      
      expect(session1Messages).toHaveLength(1);
      expect(session2Messages).toHaveLength(1);
      expect(session1Messages[0]?.content).toBe('Session 1');
      expect(session2Messages[0]?.content).toBe('Session 2');
    });
  });

  describe('SessionRunsRepository', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await sessionsRepo!.create({ title: 'Runs Test' });
      sessionId = session.id;
    });

    test('should create a run in queued status with agentId', async () => {
      const run = await runsRepo!.create({
        sessionId,
        agentId: 'assistant',
        providerId: 'openai',
        modelId: 'gpt-4',
      });

      expect(run.id).toBeDefined();
      expect(run.status).toBe('queued');
      expect(run.agentId).toBe('assistant');
      expect(run.providerId).toBe('openai');
      expect(run.modelId).toBe('gpt-4');
    });

    test('should transition run through states', async () => {
      const run = await runsRepo!.create({
        sessionId,
        agentId: 'assistant',
        providerId: 'test',
        modelId: 'model-1',
      });

      // Queue -> Running
      const running = await runsRepo!.markRunning(run.id);
      expect(running?.status).toBe('running');
      expect(running?.startedAt).toBeInstanceOf(Date);

      // Running -> Succeeded
      const succeeded = await runsRepo!.markSucceeded(run.id, {
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      });
      expect(succeeded?.status).toBe('succeeded');
      expect(succeeded?.finishReason).toBe('stop');
      expect(succeeded?.totalTokens).toBe(30);
    });

    test('should mark run as failed', async () => {
      const run = await runsRepo!.create({
        sessionId,
        agentId: 'assistant',
        providerId: 'test',
        modelId: 'model-1',
      });

      const failed = await runsRepo!.markFailed(run.id, {
        errorCode: 'provider.error',
        errorMessage: 'Something went wrong',
      });

      expect(failed?.status).toBe('failed');
      expect(failed?.errorCode).toBe('provider.error');
      expect(failed?.errorMessage).toBe('Something went wrong');
    });

    test('should get active run', async () => {
      // Create multiple runs
      await runsRepo!.create({ sessionId, agentId: 'agent1', providerId: 'p1', modelId: 'm1' });
      const runningRun = await runsRepo!.create({ sessionId, agentId: 'agent2', providerId: 'p2', modelId: 'm2' });
      
      await runsRepo!.markRunning(runningRun.id);
      
      const active = await runsRepo!.getActive(sessionId);
      expect(active?.id).toBe(runningRun.id);
      expect(active?.status).toBe('running');
    });

    test('should list runs for session with agentId', async () => {
      await runsRepo!.create({ sessionId, agentId: 'agent1', providerId: 'p1', modelId: 'm1' });
      await runsRepo!.create({ sessionId, agentId: 'agent2', providerId: 'p2', modelId: 'm2' });
      
      const runs = await runsRepo!.listBySession(sessionId);
      expect(runs).toHaveLength(2);
      expect(runs[0]?.agentId).toBe('agent2');
      expect(runs[1]?.agentId).toBe('agent1');
    });

    test('should isolate runs between sessions', async () => {
      const otherSession = await sessionsRepo!.create({ title: 'Other' });
      
      await runsRepo!.create({ sessionId, agentId: 'agent1', providerId: 'p1', modelId: 'm1' });
      await runsRepo!.create({ sessionId: otherSession.id, agentId: 'agent2', providerId: 'p2', modelId: 'm2' });
      
      const session1Runs = await runsRepo!.listBySession(sessionId);
      const session2Runs = await runsRepo!.listBySession(otherSession.id);
      
      expect(session1Runs).toHaveLength(1);
      expect(session2Runs).toHaveLength(1);
      expect(session1Runs[0]?.providerId).toBe('p1');
      expect(session1Runs[0]?.agentId).toBe('agent1');
      expect(session2Runs[0]?.providerId).toBe('p2');
      expect(session2Runs[0]?.agentId).toBe('agent2');
    });
  });
});
