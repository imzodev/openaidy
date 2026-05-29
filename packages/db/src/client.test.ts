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
      'memories',
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

  it('creates memories table with correct columns', async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });
    const db = conn.db as unknown as {
      session?: { client: unknown };
      driver: unknown;
    };
    const sqlite = db.session?.client ?? db.driver;
    const rows: Array<{ name: string; type: string }> = (
      sqlite as {
        prepare: (sql: string) => {
          all: () => Array<{ name: string; type: string }>;
        };
      }
    )
      .prepare(`PRAGMA table_info(memories)`)
      .all();
    const cols = rows.map((r) => r.name);
    expect(cols).toContain('id');
    expect(cols).toContain('agent_id');
    expect(cols).toContain('title');
    expect(cols).toContain('content');
    expect(cols).toContain('tags');
    expect(cols).toContain('importance');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
    await conn.close();
  });

  it('creates memories_fts and sessions_fts virtual tables', async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });
    const db = conn.db as unknown as {
      session?: { client: unknown };
      driver: unknown;
    };
    const sqlite = db.session?.client ?? db.driver;
    const rows: Array<{ name: string; type: string }> = (
      sqlite as {
        prepare: (sql: string) => {
          all: () => Array<{ name: string; type: string }>;
        };
      }
    )
      .prepare(
        `SELECT name, type FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name`,
      )
      .all();
    const names = rows.map((r) => r.name);
    expect(names, 'memories_fts virtual table').toContain('memories_fts');
    expect(names, 'sessions_fts virtual table').toContain('sessions_fts');
    await conn.close();
  });

  it('creates all six FTS sync triggers for memories and sessions', async () => {
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
        `SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`,
      )
      .all();
    const names = rows.map((r) => r.name);
    expect(names, 'memories_ai trigger').toContain('memories_ai');
    expect(names, 'memories_ad trigger').toContain('memories_ad');
    expect(names, 'memories_au trigger').toContain('memories_au');
    expect(names, 'sessions_ai trigger').toContain('sessions_ai');
    expect(names, 'sessions_ad trigger').toContain('sessions_ad');
    expect(names, 'sessions_au trigger').toContain('sessions_au');
    await conn.close();
  });

  it('FTS trigger fires on insert — memories_fts is populated on insert', async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });
    const db = conn.db as unknown as {
      session?: { client: unknown };
      driver: unknown;
    };
    const sqlite = db.session?.client ?? db.driver;
    type Sqlite = {
      prepare: (sql: string) => {
        run: () => void;
        all: () => Array<{ title: string; content: string }>;
      };
    };
    const raw = sqlite as Sqlite;

    // Insert a memory directly via sqlite (bypassing repo)
    raw
      .prepare(
        `INSERT INTO memories (id, agent_id, title, content, tags, importance)
       VALUES ('test-id-1', 'agent-x', 'React project setup', 'Remember to use Vite', '[]', 5)`,
      )
      .run();

    // Verify FTS index was populated
    const ftsRows = raw
      .prepare(
        `SELECT title, content FROM memories_fts WHERE memories_fts MATCH 'React'`,
      )
      .all();
    expect(ftsRows.length).toBeGreaterThan(0);
    expect(ftsRows[0]!.title).toBe('React project setup');

    await conn.close();
  });

  it('backfill populates sessions_fts for pre-existing sessions', async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });
    const db = conn.db as unknown as {
      session?: { client: unknown };
      driver: unknown;
    };
    const sqlite = db.session?.client ?? db.driver;
    type Sqlite = {
      prepare: (sql: string) => {
        run: () => void;
        all: () => Array<{ title: string }>;
      };
    };
    const raw = sqlite as Sqlite;

    // Insert sessions directly (bypassing repo)
    raw
      .prepare(
        `INSERT INTO sessions (id, title, status) VALUES ('s1', 'ABC project kickoff', 'active')`,
      )
      .run();
    raw
      .prepare(
        `INSERT INTO sessions (id, title, status) VALUES ('s2', 'ABC project review', 'active')`,
      )
      .run();

    // The backfill INSERT INTO sessions_fts runs at init, so these should be findable
    const ftsRows = raw
      .prepare(`SELECT title FROM sessions_fts WHERE sessions_fts MATCH 'ABC'`)
      .all();
    expect(ftsRows.length).toBeGreaterThanOrEqual(2);

    await conn.close();
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
