import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as apiKeySchema from './schema/api-keys';
import * as jobSchema from './schema/jobs';
import * as pairingSchema from './schema/pairing';
import * as sessionSchema from './schema/sessions';

export type DatabaseSchema = typeof sessionSchema &
  typeof jobSchema &
  typeof pairingSchema &
  typeof apiKeySchema;
export type DatabaseClient = ReturnType<typeof JSON.parse>;

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
  ...pairingSchema,
  ...apiKeySchema,
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

    CREATE TABLE IF NOT EXISTS pairing_requests (
      id TEXT PRIMARY KEY NOT NULL,
      pairing_code TEXT NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      requested_capabilities TEXT NOT NULL,
      granted_scopes TEXT,
      metadata TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT,
      denied_at TEXT,
      denied_by TEXT,
      node_id TEXT,
      token TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
      node_id TEXT PRIMARY KEY NOT NULL,
      pairing_request_id TEXT,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      scopes TEXT NOT NULL,
      metadata TEXT,
      token TEXT,
      token_hash TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pairing_request_id) REFERENCES pairing_requests(id) ON DELETE SET NULL
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
    CREATE INDEX IF NOT EXISTS pairing_requests_pairing_code_idx ON pairing_requests(pairing_code);
    CREATE INDEX IF NOT EXISTS pairing_requests_status_idx ON pairing_requests(status);
    CREATE INDEX IF NOT EXISTS pairing_requests_token_idx ON pairing_requests(token);
    CREATE INDEX IF NOT EXISTS devices_pairing_request_id_idx ON devices(pairing_request_id);
    CREATE INDEX IF NOT EXISTS devices_status_idx ON devices(status);
    CREATE INDEX IF NOT EXISTS devices_token_idx ON devices(token);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'medium',
      planning_enabled INTEGER NOT NULL DEFAULT 0,
      planning_status TEXT,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      parent_subtask_id TEXT REFERENCES subtasks(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_agent_id TEXT,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_agents (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'primary',
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (task_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
    CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS subtasks_task_id_idx ON subtasks(task_id);
    CREATE INDEX IF NOT EXISTS subtasks_status_idx ON subtasks(status);
    CREATE INDEX IF NOT EXISTS task_agents_task_id_idx ON task_agents(task_id);
    CREATE INDEX IF NOT EXISTS task_agents_agent_id_idx ON task_agents(agent_id);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS api_keys_revoked_idx ON api_keys(revoked);
  `);
}

export function createDatabaseClient(
  config: DatabaseClientConfig,
): DatabaseConnection {
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
