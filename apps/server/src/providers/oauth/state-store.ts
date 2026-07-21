import type { DatabaseClient } from '@openaidy/db';
import {
  OAuthFlowStateRepository,
  type OAuthFlowStateRecord,
} from '@openaidy/db';

/**
 * Application-layer view of an OAuth flow state.
 *
 * Decoupled from the DB column types so the rest of the OAuth code
 * (PKCE generation, provider-specific flows) doesn't have to know about Drizzle.
 */
export type OAuthFlowState = {
  providerId: string;
  codeVerifier: string;
  codeChallenge: string;
  region: 'global' | 'cn' | null;
  redirectUri: string;
  createdAt: number; // epoch ms
};

/**
 * Short-lived key-value store for OAuth flow state.
 *
 * Production + dev both use the same DB (SQLite at
 * `apps/server/data/openaidy.db` in dev, Postgres in prod). The state
 * is keyed by the OAuth `state` parameter — a random, single-use token
 * we generate at /start and that the provider echoes back at /callback.
 *
 * Why a store at all and not an in-memory map:
 *   - The server can run as multiple processes (or restart between
 *     /start and /callback). The OAuth dance is async (user goes to
 *     their browser, takes 30s, comes back). State must survive.
 *   - The dev DB is the same as the prod DB. Using the same store
 *     means dev experience matches prod exactly.
 */
export interface OAuthStateStore {
  put(state: string, value: OAuthFlowState): Promise<void>;
  get(state: string): Promise<OAuthFlowState | null>;
  delete(state: string): Promise<void>;
}

/**
 * DB-backed OAuth state store.
 *
 * Reads cleanup expired rows as a side effect of `get`, so the table
 * stays small without a separate cron job.
 */
export class DbOAuthStateStore implements OAuthStateStore {
  private readonly repo: OAuthFlowStateRepository;

  constructor(db: DatabaseClient) {
    this.repo = new OAuthFlowStateRepository(db);
  }

  async put(state: string, value: OAuthFlowState): Promise<void> {
    await this.repo.put({
      state,
      providerId: value.providerId,
      codeVerifier: value.codeVerifier,
      codeChallenge: value.codeChallenge,
      region: value.region,
      redirectUri: value.redirectUri,
    });
  }

  async get(state: string): Promise<OAuthFlowState | null> {
    const record: OAuthFlowStateRecord | null = await this.repo.get(state);
    if (!record) return null;
    return {
      providerId: record.providerId,
      codeVerifier: record.codeVerifier,
      codeChallenge: record.codeChallenge,
      region: (record.region as 'global' | 'cn' | null) ?? null,
      redirectUri: record.redirectUri,
      createdAt: record.createdAt.getTime(),
    };
  }

  async delete(state: string): Promise<void> {
    await this.repo.delete(state);
  }
}
