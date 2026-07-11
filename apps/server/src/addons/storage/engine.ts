/**
 * Addon storage engine — per-addon SQLite storage.
 *
 * Each addon gets its own SQLite file at `<addonsDir>/<addonId>/data/store.db`,
 * opened lazily via Node's built-in `node:sqlite`. Because the file is the
 * addon's own, the addon's UI can run raw SQL against it safely — the blast
 * radius is that single file. Two guardrails keep it that way:
 *
 *   - Extension loading is never enabled (node:sqlite has it off by default),
 *     so `load_extension()` is rejected as "not authorized".
 *   - `ATTACH`/`DETACH` are denied at the SQL layer (node:sqlite exposes no
 *     authorizer / limit API), so an addon cannot reach the main DB or any
 *     other file.
 *
 * This is defense-in-depth for a self-hosted, single-user tool where the
 * realistic hazard is a buggy or AI-generated addon, not a cross-tenant
 * attacker. Quotas are soft (warn/log), not hard failures.
 *
 * Schema is declared by the addon as `manifest.storage.migrations` (an ordered
 * list of DDL strings) and applied lazily the first time the DB is opened, so
 * tables exist even when no addon UI has run (e.g. an agent writing headless).
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface StorageQuotas {
  /** Soft cap on the addon DB file size; exceeding it logs a warning. */
  maxBytes: number;
  /** Maximum rows returned by a single query/search. */
  maxRows: number;
}

export const DEFAULT_QUOTAS: StorageQuotas = {
  maxBytes: 100 * 1024 * 1024, // 100 MB (soft)
  maxRows: 10_000,
};

export type StorageParams =
  | readonly unknown[]
  | Record<string, unknown>
  | undefined;

export interface ExecResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface StorageLogger {
  warn: (message: string, meta?: unknown) => void;
}

export type StorageErrorCode =
  | 'FORBIDDEN_SQL'
  | 'MIGRATION_FAILED'
  | 'INVALID_ARG'
  | 'QUERY_FAILED';

export class AddonStorageError extends Error {
  constructor(
    message: string,
    readonly code: StorageErrorCode,
  ) {
    super(message);
    this.name = 'AddonStorageError';
  }
}

interface Handle {
  db: DatabaseSync;
  lastUsed: number;
}

/** Safe SQL identifier (used to validate a caller-supplied FTS table name). */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class AddonStorageEngine {
  private readonly handles = new Map<string, Handle>();

  constructor(
    private readonly addonsDir: string,
    private readonly quotas: StorageQuotas = DEFAULT_QUOTAS,
    private readonly logger: StorageLogger = { warn: () => {} },
  ) {}

  private dbPath(addonId: string): string {
    return join(this.addonsDir, addonId, 'data', 'store.db');
  }

  // ── Guardrails ────────────────────────────────────────────────────────────

  /**
   * Reject SQL that could escape the addon's own file. node:sqlite exposes no
   * authorizer, so we deny `ATTACH`/`DETACH` textually (comments and string /
   * quoted-identifier literals are stripped first so keywords inside them don't
   * trip the check). Extension loading is already off at the driver level.
   */
  private assertSafe(sql: string): void {
    const stripped = sql
      .replace(/--[^\n]*/g, ' ') // line comments
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
      .replace(/'(?:''|[^'])*'/g, "''") // string literals
      .replace(/"(?:""|[^"])*"/g, '""'); // quoted identifiers
    if (/\b(?:attach|detach)\b/i.test(stripped)) {
      throw new AddonStorageError(
        'ATTACH/DETACH are not permitted in addon storage',
        'FORBIDDEN_SQL',
      );
    }
  }

  // ── Connection + migrations ────────────────────────────────────────────────

  private connect(
    addonId: string,
    migrations: readonly string[],
  ): DatabaseSync {
    const cached = this.handles.get(addonId);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.db;
    }

    const path = this.dbPath(addonId);
    mkdirSync(dirname(path), { recursive: true });
    // Extensions stay off (never call enableLoadExtension) → load_extension is
    // rejected as "not authorized".
    const db = new DatabaseSync(path);
    try {
      db.exec(
        'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
      );
      this.initMeta(db);
      this.applyMigrations(db, migrations);
    } catch (err) {
      // Don't leak the open handle (and the file lock) if setup/migration fails.
      try {
        db.close();
      } catch {
        /* ignore */
      }
      throw err;
    }

    this.handles.set(addonId, { db, lastUsed: Date.now() });
    return db;
  }

  private initMeta(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS _openaidy_migrations (
        idx        INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Apply any manifest migrations not yet recorded, by index, each in its own
   * transaction. Migrations must be plain DDL/DML (no BEGIN/COMMIT of their
   * own). Already-applied indices are skipped, so this is idempotent and safe
   * to call on every open.
   */
  private applyMigrations(
    db: DatabaseSync,
    migrations: readonly string[],
  ): void {
    const { max } = db
      .prepare('SELECT COALESCE(MAX(idx), -1) AS max FROM _openaidy_migrations')
      .get() as { max: number };

    for (let i = 0; i < migrations.length; i++) {
      if (i <= max) continue;
      const sql = migrations[i]!;
      this.assertSafe(sql);
      db.exec('BEGIN');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO _openaidy_migrations (idx) VALUES (?)').run(i);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw new AddonStorageError(
          `Migration ${i} failed: ${(err as Error).message}`,
          'MIGRATION_FAILED',
        );
      }
    }
  }

  // ── Parameter binding ──────────────────────────────────────────────────────

  private allRows(stmt: StatementSync, params: StorageParams): unknown[] {
    if (params === undefined) return stmt.all();
    if (Array.isArray(params)) return stmt.all(...(params as never[]));
    stmt.setAllowBareNamedParameters(true);
    return stmt.all(params as never);
  }

  private runStmt(stmt: StatementSync, params: StorageParams): ExecResult {
    let r: { changes: number | bigint; lastInsertRowid: number | bigint };
    if (params === undefined) r = stmt.run();
    else if (Array.isArray(params)) r = stmt.run(...(params as never[]));
    else {
      stmt.setAllowBareNamedParameters(true);
      r = stmt.run(params as never);
    }
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  // ── Raw SQL (iframe SDK) ────────────────────────────────────────────────────

  /** Run a read query and return rows (capped at the row quota). */
  query(
    addonId: string,
    migrations: readonly string[],
    sql: string,
    params?: StorageParams,
  ): unknown[] {
    this.assertSafe(sql);
    const db = this.connect(addonId, migrations);
    const stmt = db.prepare(sql);
    const out: unknown[] = [];
    const iter =
      params === undefined
        ? stmt.iterate()
        : Array.isArray(params)
          ? stmt.iterate(...(params as never[]))
          : (stmt.setAllowBareNamedParameters(true),
            stmt.iterate(params as never));
    for (const row of iter) {
      out.push(row);
      if (out.length >= this.quotas.maxRows) break;
    }
    return out;
  }

  /** Run a write statement and return {changes, lastInsertRowid}. */
  exec(
    addonId: string,
    migrations: readonly string[],
    sql: string,
    params?: StorageParams,
  ): ExecResult {
    this.assertSafe(sql);
    const db = this.connect(addonId, migrations);
    const res = this.runStmt(db.prepare(sql), params);
    this.checkQuota(addonId);
    return res;
  }

  /**
   * Full-text search convenience over an FTS5 table the addon declared. The
   * table name is caller-supplied, so it's validated as a bare identifier
   * (no injection) rather than parameterized (SQLite can't bind identifiers).
   */
  search(
    addonId: string,
    migrations: readonly string[],
    table: string,
    match: string,
    limit = 50,
  ): unknown[] {
    if (!IDENTIFIER.test(table)) {
      throw new AddonStorageError(
        `Invalid FTS table name: ${table}`,
        'INVALID_ARG',
      );
    }
    const db = this.connect(addonId, migrations);
    const cap = Math.max(1, Math.min(limit, this.quotas.maxRows));
    return db
      .prepare(`SELECT * FROM ${table} WHERE ${table} MATCH ? LIMIT ?`)
      .all(match, cap);
  }

  // ── Key/value store (iframe SDK sugar) ──────────────────────────────────────

  kvGet(addonId: string, migrations: readonly string[], key: string): unknown {
    const db = this.connect(addonId, migrations);
    const row = db.prepare('SELECT value FROM _kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }

  kvSet(
    addonId: string,
    migrations: readonly string[],
    key: string,
    value: unknown,
  ): void {
    const db = this.connect(addonId, migrations);
    db.prepare(
      `INSERT INTO _kv (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, JSON.stringify(value ?? null));
    this.checkQuota(addonId);
  }

  kvList(
    addonId: string,
    migrations: readonly string[],
    prefix?: string,
  ): Array<{ key: string; value: unknown }> {
    const db = this.connect(addonId, migrations);
    const rows = (
      prefix
        ? db
            .prepare(
              `SELECT key, value FROM _kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key`,
            )
            .all(`${prefix.replace(/[\\%_]/g, '\\$&')}%`)
        : db.prepare('SELECT key, value FROM _kv ORDER BY key').all()
    ) as Array<{ key: string; value: string }>;
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  }

  kvDelete(
    addonId: string,
    migrations: readonly string[],
    key: string,
  ): boolean {
    const db = this.connect(addonId, migrations);
    const { changes } = db.prepare('DELETE FROM _kv WHERE key = ?').run(key);
    return Number(changes) > 0;
  }

  // ── Quotas + lifecycle ──────────────────────────────────────────────────────

  private checkQuota(addonId: string): void {
    try {
      const { size } = statSync(this.dbPath(addonId));
      if (size > this.quotas.maxBytes) {
        this.logger.warn('Addon storage exceeds its soft size quota', {
          addonId,
          size,
          maxBytes: this.quotas.maxBytes,
        });
      }
    } catch {
      /* file may not exist yet — ignore */
    }
  }

  /** Close and forget an addon's connection (e.g. on disable or upgrade). */
  close(addonId: string): void {
    const h = this.handles.get(addonId);
    if (!h) return;
    try {
      h.db.close();
    } catch {
      /* ignore */
    }
    this.handles.delete(addonId);
  }

  /** Close every open connection (e.g. on server shutdown). */
  closeAll(): void {
    for (const id of [...this.handles.keys()]) this.close(id);
  }

  /**
   * Close the connection and delete the addon's on-disk data directory
   * (store.db + WAL/SHM sidecars). Called on uninstall.
   */
  destroyData(addonId: string): void {
    this.close(addonId);
    rmSync(join(this.addonsDir, addonId, 'data'), {
      recursive: true,
      force: true,
    });
  }
}
