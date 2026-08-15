/**
 * node:sqlite shim — a minimal better-sqlite3-compatible wrapper over Node's
 * built-in `node:sqlite` (`DatabaseSync`).
 *
 * Why: `better-sqlite3` is a native addon whose prebuilt binary is fetched by a
 * postinstall script. npm v12 disables dependency lifecycle scripts by default,
 * so `npm install -g @openaidy/app` would skip that script and leave the server
 * with no SQLite binary. Node's built-in `node:sqlite` needs no native install
 * step, so shipping this shim removes the failure class entirely.
 *
 * This exposes just the surface that `client.ts`, the repositories, and
 * `drizzle-orm/better-sqlite3` actually use (`prepare`, `exec`, `pragma`,
 * `transaction`, `close`, and statement `run/get/all/raw`). drizzle's SQLite
 * session maps columns by position via `.raw()`, which maps onto node:sqlite's
 * `setReturnArrays()`.
 *
 * Requires Node >= 22.13 (node:sqlite available without the
 * `--experimental-sqlite` flag).
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * better-sqlite3-compatible prepared statement.
 */
export class Statement {
  constructor(private readonly stmt: StatementSync) {}

  /**
   * Toggle positional-array output — better-sqlite3's `.raw()`. drizzle's
   * SQLite session calls this to read rows as arrays and map columns by index.
   * Returns `this` so `.raw().all()` chains like better-sqlite3.
   */
  raw(toggled = true): this {
    this.stmt.setReturnArrays(toggled);
    return this;
  }

  run(...params: unknown[]): RunResult {
    const r = this.stmt.run(...(params as never[]));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get(...params: unknown[]): unknown {
    return this.stmt.get(...(params as never[]));
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...(params as never[]));
  }
}

type TransactionFn = (...args: unknown[]) => unknown;

/**
 * A better-sqlite3 transaction runner: callable (defaults to DEFERRED) and also
 * exposing `.deferred/.immediate/.exclusive`. drizzle calls
 * `client.transaction(fn)[behavior](tx)`; client.ts calls the returned runner
 * directly.
 */
export interface TransactionRunner {
  (...args: unknown[]): unknown;
  deferred: (...args: unknown[]) => unknown;
  immediate: (...args: unknown[]) => unknown;
  exclusive: (...args: unknown[]) => unknown;
}

/**
 * better-sqlite3-compatible Database over node:sqlite.
 */
export default class Database {
  private readonly db: DatabaseSync;
  private depth = 0;
  private closed = false;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  /** True while a transaction is open (used to pick SAVEPOINT vs BEGIN). */
  get inTransaction(): boolean {
    return this.depth > 0;
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  exec(sql: string): this {
    this.db.exec(sql);
    return this;
  }

  /**
   * better-sqlite3-style pragma. Runs `PRAGMA <source>` and returns the rows
   * (e.g. `table_info(...)` / `index_list(...)` return arrays of objects;
   * assignment pragmas like `foreign_keys = ON` return `[]`). node:sqlite has
   * no `.pragma()` helper of its own.
   */
  pragma(source: string): unknown[] {
    return this.db.prepare(`PRAGMA ${source}`).all();
  }

  /** Idempotent — node:sqlite's DatabaseSync throws if closed twice, but
   * callers (e.g. a backup import that closes the connection early so it
   * can safely overwrite the on-disk file, ahead of the normal shutdown
   * close) may legitimately call this more than once.
   *
   * Marks `closed` only after the underlying close actually succeeds: if
   * `this.db.close()` throws (e.g. a transient error mid WAL-checkpoint),
   * a later close attempt must still retry rather than silently no-op
   * while the connection (and its un-checkpointed WAL data) is never
   * actually released. */
  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  /**
   * better-sqlite3-style transaction wrapper. Nested calls use SAVEPOINTs so
   * both drizzle's top-level `.transaction()` and the app's own wrapper compose
   * safely.
   */
  transaction(fn: TransactionFn): TransactionRunner {
    const make =
      (behavior: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') =>
      (...args: unknown[]): unknown => {
        const nested = this.depth > 0;
        const savepoint = `_oa_sp_${this.depth}`;
        this.db.exec(nested ? `SAVEPOINT ${savepoint}` : `BEGIN ${behavior}`);
        this.depth++;
        try {
          const result = fn(...args);
          this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
          this.depth--;
          return result;
        } catch (err) {
          this.db.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
          this.depth--;
          throw err;
        }
      };
    const runner = make('DEFERRED') as TransactionRunner;
    runner.deferred = make('DEFERRED');
    runner.immediate = make('IMMEDIATE');
    runner.exclusive = make('EXCLUSIVE');
    return runner;
  }
}
