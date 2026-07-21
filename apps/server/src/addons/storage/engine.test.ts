import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AddonStorageEngine,
  AddonStorageError,
  DEFAULT_QUOTAS,
} from './engine.js';

const ADDON = 'test-addon';

describe('AddonStorageEngine', () => {
  let dir: string;
  let engine: AddonStorageEngine;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'addon-storage-'));
    engine = new AddonStorageEngine(dir, DEFAULT_QUOTAS);
  });

  afterEach(() => {
    engine.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  // ── KV ──────────────────────────────────────────────────────────────────
  it('kv: set/get round-trips JSON values', () => {
    engine.kvSet(ADDON, [], 'a', { n: 1, s: 'x' });
    engine.kvSet(ADDON, [], 'b', [1, 2, 3]);
    expect(engine.kvGet(ADDON, [], 'a')).toEqual({ n: 1, s: 'x' });
    expect(engine.kvGet(ADDON, [], 'b')).toEqual([1, 2, 3]);
    expect(engine.kvGet(ADDON, [], 'missing')).toBeUndefined();
  });

  it('kv: set overwrites, delete removes, list filters by prefix', () => {
    engine.kvSet(ADDON, [], 'ui:theme', 'dark');
    engine.kvSet(ADDON, [], 'ui:lang', 'en');
    engine.kvSet(ADDON, [], 'other', 1);
    engine.kvSet(ADDON, [], 'ui:theme', 'light'); // overwrite

    expect(engine.kvGet(ADDON, [], 'ui:theme')).toBe('light');
    const ui = engine.kvList(ADDON, [], 'ui:');
    expect(ui.map((r) => r.key).sort()).toEqual(['ui:lang', 'ui:theme']);

    expect(engine.kvDelete(ADDON, [], 'ui:lang')).toBe(true);
    expect(engine.kvDelete(ADDON, [], 'ui:lang')).toBe(false);
    expect(engine.kvList(ADDON, [], 'ui:').map((r) => r.key)).toEqual([
      'ui:theme',
    ]);
  });

  it('kv: list prefix escapes LIKE metacharacters', () => {
    engine.kvSet(ADDON, [], 'a%b', 1);
    engine.kvSet(ADDON, [], 'axb', 2);
    // '%' must be treated literally, not as a wildcard
    expect(engine.kvList(ADDON, [], 'a%').map((r) => r.key)).toEqual(['a%b']);
  });

  // ── Migrations ──────────────────────────────────────────────────────────
  const MIGRATIONS = [
    `CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT, body TEXT);`,
    `CREATE VIRTUAL TABLE notes_fts USING fts5(title, body);`,
  ];

  it('migrations: applied once and idempotent across reopen', () => {
    engine.exec(
      ADDON,
      MIGRATIONS,
      'INSERT INTO notes (title, body) VALUES (?, ?)',
      ['hello', 'world'],
    );
    // Reopen (new engine, same dir) — migrations must not re-run/throw
    engine.close(ADDON);
    const engine2 = new AddonStorageEngine(dir, DEFAULT_QUOTAS);
    const rows = engine2.query(ADDON, MIGRATIONS, 'SELECT title FROM notes');
    expect(rows).toEqual([{ title: 'hello' }]);
    // Adding a new migration appends without redoing old ones
    const more = [...MIGRATIONS, `ALTER TABLE notes ADD COLUMN tag TEXT;`];
    engine2.close(ADDON);
    const engine3 = new AddonStorageEngine(dir, DEFAULT_QUOTAS);
    engine3.exec(ADDON, more, 'UPDATE notes SET tag = ? WHERE title = ?', [
      't',
      'hello',
    ]);
    expect(
      engine3.query(ADDON, more, 'SELECT tag FROM notes WHERE title = ?', [
        'hello',
      ]),
    ).toEqual([{ tag: 't' }]);
    engine3.closeAll();
  });

  it('migrations: a failing migration rolls back and surfaces an error', () => {
    expect(() =>
      engine.kvGet(ADDON, ['CREATE TABLE x (a);', 'THIS IS NOT SQL;'], 'k'),
    ).toThrow(AddonStorageError);
  });

  // ── query / exec ────────────────────────────────────────────────────────
  it('exec: returns changes and lastInsertRowid; query binds params', () => {
    const r = engine.exec(
      ADDON,
      MIGRATIONS,
      'INSERT INTO notes (title, body) VALUES (?, ?)',
      ['t1', 'b1'],
    );
    expect(r.changes).toBe(1);
    expect(Number(r.lastInsertRowid)).toBeGreaterThan(0);

    engine.exec(ADDON, MIGRATIONS, 'INSERT INTO notes (title) VALUES (?)', [
      't2',
    ]);
    const found = engine.query(
      ADDON,
      MIGRATIONS,
      'SELECT title FROM notes WHERE title = ?',
      ['t2'],
    );
    expect(found).toEqual([{ title: 't2' }]);
  });

  it('query: supports named parameters', () => {
    engine.exec(ADDON, MIGRATIONS, 'INSERT INTO notes (title) VALUES (?)', [
      'named',
    ]);
    const rows = engine.query(
      ADDON,
      MIGRATIONS,
      'SELECT title FROM notes WHERE title = :t',
      { t: 'named' },
    );
    expect(rows).toEqual([{ title: 'named' }]);
  });

  it('query: caps rows at the quota', () => {
    const smallEngine = new AddonStorageEngine(dir, {
      ...DEFAULT_QUOTAS,
      maxRows: 3,
    });
    for (let i = 0; i < 10; i++) {
      smallEngine.exec(
        ADDON,
        MIGRATIONS,
        'INSERT INTO notes (title) VALUES (?)',
        [`n${i}`],
      );
    }
    expect(
      smallEngine.query(ADDON, MIGRATIONS, 'SELECT * FROM notes'),
    ).toHaveLength(3);
    smallEngine.closeAll();
  });

  // ── FTS ─────────────────────────────────────────────────────────────────
  it('search: full-text search over a declared FTS5 table', () => {
    engine.exec(
      ADDON,
      MIGRATIONS,
      'INSERT INTO notes_fts (title, body) VALUES (?, ?)',
      ['React setup', 'remember to use Vite'],
    );
    engine.exec(
      ADDON,
      MIGRATIONS,
      'INSERT INTO notes_fts (title, body) VALUES (?, ?)',
      ['Cooking', 'pasta recipe'],
    );
    const hits = engine.search(ADDON, MIGRATIONS, 'notes_fts', 'Vite');
    expect(hits).toHaveLength(1);
    expect((hits[0] as { title: string }).title).toBe('React setup');
  });

  it('search: rejects an invalid table name', () => {
    expect(() =>
      engine.search(ADDON, MIGRATIONS, 'notes; DROP TABLE notes', 'x'),
    ).toThrow(AddonStorageError);
  });

  // ── Guardrails ──────────────────────────────────────────────────────────
  it('guardrail: ATTACH/DETACH are rejected in query, exec, and migrations', () => {
    expect(() =>
      engine.query(ADDON, [], "ATTACH DATABASE 'other.db' AS x"),
    ).toThrow(/ATTACH/i);
    expect(() => engine.exec(ADDON, [], 'DETACH DATABASE x')).toThrow(
      /DETACH/i,
    );
    expect(() =>
      engine.kvGet(ADDON, ["ATTACH DATABASE 'x' AS y"], 'k'),
    ).toThrow(/ATTACH/i);
  });

  it('guardrail: the word "attach" inside string data is allowed', () => {
    // Not SQL ATTACH — just a value that contains the word.
    engine.exec(ADDON, MIGRATIONS, 'INSERT INTO notes (body) VALUES (?)', [
      'please attach the file',
    ]);
    const rows = engine.query(
      ADDON,
      MIGRATIONS,
      "SELECT body FROM notes WHERE body = 'please attach the file'",
    );
    expect(rows).toHaveLength(1);
  });

  // ── Lifecycle ───────────────────────────────────────────────────────────
  it('destroyData: closes and removes the data directory', () => {
    engine.kvSet(ADDON, [], 'k', 'v');
    const dataDir = join(dir, ADDON, 'data');
    expect(existsSync(dataDir)).toBe(true);
    engine.destroyData(ADDON);
    expect(existsSync(dataDir)).toBe(false);
  });
});
