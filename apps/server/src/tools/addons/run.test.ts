import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AddonStorageEngine,
  DEFAULT_QUOTAS,
} from '../../addons/storage/engine.js';
import { createAddonRunTool, createAddonListQueriesTool } from './run.js';
import type { AddonToolDeps } from './create.js';

const CTX = { agentId: 'a1' };

const STORAGE = {
  migrations: ['CREATE TABLE deals (id INTEGER PRIMARY KEY, title TEXT);'],
  agentAccess: 'readwrite',
  agentQueries: [
    {
      name: 'all_deals',
      description: 'All deals',
      access: 'read',
      sql: 'SELECT title FROM deals ORDER BY title',
    },
    {
      name: 'add_deal',
      description: 'Add a deal',
      access: 'write',
      params: { title: 'string' },
      sql: 'INSERT INTO deals (title) VALUES (:title)',
    },
  ],
};

function addonRecord(over: Record<string, unknown> = {}) {
  return {
    addonId: 'crm',
    name: 'CRM',
    status: 'enabled',
    manifest: { storage: STORAGE },
    ...over,
  };
}

function makeDeps(
  engine: AddonStorageEngine | undefined,
  addon: Record<string, unknown> | null = addonRecord(),
): AddonToolDeps {
  return {
    addonsDir: '/tmp/x',
    ...(engine ? { storageEngine: engine } : {}),
    addonService: {
      getAddon: async (id: string) =>
        addon && (addon as { addonId: string }).addonId === id ? addon : null,
      listAddons: async () => ({ addons: addon ? [addon] : [], total: 1 }),
    } as never,
  };
}

describe('addon_run / addon_list_queries tools', () => {
  let dir: string;
  let engine: AddonStorageEngine;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'addon-run-tool-'));
    engine = new AddonStorageEngine(dir, DEFAULT_QUOTAS);
  });
  afterEach(() => {
    engine.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it('addon_run: write then read', async () => {
    const run = createAddonRunTool(makeDeps(engine));
    const w = await run.execute(
      { addon_id: 'crm', query: 'add_deal', params: { title: 'Acme' } },
      CTX,
    );
    expect(w.ok).toBe(true);
    if (w.ok) expect(JSON.parse(w.content).changes).toBe(1);

    const r = await run.execute({ addon_id: 'crm', query: 'all_deals' }, CTX);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.content).rows).toEqual([{ title: 'Acme' }]);
  });

  it('addon_run: surfaces a denied query as an error', async () => {
    const run = createAddonRunTool(makeDeps(engine));
    const res = await run.execute(
      { addon_id: 'crm', query: 'does_not_exist' },
      CTX,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('QUERY_NOT_FOUND');
  });

  it('addon_run: not-enabled addon is refused', async () => {
    const run = createAddonRunTool(
      makeDeps(engine, addonRecord({ status: 'installed' })),
    );
    const res = await run.execute({ addon_id: 'crm', query: 'all_deals' }, CTX);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not enabled');
  });

  it('addon_run: unknown addon is refused', async () => {
    const run = createAddonRunTool(makeDeps(engine));
    const res = await run.execute(
      { addon_id: 'ghost', query: 'all_deals' },
      CTX,
    );
    expect(res.ok).toBe(false);
  });

  it('addon_run: unavailable storage is refused', async () => {
    const run = createAddonRunTool(makeDeps(undefined));
    const res = await run.execute({ addon_id: 'crm', query: 'all_deals' }, CTX);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not available');
  });

  it('addon_list_queries: returns the catalog for opted-in addons', async () => {
    const list = createAddonListQueriesTool(makeDeps(engine));
    const res = await list.execute({}, CTX);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const catalog = JSON.parse(res.content);
      expect(catalog).toHaveLength(1);
      expect(catalog[0].addon_id).toBe('crm');
      expect(catalog[0].queries.map((q: { name: string }) => q.name)).toEqual([
        'all_deals',
        'add_deal',
      ]);
    }
  });
});
