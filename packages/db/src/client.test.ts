/**
 * Tests for createDatabaseClient
 *
 * SQLite tests run in every environment (no external DB needed).
 * Postgres tests require DATABASE_URL to be set.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient } from './client';

// -------------------------------------------------------------------------
// SQLite — runs always
// -------------------------------------------------------------------------
describe('createDatabaseClient (sqlite)', () => {
  const dbPath = join(tmpdir(), `openaidy-test-${Date.now()}.db`);

  afterEach(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it('returns a connection with kind=sqlite', async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });
    expect(conn.kind).toBe('sqlite');
    await conn.close();
  });

  it('creates the access_tokens table', async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });

    // Access the underlying better-sqlite3 instance via drizzle's session
    const db = conn.db as unknown as {
      session?: { client: unknown };
      driver: unknown;
    };
    const sqlite = db.session?.client ?? db.driver;
    const rows: Array<{ name: string }> = (
      sqlite as {
        prepare: (sql: string) => { all: () => Array<{ name: string }> };
      }
    )
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='access_tokens'`,
      )
      .all();
    expect(rows.map((r) => r.name)).toContain('access_tokens');

    await conn.close();
  });

  it('creates all expected tables', async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });

    const db = conn.db as unknown as {
      session?: { client: unknown };
      driver: unknown;
    };
    const sqlite = db.session?.client ?? db.driver;
    const rows: Array<{ name: string }> = (
      sqlite as {
        prepare: (sql: string) => { all: () => Array<{ name: string }> };
      }
    )
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      )
      .all();
    const names: string[] = rows.map((r) => r.name);

    const expectedTables = [
      'access_tokens',
      'devices',
      'job_runs',
      'pairing_requests',
      'scheduled_jobs',
      'session_messages',
      'session_runs',
      'sessions',
      'subtasks',
      'task_agents',
      'tasks',
    ];

    for (const table of expectedTables) {
      expect(names, `expected table "${table}" to exist`).toContain(table);
    }

    await conn.close();
  });

  it('is idempotent — calling twice does not throw', async () => {
    await createDatabaseClient({ kind: 'sqlite', sqlitePath: dbPath });
    await expect(
      createDatabaseClient({ kind: 'sqlite', sqlitePath: dbPath }),
    ).resolves.toBeDefined();
  });
});

// -------------------------------------------------------------------------
// Postgres migration — requires DATABASE_URL
// -------------------------------------------------------------------------
describe('createDatabaseClient (postgres)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  const shouldRun = !!databaseUrl;
  const test = shouldRun ? it : it.skip;

  test('returns a connection with kind=postgres and runs migration', async () => {
    const conn = await createDatabaseClient({
      kind: 'postgres',
      connectionString: databaseUrl!,
    });

    expect(conn.kind).toBe('postgres');

    // Verify access_tokens table exists via information_schema
    const rows = await conn.db.execute(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'access_tokens'` as unknown as Parameters<
        typeof conn.db.execute
      >[0],
    );
    const names = (rows.rows ?? rows).map(
      (r: unknown) => (r as { table_name: string }).table_name,
    );
    expect(names).toContain('access_tokens');

    await conn.close();
  });

  test('migration is idempotent — running twice does not throw', async () => {
    const conn1 = await createDatabaseClient({
      kind: 'postgres',
      connectionString: databaseUrl!,
    });
    await conn1.close();

    await expect(
      createDatabaseClient({
        kind: 'postgres',
        connectionString: databaseUrl!,
      }),
    ).resolves.toBeDefined();
  });
});
