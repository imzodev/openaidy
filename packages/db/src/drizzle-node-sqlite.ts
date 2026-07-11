/**
 * Build a drizzle SQLite client over the node:sqlite shim.
 *
 * We deliberately do NOT use `drizzle-orm/better-sqlite3`'s `drizzle()`: that
 * entry point statically imports the native `better-sqlite3` module at load
 * time (even when you pass your own client), and we no longer ship it. By
 * contrast `drizzle-orm/better-sqlite3/session` imports better-sqlite3 as types
 * only, so constructing the session directly needs no native module — in dev,
 * CI, and the bundled package alike.
 *
 * This mirrors the driver's internal `construct()` for drizzle-orm 0.41, using
 * the synchronous session so transaction/insert/select semantics are identical
 * to the previous better-sqlite3 setup.
 */
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
} from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core/db';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import type Database from './node-sqlite';

export function drizzleNodeSqlite<TSchema extends Record<string, unknown>>(
  client: Database,
  config: { schema: TSchema },
) {
  const dialect = new SQLiteSyncDialect({});
  const tablesConfig = extractTablesRelationalConfig(
    config.schema,
    createTableRelationsHelpers,
  );
  const schema = {
    fullSchema: config.schema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  };
  const session = new BetterSQLiteSession(
    // The shim is better-sqlite3-compatible for everything the session calls,
    // but not structurally identical to better-sqlite3's Database type.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client as any,
    dialect,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema as any,
    {},
  );
  const db = new BaseSQLiteDatabase(
    'sync',
    dialect,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema as any,
  );
  // Expose the raw client the way drizzle's driver does; repositories reach it
  // via `db.session.client` (see getRawSqlite).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).$client = client;
  return db;
}
