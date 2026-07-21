/**
 * Addon proxy routes — storage endpoints
 *
 * Exercises the full request → auth → permission → engine path for
 * /api/addon-proxy/storage/* against a real per-addon SQLite engine backed by
 * a temp directory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addonProxyRoutes } from './proxy-routes';
import { AddonService } from './service';
import { AddonStorageEngine, DEFAULT_QUOTAS } from './storage/engine';
import type { Addon } from '@openaidy/db';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
const MIGRATIONS = [
  'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT);',
  'CREATE VIRTUAL TABLE notes_fts USING fts5(title);',
];

function makeAddon(addonId: string, permissions: string[]): Addon {
  return {
    id: 'db-row-id',
    addonId,
    name: 'Storage Addon',
    version: '1.0.0',
    status: 'enabled',
    permissions,
    manifest: { permissions, storage: { migrations: MIGRATIONS } },
    config: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    installedBy: 'admin',
  } as unknown as Addon;
}

async function buildApp(opts: {
  addon: Addon;
  engine?: AddonStorageEngine;
}): Promise<{ app: FastifyInstance; token: string }> {
  const addonSvc = new AddonService({
    repository: null as never,
    validator: null as never,
    jwtSecret: JWT_SECRET,
    openAidyVersion: '0.0.0',
  });
  const token = (
    addonSvc as unknown as {
      generateAccessToken: (id: string, perms: string[]) => string;
    }
  ).generateAccessToken(opts.addon.addonId, opts.addon.permissions as string[]);

  vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
    opts.addon as never,
  );
  vi.spyOn(addonSvc as never, 'recordUsage' as never).mockResolvedValue(
    undefined as never,
  );

  const app = Fastify({ logger: false });
  await app.register(
    async (api: FastifyInstance) => {
      await api.register(addonProxyRoutes, {
        addonService: addonSvc,
        authMiddleware: null as never,
        internalApiBaseUrl: '',
        ...(opts.engine ? { storageEngine: opts.engine } : {}),
      });
    },
    { prefix: '/api' },
  );
  return { app, token };
}

describe('addon-proxy storage routes', () => {
  let dir: string;
  let engine: AddonStorageEngine;
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'addon-storage-routes-'));
    engine = new AddonStorageEngine(dir, DEFAULT_QUOTAS);
  });

  afterEach(() => {
    engine.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it('KV: set then get round-trips a JSON value', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('kv-addon', ['storage.read', 'storage.write']),
      engine,
    });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/addon-proxy/storage/kv/theme',
      headers: auth(token),
      payload: { value: { mode: 'dark' } },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/storage/kv/theme',
      headers: auth(token),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ value: { mode: 'dark' } });
  });

  it('query + exec: migrations applied, params bound, rows returned', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('sql-addon', ['storage.read', 'storage.write']),
      engine,
    });
    const exec = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/storage/exec',
      headers: auth(token),
      payload: { sql: 'INSERT INTO notes (title) VALUES (?)', params: ['hi'] },
    });
    expect(exec.statusCode).toBe(200);
    expect(exec.json().changes).toBe(1);

    const query = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/storage/query',
      headers: auth(token),
      payload: {
        sql: 'SELECT title FROM notes WHERE title = ?',
        params: ['hi'],
      },
    });
    expect(query.statusCode).toBe(200);
    expect(query.json()).toEqual({ rows: [{ title: 'hi' }] });
  });

  it('search: full-text search over a declared FTS table', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('fts-addon', ['storage.read', 'storage.write']),
      engine,
    });
    await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/storage/exec',
      headers: auth(token),
      payload: {
        sql: 'INSERT INTO notes_fts (title) VALUES (?)',
        params: ['React and Vite'],
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/storage/search',
      headers: auth(token),
      payload: { table: 'notes_fts', match: 'Vite' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(1);
  });

  it('permission: a read-only addon cannot write (exec → 403)', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('ro-addon', ['storage.read']),
      engine,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/storage/exec',
      headers: auth(token),
      payload: { sql: 'INSERT INTO notes (title) VALUES (?)', params: ['x'] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('permission: no storage permission at all → 403', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('none-addon', ['sessions.list']),
      engine,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/storage/kv/x',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('guardrail: ATTACH is rejected with 400', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('guard-addon', ['storage.read']),
      engine,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/storage/query',
      headers: auth(token),
      payload: { sql: "ATTACH DATABASE 'x' AS y" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('FORBIDDEN_SQL');
  });

  it('returns 503 when no storage engine is configured', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('no-engine', ['storage.read']),
      // engine omitted
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/storage/kv/x',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(503);
  });
});
