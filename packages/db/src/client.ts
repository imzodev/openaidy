import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as accessTokenSchema from './schema/access-tokens';
import * as addonSchema from './schema/addons';
import * as jobSchema from './schema/jobs';
import * as pairingSchema from './schema/pairing';
import * as sessionSchema from './schema/sessions';
import * as providerCredentialsSchema from './schema/provider-credentials';
import * as oauthFlowStateSchema from './schema/oauth-flow-state';

export type DatabaseSchema = typeof sessionSchema &
  typeof jobSchema &
  typeof pairingSchema &
  typeof accessTokenSchema &
  typeof addonSchema &
  typeof providerCredentialsSchema &
  typeof oauthFlowStateSchema;
export type DatabaseClient = ReturnType<typeof JSON.parse>;

export type DatabaseClientConfig =
  | { kind: 'sqlite'; sqlitePath: string }
  | { kind: 'postgres'; connectionString: string };

export type DatabaseConnection = {
  db: DatabaseClient;
  close: () => Promise<void>;
  kind: DatabaseClientConfig['kind'];
  /**
   * Execute a function within a database transaction.
   * For SQLite: uses better-sqlite3's transaction() wrapper
   * For Postgres: uses node-postgres BEGIN/COMMIT/ROLLBACK
   */
  transaction: <T>(fn: (tx: DatabaseClient) => Promise<T>) => Promise<T>;
};

const schema: DatabaseSchema = {
  ...sessionSchema,
  ...jobSchema,
  ...pairingSchema,
  ...accessTokenSchema,
  ...addonSchema,
  ...providerCredentialsSchema,
  ...oauthFlowStateSchema,
};

function initializeSqliteSchema(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'chat',
      status TEXT NOT NULL DEFAULT 'active',
      agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    );


    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_call_id TEXT,
      reasoning_content TEXT,
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
      first_message_id TEXT,
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
    CREATE INDEX IF NOT EXISTS sessions_agent_id_idx ON sessions(agent_id);
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
      retry_count INTEGER NOT NULL DEFAULT 0,
      pending_verification_result TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS subtasks_session_id_idx ON subtasks(session_id);

    CREATE INDEX IF NOT EXISTS tasks_session_id_idx ON tasks(session_id);

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

    -- ------------------------------------------------------------
    -- Recurring tasks (Phase 1): task_schedules + task_execution_history
    -- ------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS task_schedules (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
      cron_expression TEXT,
      preset TEXT,
      schedule_date TEXT,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      replan_policy TEXT NOT NULL DEFAULT 'never',
      max_executions INTEGER NOT NULL DEFAULT 9999,
      execution_count INTEGER NOT NULL DEFAULT 0,
      description_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS task_schedules_next_run_at_idx ON task_schedules(next_run_at);
    CREATE INDEX IF NOT EXISTS task_schedules_status_idx ON task_schedules(status);
    CREATE INDEX IF NOT EXISTS task_schedules_task_id_idx ON task_schedules(task_id);

    CREATE TABLE IF NOT EXISTS task_execution_history (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      schedule_id TEXT NOT NULL REFERENCES task_schedules(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'planned',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      duration_ms INTEGER,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      task_title TEXT NOT NULL,
      task_description TEXT NOT NULL,
      did_replan INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      subtask_summary TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS task_execution_history_task_id_idx ON task_execution_history(task_id);
    CREATE INDEX IF NOT EXISTS task_execution_history_schedule_id_idx ON task_execution_history(schedule_id);
    CREATE INDEX IF NOT EXISTS task_execution_history_session_id_idx ON task_execution_history(session_id);
    CREATE INDEX IF NOT EXISTS task_execution_history_started_at_idx ON task_execution_history(started_at);

    CREATE TABLE IF NOT EXISTS access_tokens (
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

    CREATE INDEX IF NOT EXISTS access_tokens_key_hash_idx ON access_tokens(key_hash);
    CREATE INDEX IF NOT EXISTS access_tokens_revoked_idx ON access_tokens(revoked);

    CREATE TABLE IF NOT EXISTS addons (
      id           TEXT PRIMARY KEY NOT NULL,
      addon_id     TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      version      TEXT NOT NULL,
      manifest     TEXT NOT NULL DEFAULT '{}',
      status       TEXT NOT NULL DEFAULT 'installed',
      permissions  TEXT NOT NULL DEFAULT '[]',
      config       TEXT NOT NULL DEFAULT '{}',
      installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      installed_by TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS addons_status_idx ON addons(status);
    CREATE INDEX IF NOT EXISTS addons_addon_id_idx ON addons(addon_id);

    CREATE TABLE IF NOT EXISTS addon_permission_changes (
      id                TEXT PRIMARY KEY NOT NULL,
      addon_id          TEXT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
      changed_by        TEXT NOT NULL,
      old_permissions   TEXT,
      new_permissions   TEXT,
      reason            TEXT,
      created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS addon_permission_changes_addon_id_idx ON addon_permission_changes(addon_id);

    CREATE TABLE IF NOT EXISTS addon_usage (
      id            TEXT PRIMARY KEY NOT NULL,
      addon_id      TEXT NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
      endpoint      TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      last_used     TEXT,
      date          TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS addon_usage_addon_endpoint_date_idx ON addon_usage(addon_id, endpoint, date);
    CREATE INDEX IF NOT EXISTS addon_usage_addon_id_idx ON addon_usage(addon_id);

    CREATE TABLE IF NOT EXISTS memories (
      id          TEXT PRIMARY KEY NOT NULL,
      agent_id    TEXT NOT NULL,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      importance  INTEGER NOT NULL DEFAULT 3,
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS memories_agent_id_idx  ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS memories_importance_idx ON memories(importance);
    CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories(created_at);

    -- ------------------------------------------------------------
    -- OAuth flow state (Phase 1 of provider-byok-oauth):
    -- Short-lived storage for in-flight PKCE flows between
    -- /start and /callback. Rows are cleaned up by created_at TTL.
    -- ------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS oauth_flow_state (
      state          TEXT PRIMARY KEY,
      provider_id    TEXT NOT NULL,
      code_verifier  TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      region         TEXT,
      redirect_uri   TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS oauth_flow_state_created_at_idx  ON oauth_flow_state(created_at);
    CREATE INDEX IF NOT EXISTS oauth_flow_state_provider_id_idx ON oauth_flow_state(provider_id);

    -- ------------------------------------------------------------
    -- Provider credentials (storage for encrypted API keys + OAuth tokens)
    -- ------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS provider_credentials (
      id           TEXT PRIMARY KEY,
      provider_id  TEXT NOT NULL,
      auth_method  TEXT NOT NULL,
      encrypted_credentials TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'connected',
      last_used_at TEXT,
      error_message TEXT,
      created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_provider_id_idx ON provider_credentials(provider_id);
    CREATE INDEX IF NOT EXISTS provider_credentials_status_idx ON provider_credentials(status);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title,
      content,
      content='memories',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
      INSERT INTO memories_fts(rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;

    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      title,
      content='sessions',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
      INSERT INTO sessions_fts(rowid, title) VALUES (new.rowid, new.title);
    END;

    CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
      INSERT INTO sessions_fts(sessions_fts, rowid, title)
      VALUES ('delete', old.rowid, old.title);
    END;

    CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
      INSERT INTO sessions_fts(sessions_fts, rowid, title)
      VALUES ('delete', old.rowid, old.title);
      INSERT INTO sessions_fts(rowid, title) VALUES (new.rowid, new.title);
    END;

    INSERT INTO sessions_fts(rowid, title)
    SELECT rowid, title FROM sessions
    WHERE rowid NOT IN (SELECT rowid FROM sessions_fts);

    -- Session Messages FTS5 (Option A: Direct content search)
    -- Future enhancements:
    -- Option B: Add 'summary' column and index summaries instead of full content
    -- Option C: Add embedding vectors and use vector similarity search (requires sqlite-vector or pgvector)
    CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
      content,
      session_id UNINDEXED,
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS session_messages_ai AFTER INSERT ON session_messages BEGIN
      INSERT INTO session_messages_fts(rowid, content, session_id)
      VALUES (new.rowid, new.content, new.session_id);
    END;

    CREATE TRIGGER IF NOT EXISTS session_messages_ad AFTER DELETE ON session_messages BEGIN
      INSERT INTO session_messages_fts(session_messages_fts, rowid, content, session_id)
      VALUES ('delete', old.rowid, old.content, old.session_id);
    END;

    CREATE TRIGGER IF NOT EXISTS session_messages_au AFTER UPDATE ON session_messages BEGIN
      INSERT INTO session_messages_fts(session_messages_fts, rowid, content, session_id)
      VALUES ('delete', old.rowid, old.content, old.session_id);
      INSERT INTO session_messages_fts(rowid, content, session_id)
      VALUES (new.rowid, new.content, new.session_id);
    END;
  `);
}

/**
 * Run migrations for SQLite schema updates
 * Handles adding new columns to existing tables
 *
 * TODO: Refactor to a proper migration system
 * - Use a migrations table to track applied migrations
 * - Support reversible migrations (up/down)
 * - Use timestamp/version-based migration files
 * - Handle complex schema changes (table renames, column type changes)
 * - Consider using a library like better-sqlite3-migrations or node-sqlite-migrate
 */
function runSqliteMigrations(sqlite: InstanceType<typeof Database>) {
  // Migration: Add retry_count to subtasks if not exists
  const tableInfo = sqlite.pragma('table_info(subtasks)') as Array<{
    name: string;
  }>;
  const hasRetryCount = tableInfo.some((col) => col.name === 'retry_count');
  if (!hasRetryCount) {
    sqlite.exec(
      `ALTER TABLE subtasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`,
    );
  }

  // Migration: Add pending_verification_result to subtasks if not exists
  const hasPendingVerification = tableInfo.some(
    (col) => col.name === 'pending_verification_result',
  );
  if (!hasPendingVerification) {
    sqlite.exec(
      `ALTER TABLE subtasks ADD COLUMN pending_verification_result TEXT`,
    );
  }

  // Migration: Create subtasks.session_id index if not exists
  const subtaskIndices = sqlite.pragma('index_list(subtasks)') as Array<{
    name: string;
  }>;
  const hasSubtaskSessionIdIdx = subtaskIndices.some(
    (idx) => idx.name === 'subtasks_session_id_idx',
  );
  if (!hasSubtaskSessionIdIdx) {
    sqlite.exec(`CREATE INDEX subtasks_session_id_idx ON subtasks(session_id)`);
  }

  // Migration: Create tasks.session_id index if not exists
  const taskIndices = sqlite.pragma('index_list(tasks)') as Array<{
    name: string;
  }>;
  const hasTaskSessionIdIdx = taskIndices.some(
    (idx) => idx.name === 'tasks_session_id_idx',
  );
  if (!hasTaskSessionIdIdx) {
    sqlite.exec(`CREATE INDEX tasks_session_id_idx ON tasks(session_id)`);
  }

  // Migration: Add run_id to session_messages if not exists
  // Note: SQLite doesn't support adding foreign keys via ALTER TABLE,
  // so we add the column without the constraint (enforced at app level)
  const sessionMessagesInfo = sqlite.pragma(
    'table_info(session_messages)',
  ) as Array<{
    name: string;
  }>;
  const hasRunId = sessionMessagesInfo.some((col) => col.name === 'run_id');
  if (!hasRunId) {
    sqlite.exec(`ALTER TABLE session_messages ADD COLUMN run_id TEXT`);
  }

  // Migration: Create session_messages.run_id index if not exists
  const sessionMessagesIndices = sqlite.pragma(
    'index_list(session_messages)',
  ) as Array<{
    name: string;
  }>;
  const hasRunIdIdx = sessionMessagesIndices.some(
    (idx) => idx.name === 'session_messages_run_id_idx',
  );
  if (!hasRunIdIdx) {
    sqlite.exec(
      `CREATE INDEX session_messages_run_id_idx ON session_messages(run_id)`,
    );
  }

  // Migration: Add reasoning_content to session_messages if not exists
  const hasReasoningContent = sessionMessagesInfo.some(
    (col) => col.name === 'reasoning_content',
  );
  if (!hasReasoningContent) {
    sqlite.exec(
      `ALTER TABLE session_messages ADD COLUMN reasoning_content TEXT`,
    );
  }

  // Migration: Create deliverables table if not exists
  const deliverablesTableInfo = sqlite.pragma(
    'table_info(deliverables)',
  ) as Array<{
    name: string;
  }>;
  if (deliverablesTableInfo.length === 0) {
    sqlite.exec(`
      CREATE TABLE deliverables (
        id           TEXT PRIMARY KEY,
        task_id      TEXT NOT NULL,
        type         TEXT NOT NULL,
        description  TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        format       TEXT,
        size         TEXT,
        path         TEXT,
        url          TEXT,
        version      TEXT,
        metadata     TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    sqlite.exec(
      `CREATE INDEX IF NOT EXISTS deliverables_task_id_idx ON deliverables(task_id)`,
    );
    sqlite.exec(
      `CREATE INDEX IF NOT EXISTS deliverables_status_idx ON deliverables(status)`,
    );
  }

  // Migration: Add first_message_id to session_runs if not exists
  const sessionRunsInfo = sqlite.pragma('table_info(session_runs)') as Array<{
    name: string;
  }>;
  const hasFirstMessageId = sessionRunsInfo.some(
    (col) => col.name === 'first_message_id',
  );
  if (!hasFirstMessageId) {
    sqlite.exec(`ALTER TABLE session_runs ADD COLUMN first_message_id TEXT`);
  }

  // Migration: Add subtask_summary to task_execution_history if not exists
  const historyInfo = sqlite.pragma(
    'table_info(task_execution_history)',
  ) as Array<{ name: string }>;
  const hasSubtaskSummary = historyInfo.some(
    (col) => col.name === 'subtask_summary',
  );
  if (!hasSubtaskSummary) {
    sqlite.exec(
      `ALTER TABLE task_execution_history ADD COLUMN subtask_summary TEXT`,
    );
  }
}

export async function createDatabaseClient(
  config: DatabaseClientConfig,
): Promise<DatabaseConnection> {
  if (config.kind === 'sqlite') {
    mkdirSync(dirname(config.sqlitePath), { recursive: true });
    const sqlite = new Database(config.sqlitePath);
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    initializeSqliteSchema(sqlite);
    runSqliteMigrations(sqlite);

    const db = drizzleSqlite(sqlite, { schema }) as DatabaseClient;
    return {
      db,
      kind: 'sqlite',
      close: async () => {
        sqlite.close();
      },
      // SQLite transactions via better-sqlite3's explicit transaction wrapper
      transaction: async <T>(
        fn: (tx: DatabaseClient) => Promise<T>,
      ): Promise<T> => {
        const tx = sqlite.transaction(() => fn(db));
        return tx() as T;
      },
    };
  }

  const pool = new Pool({ connectionString: config.connectionString });

  const migrationSql = readFileSync(
    resolve(
      fileURLToPath(import.meta.url),
      '../../drizzle/0001_initial_schema.sql',
    ),
    'utf-8',
  );
  const runningStatusMigrationSql = readFileSync(
    resolve(
      fileURLToPath(import.meta.url),
      '../../drizzle/0010_add_running_status.sql',
    ),
    'utf-8',
  );
  const client = await pool.connect();
  try {
    await client.query(migrationSql);
    await client.query(runningStatusMigrationSql);
  } finally {
    client.release();
  }

  const db = drizzlePostgres(pool, { schema }) as DatabaseClient;
  return {
    db,
    kind: 'postgres',
    close: async () => {
      await pool.end();
    },
    // Postgres transactions using node-postgres client
    transaction: async <T>(
      fn: (tx: DatabaseClient) => Promise<T>,
    ): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDb = drizzlePostgres(client, { schema }) as DatabaseClient;
        const result = await fn(txDb);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
