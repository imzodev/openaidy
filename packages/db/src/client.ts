import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as jobSchema from './schema/jobs';
import * as sessionSchema from './schema/sessions';

export type DatabaseSchema = typeof sessionSchema & typeof jobSchema;
type RawDatabaseClient = NodePgDatabase<DatabaseSchema> | BetterSQLite3Database<DatabaseSchema>;

export type DatabaseClient = any;

export type DatabaseClientConfig =
  | { kind: 'sqlite'; sqlitePath: string }
  | { kind: 'postgres'; connectionString: string };

export type DatabaseConnection = {
  db: DatabaseClient;
  close: () => Promise<void>;
  kind: DatabaseClientConfig['kind'];
};

const schema: DatabaseSchema = {
  ...sessionSchema,
  ...jobSchema,
};

function initializeSqliteSchema(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_call_id TEXT,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_runs (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      finish_reason TEXT,
      error_code TEXT,
      error_message TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      schedule TEXT,
      cron_expression TEXT,
      target_type TEXT NOT NULL,
      target_session_id TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      backoff_ms INTEGER NOT NULL DEFAULT 1000,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (target_session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at TEXT,
      finished_at TEXT,
      error_code TEXT,
      error_message TEXT,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      result_data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES scheduled_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS session_messages_session_id_idx ON session_messages(session_id);
    CREATE INDEX IF NOT EXISTS session_messages_sequence_idx ON session_messages(sequence);
    CREATE INDEX IF NOT EXISTS session_runs_session_id_idx ON session_runs(session_id);
    CREATE INDEX IF NOT EXISTS session_runs_created_at_idx ON session_runs(created_at);
    CREATE INDEX IF NOT EXISTS scheduled_jobs_next_run_at_idx ON scheduled_jobs(next_run_at);
    CREATE INDEX IF NOT EXISTS scheduled_jobs_status_idx ON scheduled_jobs(status);
    CREATE INDEX IF NOT EXISTS scheduled_jobs_type_idx ON scheduled_jobs(type);
    CREATE INDEX IF NOT EXISTS job_runs_job_id_idx ON job_runs(job_id);
    CREATE INDEX IF NOT EXISTS job_runs_status_idx ON job_runs(status);
    CREATE INDEX IF NOT EXISTS job_runs_created_at_idx ON job_runs(created_at);
  `);
}

export function createDatabaseClient(config: DatabaseClientConfig): DatabaseConnection {
  if (config.kind === 'sqlite') {
    mkdirSync(dirname(config.sqlitePath), { recursive: true });
    const sqlite = new Database(config.sqlitePath);
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    initializeSqliteSchema(sqlite);

    return {
      db: drizzleSqlite(sqlite, { schema }) as DatabaseClient,
      kind: 'sqlite',
      close: async () => {
        sqlite.close();
      },
    };
  }

  const pool = new Pool({ connectionString: config.connectionString });

  return {
    db: drizzlePostgres(pool, { schema }) as DatabaseClient,
    kind: 'postgres',
    close: async () => {
      await pool.end();
    },
  };
}
