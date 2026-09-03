import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { SessionsRepository } from './sessions';
import { SessionRunsRepository } from './session-runs';

type Database = DatabaseConnection['db'];

describe('SessionRunsRepository', () => {
  let db: Database;
  let sessionsRepo: SessionsRepository;
  let runsRepo: SessionRunsRepository;

  beforeEach(async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: ':memory:',
    });
    db = conn.db;
    sessionsRepo = new SessionsRepository(db);
    runsRepo = new SessionRunsRepository(db);
  });

  describe('markSucceeded', () => {
    it('persists errorCode/errorMessage at the top-level run columns when supplied', async () => {
      const session = await sessionsRepo.create({ title: 'Degraded run' });
      const run = await runsRepo.create({
        sessionId: session.id,
        agentId: 'agent-1',
        providerId: 'mock',
        modelId: 'mock',
      });

      await runsRepo.markSucceeded(run.id, {
        finishReason: 'stop',
        errorCode: 'malformed_tool_call',
        errorMessage:
          'The model emitted tool-call markup as content instead of a structured tool call.',
        metadata: { providerId: 'mock', model: 'mock', degraded: true },
      });

      const fetched = await runsRepo.findById(run.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe('succeeded');
      expect(fetched!.finishReason).toBe('stop');
      // Top-level columns — the path the web layer reads
      // (`apps/web/src/lib/ws-api.ts:460`).
      expect(fetched!.errorCode).toBe('malformed_tool_call');
      expect(fetched!.errorMessage).toBe(
        'The model emitted tool-call markup as content instead of a structured tool call.',
      );
      // Metadata mirror preserved for callers that still read from
      // `run.metadata.*`.
      const metadata = fetched!.metadata as Record<string, unknown> | null;
      expect(metadata).toEqual(
        expect.objectContaining({
          providerId: 'mock',
          model: 'mock',
          degraded: true,
        }),
      );
    });

    it('leaves errorCode/errorMessage null when not supplied (clean success)', async () => {
      const session = await sessionsRepo.create({ title: 'Clean run' });
      const run = await runsRepo.create({
        sessionId: session.id,
        agentId: 'agent-1',
        providerId: 'mock',
        modelId: 'mock',
      });

      await runsRepo.markSucceeded(run.id, {
        finishReason: 'stop',
        metadata: { providerId: 'mock', model: 'mock' },
      });

      const fetched = await runsRepo.findById(run.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe('succeeded');
      expect(fetched!.errorCode).toBeNull();
      expect(fetched!.errorMessage).toBeNull();
    });
  });
});
