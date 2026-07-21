/**
 * Agent-facing addon storage — the named-query catalog.
 *
 * Agents never write SQL against an addon's DB. Instead the addon declares a
 * catalog of named, parameterized queries in its manifest
 * (`storage.agentQueries`), and the agent runs them by name with typed
 * parameters. A declared query can do exactly — and only — what its author
 * wrote, so writes are as safe as reads (the agent supplies values, not
 * statements). Read queries run on a read-only connection; writes go through
 * `exec` and require the addon to grant `agentAccess: "readwrite"`.
 */
import type {
  AddonAgentQuery,
  AddonAgentQueryParamType,
  AddonStorageConfig,
} from '@openaidy/shared-types';
import type { AddonStorageEngine } from './engine';

export type AgentQueryErrorCode =
  | 'AGENT_ACCESS_DENIED'
  | 'QUERY_NOT_FOUND'
  | 'WRITE_NOT_ALLOWED'
  | 'INVALID_PARAMS';

export class AgentQueryDenied extends Error {
  constructor(
    message: string,
    readonly code: AgentQueryErrorCode,
  ) {
    super(message);
    this.name = 'AgentQueryDenied';
  }
}

/** Minimal shape of an addon record this service needs. */
export interface AddonForQueries {
  addonId: string;
  manifest: unknown;
}

export type AgentQueryResult =
  | { kind: 'rows'; rows: unknown[] }
  | { kind: 'write'; changes: number; lastInsertRowid: number | bigint };

function getStorage(manifest: unknown): AddonStorageConfig | undefined {
  return (manifest as { storage?: AddonStorageConfig } | null)?.storage;
}

function coerceParam(
  name: string,
  type: AddonAgentQueryParamType,
  value: unknown,
): string | number {
  if (value === undefined || value === null) {
    throw new AgentQueryDenied(
      `Missing required parameter: ${name}`,
      'INVALID_PARAMS',
    );
  }
  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        throw new AgentQueryDenied(
          `Parameter "${name}" must be a string`,
          'INVALID_PARAMS',
        );
      }
      return value;
    case 'int': {
      const n = Number(value);
      if (!Number.isInteger(n)) {
        throw new AgentQueryDenied(
          `Parameter "${name}" must be an integer`,
          'INVALID_PARAMS',
        );
      }
      return n;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new AgentQueryDenied(
          `Parameter "${name}" must be a number`,
          'INVALID_PARAMS',
        );
      }
      return n;
    }
    case 'boolean':
      // SQLite has no boolean — store as 0/1.
      return value ? 1 : 0;
  }
}

export class AddonAgentQueryService {
  constructor(private readonly engine: AddonStorageEngine) {}

  /**
   * The queries an agent may run against this addon: empty unless the addon
   * opted in via `agentAccess`, and write queries are hidden unless it granted
   * `readwrite`.
   */
  list(addon: AddonForQueries): AddonAgentQuery[] {
    const storage = getStorage(addon.manifest);
    if (!storage?.agentAccess || !storage.agentQueries) return [];
    return storage.agentQueries.filter(
      (q) =>
        (q.access ?? 'read') === 'read' || storage.agentAccess === 'readwrite',
    );
  }

  /** Run a declared query by name with the supplied parameters. */
  run(
    addon: AddonForQueries,
    queryName: string,
    params: Record<string, unknown> = {},
  ): AgentQueryResult {
    const storage = getStorage(addon.manifest);
    if (!storage?.agentAccess) {
      throw new AgentQueryDenied(
        'This addon does not expose its storage to agents',
        'AGENT_ACCESS_DENIED',
      );
    }
    const query = storage.agentQueries?.find((q) => q.name === queryName);
    if (!query) {
      throw new AgentQueryDenied(
        `Addon "${addon.addonId}" has no agent query named "${queryName}"`,
        'QUERY_NOT_FOUND',
      );
    }
    const access = query.access ?? 'read';
    if (access === 'write' && storage.agentAccess !== 'readwrite') {
      throw new AgentQueryDenied(
        `Query "${queryName}" writes, but this addon only grants agents read access`,
        'WRITE_NOT_ALLOWED',
      );
    }

    const bound = this.buildParams(query, params);
    const migrations = storage.migrations ?? [];

    if (access === 'read') {
      return {
        kind: 'rows',
        rows: this.engine.queryReadOnly(
          addon.addonId,
          migrations,
          query.sql,
          bound,
        ),
      };
    }
    const r = this.engine.exec(addon.addonId, migrations, query.sql, bound);
    return {
      kind: 'write',
      changes: r.changes,
      lastInsertRowid: r.lastInsertRowid,
    };
  }

  private buildParams(
    query: AddonAgentQuery,
    params: Record<string, unknown>,
  ): Record<string, string | number> {
    const declared = query.params ?? {};
    const out: Record<string, string | number> = {};
    for (const [name, type] of Object.entries(declared)) {
      out[name] = coerceParam(name, type, params?.[name]);
    }
    return out;
  }
}
