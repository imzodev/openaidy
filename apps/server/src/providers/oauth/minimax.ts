import type { DatabaseClient } from '@openaidy/db';
import { ProviderCredentialsRepository } from '@openaidy/db';
import { getEncryptionService } from '../../lib/encryption.js';
import { generatePkce, generateState } from './pkce.js';
import type { OAuthStateStore } from './state-store.js';

/**
 * MiniMax OAuth orchestration.
 *
 * Implements the browser-redirect OAuth flow against MiniMax's public
 * OAuth endpoints. The same flow covers:
 *
 *   - Web popup (the popup gets the redirect, exchanges the code,
 *     posts back to the parent window, closes itself)
 *   - CLI (the CLI opens the URL in any browser, polls until the user
 *     authorizes, then exchanges the code for tokens)
 *
 * No per-developer client_id/secret is required. MiniMax publishes
 * a public OAuth endpoint (the same approach used by OpenAI's
 * `codex login` and GitHub's `gh auth login`).
 *
 * PKCE protects the code exchange: even if the redirect URL with
 * the `code` parameter is intercepted, the attacker can't exchange
 * the code for tokens without the `code_verifier` that we keep
 * server-side in the OAuthStateStore.
 */

/** Region determines the OAuth + inference endpoints. */
export type MiniMaxRegion = 'global' | 'cn';

const MINIMAX_ENDPOINTS: Record<
  MiniMaxRegion,
  {
    authorize: string;
    token: string;
  }
> = {
  global: {
    authorize: 'https://api.minimax.io/oauth/authorize',
    token: 'https://api.minimax.io/oauth/token',
  },
  cn: {
    authorize: 'https://api.minimaxi.com/oauth/authorize',
    token: 'https://api.minimaxi.com/oauth/token',
  },
};

/** Scopes for MiniMax OAuth — model access only. */
const MINIMAX_SCOPES = 'model:read model:write';

/** Provider id used in the DB. Matches the MiniMaxProfile.id in @openaidy/providers. */
const MINIMAX_PROVIDER_ID = 'minimax';

// ── Start ─────────────────────────────────────────────────────────────────

export type StartMiniMaxOAuthInput = {
  stateStore: OAuthStateStore;
  region: MiniMaxRegion;
  redirectUri: string;
};

export type StartMiniMaxOAuthResult = {
  authorizationUrl: string;
  state: string;
};

/**
 * Begin a MiniMax OAuth flow.
 *
 * Generates a PKCE pair and a `state` token, persists them in the
 * state store, and returns the URL the user should be redirected to.
 */
export async function startMiniMaxOAuth(
  input: StartMiniMaxOAuthInput,
): Promise<StartMiniMaxOAuthResult> {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const endpoints = MINIMAX_ENDPOINTS[input.region];

  await input.stateStore.put(state, {
    providerId: MINIMAX_PROVIDER_ID,
    codeVerifier: verifier,
    codeChallenge: challenge,
    region: input.region,
    redirectUri: input.redirectUri,
    createdAt: Date.now(),
  });

  const url = new URL(endpoints.authorize);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', MINIMAX_SCOPES);
  // Public client — no client_id is sent. The provider identifies the
  // app by the User-Agent + the code_challenge_method.

  return {
    authorizationUrl: url.toString(),
    state,
  };
}

// ── Exchange ──────────────────────────────────────────────────────────────

export type ExchangeMiniMaxCodeInput = {
  stateStore: OAuthStateStore;
  state: string;
  code: string;
  db: DatabaseClient;
};

export type ExchangeMiniMaxCodeResult =
  | { success: true; region: MiniMaxRegion; userHint?: string }
  | { success: false; error: string };

/** Shape of the MiniMax token endpoint's success response. */
type MiniMaxTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  user?: { id?: string; email?: string; name?: string };
};

/**
 * Exchange the authorization code for tokens and persist them.
 *
 * Called from the /callback route after the provider redirects back
 * with `?code=...&state=...`. Validates the state, then:
 *
 *   1. POSTs to the MiniMax token endpoint with the code + PKCE verifier
 *   2. Receives { access_token, refresh_token, expires_in }
 *   3. Encrypts and persists in provider_credentials
 *   4. Cleans up the state row
 */
export async function exchangeMiniMaxCode(
  input: ExchangeMiniMaxCodeInput,
): Promise<ExchangeMiniMaxCodeResult> {
  const flowState = await input.stateStore.get(input.state);
  if (!flowState) {
    return { success: false, error: 'invalid_or_expired_state' };
  }

  if (flowState.providerId !== MINIMAX_PROVIDER_ID) {
    return { success: false, error: 'state_provider_mismatch' };
  }

  const region: MiniMaxRegion = flowState.region ?? 'global';
  const endpoints = MINIMAX_ENDPOINTS[region];
  const credentialsRepo = new ProviderCredentialsRepository(input.db);
  const encryption = getEncryptionService();

  let tokens: MiniMaxTokenResponse;
  try {
    const response = await fetch(endpoints.token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: flowState.codeVerifier,
        redirect_uri: flowState.redirectUri,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return {
        success: false,
        error: `token_exchange_failed: ${response.status} ${body.slice(0, 200)}`,
      };
    }

    tokens = (await response.json()) as MiniMaxTokenResponse;
  } catch (err) {
    return {
      success: false,
      error: `token_exchange_network_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return {
      success: false,
      error: 'token_exchange_missing_tokens',
    };
  }

  const encrypted = encryption.encrypt(
    JSON.stringify({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      region,
      user: tokens.user,
    }),
  );

  await credentialsRepo.upsert(MINIMAX_PROVIDER_ID, 'oauth', encrypted);

  // The state row has served its purpose; clean it up so the same
  // state can't be replayed.
  await input.stateStore.delete(input.state);

  return {
    success: true,
    region,
    ...(tokens.user?.email !== undefined && { userHint: tokens.user.email }),
  };
}

// ── Refresh ───────────────────────────────────────────────────────────────

export type RefreshMiniMaxTokenInput = {
  db: DatabaseClient;
  refreshToken: string;
  region: MiniMaxRegion;
};

export type RefreshMiniMaxTokenResult = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null;

/**
 * Exchange a refresh_token for a new access_token + refresh_token.
 * Returns null if the refresh failed (e.g. the refresh token has been
 * revoked). On success, also persists the new tokens in the DB.
 */
export async function refreshMiniMaxToken(
  input: RefreshMiniMaxTokenInput,
): Promise<RefreshMiniMaxTokenResult> {
  const endpoints = MINIMAX_ENDPOINTS[input.region];
  const credentialsRepo = new ProviderCredentialsRepository(input.db);
  const encryption = getEncryptionService();

  let tokens: MiniMaxTokenResponse;
  try {
    const response = await fetch(endpoints.token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
      }),
    });

    if (!response.ok) {
      // Refresh failed — likely the refresh token is revoked or expired.
      // Caller should mark the credential as errored and ask the user
      // to reconnect.
      await credentialsRepo.setError(
        MINIMAX_PROVIDER_ID,
        `refresh_failed: ${response.status}`,
      );
      return null;
    }

    tokens = (await response.json()) as MiniMaxTokenResponse;
  } catch (err) {
    await credentialsRepo.setError(
      MINIMAX_PROVIDER_ID,
      `refresh_network_error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return null;
  }

  const expiresAt = Date.now() + tokens.expires_in * 1000;
  const encrypted = encryption.encrypt(
    JSON.stringify({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      region: input.region,
    }),
  );

  await credentialsRepo.upsert(MINIMAX_PROVIDER_ID, 'oauth', encrypted);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
  };
}
