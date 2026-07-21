import { eq, lt } from 'drizzle-orm';
import type { DatabaseClient } from '../client';
import {
  oauthFlowState,
  type OAuthFlowState as DbOAuthFlowState,
} from '../schema/oauth-flow-state';

/**
 * OAuth flow state record as the application layer uses it.
 * Mirrors the DB row but is decoupled from the Drizzle inferred type
 * so callers don't need to know about the ORM.
 */
export type OAuthFlowStateRecord = {
  state: string;
  providerId: string;
  codeVerifier: string;
  codeChallenge: string;
  region: string | null;
  redirectUri: string;
  createdAt: Date;
};

/**
 * Default TTL for OAuth flow state rows.
 * Matches MiniMax's authorization code lifetime (10 minutes).
 */
export const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Repository for short-lived OAuth flow state.
 *
 * Backed by the `oauth_flow_state` table — same DB the rest of the app uses
 * (SQLite at `apps/server/data/openaidy.db` in dev, Postgres in prod).
 *
 * State is keyed by the OAuth `state` parameter (a random, single-use value
 * we generated at /start and that the provider echoes back at /callback).
 *
 * The PKCE `code_verifier` stored here is needed at the /callback step to
 * prove that the token exchange request is coming from the same client that
 * started the flow.
 */
export class OAuthFlowStateRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Store a new OAuth flow state.
   * If a row with the same state already exists, it's overwritten
   * (state is random enough that collisions are not a concern).
   */
  async put(
    record: Omit<OAuthFlowStateRecord, 'createdAt'>,
  ): Promise<OAuthFlowStateRecord> {
    const now = new Date();
    await this.db
      .insert(oauthFlowState)
      .values({
        state: record.state,
        providerId: record.providerId,
        codeVerifier: record.codeVerifier,
        codeChallenge: record.codeChallenge,
        region: record.region,
        redirectUri: record.redirectUri,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: oauthFlowState.state,
        set: {
          providerId: record.providerId,
          codeVerifier: record.codeVerifier,
          codeChallenge: record.codeChallenge,
          region: record.region,
          redirectUri: record.redirectUri,
          createdAt: now,
        },
      });
    return { ...record, createdAt: now };
  }

  /**
   * Look up an OAuth flow state by its `state` parameter.
   * Returns null if the state doesn't exist or has expired.
   *
   * Expired rows are cleaned up as a side effect of the lookup.
   */
  async get(
    state: string,
    options: { ttlMs?: number } = {},
  ): Promise<OAuthFlowStateRecord | null> {
    const ttlMs = options.ttlMs ?? DEFAULT_OAUTH_STATE_TTL_MS;
    const cutoff = new Date(Date.now() - ttlMs);

    // Best-effort cleanup of expired rows. Cheap because the index on
    // created_at is the same column we filter on.
    await this.db
      .delete(oauthFlowState)
      .where(lt(oauthFlowState.createdAt, cutoff));

    const results = await this.db
      .select()
      .from(oauthFlowState)
      .where(eq(oauthFlowState.state, state))
      .limit(1);

    const row = results[0];
    if (!row) return null;
    return this.toRecord(row);
  }

  /**
   * Delete an OAuth flow state by its `state` parameter.
   * Called after a successful token exchange.
   */
  async delete(state: string): Promise<void> {
    await this.db.delete(oauthFlowState).where(eq(oauthFlowState.state, state));
  }

  /**
   * Delete all rows older than the TTL.
   * Called periodically by the app to keep the table small.
   * Returns the number of rows deleted.
   */
  async cleanupExpired(options: { ttlMs?: number } = {}): Promise<number> {
    const ttlMs = options.ttlMs ?? DEFAULT_OAUTH_STATE_TTL_MS;
    const cutoff = new Date(Date.now() - ttlMs);
    const result = await this.db
      .delete(oauthFlowState)
      .where(lt(oauthFlowState.createdAt, cutoff))
      .returning({ state: oauthFlowState.state });
    return result.length;
  }

  private toRecord(row: DbOAuthFlowState): OAuthFlowStateRecord {
    return {
      state: row.state,
      providerId: row.providerId,
      codeVerifier: row.codeVerifier,
      codeChallenge: row.codeChallenge,
      region: row.region,
      redirectUri: row.redirectUri,
      createdAt: row.createdAt,
    };
  }
}
