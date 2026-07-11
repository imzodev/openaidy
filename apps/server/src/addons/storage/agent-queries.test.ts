import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddonStorageEngine, DEFAULT_QUOTAS } from './engine.js';
import {
  AddonAgentQueryService,
  AgentQueryDenied,
  type AgentQueryResult,
} from './agent-queries.js';

const MIGRATIONS = ['CREATE TABLE deals (id INTEGER PRIMARY KEY, title TEXT);'];

const QUERIES = [
  {
    name: 'all_deals',
    description: 'All deal titles',
    access: 'read' as const,
    sql: 'SELECT title FROM deals ORDER BY title',
  },
  {
    name: 'by_prefix',
    description: 'Deals whose title starts with a prefix',
    access: 'read' as const,
    params: { p: 'string' as const },
    sql: "SELECT title FROM deals WHERE title LIKE :p || '%' ORDER BY title",
  },
  {
    name: 'add_deal',
    description: 'Add a deal',
    access: 'write' as const,
    params: { title: 'string' as const },
    sql: 'INSERT INTO deals (title) VALUES (:title)',
  },
];

function addon(addonId: string, storage: unknown) {
  return { addonId, manifest: { storage } };
}

const RW = {
  migrations: MIGRATIONS,
  agentAccess: 'readwrite',
  agentQueries: QUERIES,
};
const RO = {
  migrations: MIGRATIONS,
  agentAccess: 'read',
  agentQueries: QUERIES,
};

describe('AddonAgentQueryService', () => {
  let dir: string;
  let engine: AddonStorageEngine;
  let svc: AddonAgentQueryService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-queries-'));
    engine = new AddonStorageEngine(dir, DEFAULT_QUOTAS);
    svc = new AddonAgentQueryService(engine);
  });
  afterEach(() => {
    engine.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs write then read named queries', () => {
    const a = addon('crm', RW);
    const w = svc.run(a, 'add_deal', { title: 'Acme' });
    expect(w).toMatchObject({ kind: 'write', changes: 1 } as AgentQueryResult);
    svc.run(a, 'add_deal', { title: 'Beta' });
    expect(svc.run(a, 'all_deals')).toEqual({
      kind: 'rows',
      rows: [{ title: 'Acme' }, { title: 'Beta' }],
    });
  });

  it('binds and coerces declared params', () => {
    const a = addon('crm', RW);
    svc.run(a, 'add_deal', { title: 'Acme' });
    svc.run(a, 'add_deal', { title: 'Zeta' });
    const r = svc.run(a, 'by_prefix', { p: 'Ac' });
    expect(r).toEqual({ kind: 'rows', rows: [{ title: 'Acme' }] });
  });

  it('rejects a missing required param', () => {
    try {
      svc.run(addon('crm', RW), 'add_deal', {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AgentQueryDenied);
      expect((e as AgentQueryDenied).code).toBe('INVALID_PARAMS');
    }
  });

  it('denies a write query when the addon grants agents read-only', () => {
    try {
      svc.run(addon('crm', RO), 'add_deal', { title: 'x' });
      expect.unreachable();
    } catch (e) {
      expect((e as AgentQueryDenied).code).toBe('WRITE_NOT_ALLOWED');
    }
  });

  it('a read query cannot be tricked into writing (read-only connection)', () => {
    const sneaky = {
      migrations: MIGRATIONS,
      agentAccess: 'read',
      agentQueries: [
        {
          name: 'sneaky',
          description: 'looks like a read',
          access: 'read' as const,
          sql: "INSERT INTO deals (title) VALUES ('x')",
        },
      ],
    };
    expect(() => svc.run(addon('crm', sneaky), 'sneaky')).toThrow(/readonly/i);
  });

  it('denies when the addon did not opt into agent access', () => {
    const noAccess = { migrations: MIGRATIONS, agentQueries: QUERIES };
    try {
      svc.run(addon('crm', noAccess), 'all_deals');
      expect.unreachable();
    } catch (e) {
      expect((e as AgentQueryDenied).code).toBe('AGENT_ACCESS_DENIED');
    }
  });

  it('reports an unknown query', () => {
    try {
      svc.run(addon('crm', RW), 'nope');
      expect.unreachable();
    } catch (e) {
      expect((e as AgentQueryDenied).code).toBe('QUERY_NOT_FOUND');
    }
  });

  it('list: shows writes only under readwrite; empty without opt-in', () => {
    expect(svc.list(addon('c', RW)).map((q) => q.name)).toContain('add_deal');
    expect(svc.list(addon('c', RO)).map((q) => q.name)).not.toContain(
      'add_deal',
    );
    expect(svc.list(addon('c', RO)).map((q) => q.name)).toContain('all_deals');
    expect(svc.list(addon('c', { migrations: [] }))).toEqual([]);
  });
});
