import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * OAuth flow state table
 *
 * Short-lived (10 minute TTL) storage for in-flight OAuth flows.
 * Holds the PKCE verifier and the redirect_uri used by the start step,
 * so the callback step can validate state and exchange the code for tokens.
 *
 * The `state` value is the OAuth `state` parameter — a random, single-use
 * token returned to us by the provider. The provider-issued authorization
 * code is NEVER stored here (it lives only in the redirect URL).
 */
export const oauthFlowState = pgTable('oauth_flow_state', {
  /** OAuth `state` parameter (random, base64url). Primary key. */
  state: text('state').primaryKey(),

  /** Provider this flow is for (e.g. "minimax"). */
  providerId: text('provider_id').notNull(),

  /** PKCE verifier (random, base64url, 43 chars). Used at token exchange. */
  codeVerifier: text('code_verifier').notNull(),

  /** PKCE challenge (S256 of codeVerifier). Stored for debugging/audit. */
  codeChallenge: text('code_challenge').notNull(),

  /** Region hint for region-specific providers (e.g. "global" | "cn"). */
  region: text('region'),

  /** Redirect URI used at the start step. Must match the callback. */
  redirectUri: text('redirect_uri').notNull(),

  /** Epoch ms when this row was created. Used for TTL cleanup. */
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OAuthFlowState = typeof oauthFlowState.$inferSelect;
export type NewOAuthFlowState = typeof oauthFlowState.$inferInsert;
