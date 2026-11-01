import type { DatabaseClient } from '@openaidy/db';
import { ProviderCredentialsRepository } from '@openaidy/db';
import type {
  AnthropicOAuthTokens,
  CredentialInvalidator,
} from '@openaidy/shared-types';
import { generatePkce } from './pkce.js';
import type { OAuthStateStore } from './state-store.js';
import { getEncryptionService } from '../../lib/encryption.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('AnthropicOAuth');

/**
 * "Sign in with Claude" — lets a user connect the Anthropic provider
 * with their claude.ai Pro/Max subscription instead of an API key,
 * the same way Claude Code's own CLI authenticates.
 *
 * This is NOT a documented first-party integration path: it's the
 * same OAuth client Claude Code's CLI uses, reverse-engineered and
 * reimplemented by community tools (opencode and others). Anthropic
 * could change or block these values without notice. Verified
 * against multiple independent public reference implementations as
 * of November 2026 — re-verify if the flow starts failing.
 *
 * Unlike MiniMax (whose OAuth client_id is privileged to its own
 * `mmx-cli` binary, forcing a CLI-subprocess bridge), Anthropic's
 * flow is a direct PKCE authorization-code exchange we can run
 * ourselves — the first real consumer of `pkce.ts`/`state-store.ts`.
 *
 * The registered redirect URI is a fixed Anthropic-owned page
 * (`console.anthropic.com/oauth/code/callback`), not a URL we
 * control, so there's no server-to-server callback: the page shows
 * the user a `code#state` string, which the connect dialog asks
 * them to paste back in (see `DialogConnectProvider.tsx`).
 */

const PROVIDER_ID = 'anthropic';

const AUTHORIZATION_ENDPOINT = 'https://claude.ai/oauth/authorize';
const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const SCOPES = 'org:create_api_key user:profile user:inference';

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
};

export type StartAnthropicOAuthInput = {
  stateStore: OAuthStateStore;
};

export type StartAnthropicOAuthResult = {
  authorizationUrl: string;
  state: string;
};

/**
 * Begin the Anthropic OAuth flow. Returns the authorization URL the
 * user should open (in a popup) and the `state` the frontend must
 * send back alongside the pasted code.
 */
export async function startAnthropicOAuth(
  input: StartAnthropicOAuthInput,
): Promise<StartAnthropicOAuthResult> {
  const { verifier, challenge } = generatePkce();
  // Anthropic's authorize endpoint expects `state` to be the PKCE
  // verifier itself, not an independently generated value — every
  // reference implementation sets them equal, and sending an
  // unrelated `state` gets the whole request rejected as malformed
  // ("Invalid request format") before the user even sees a login
  // screen.
  const state = verifier;

  await input.stateStore.put(state, {
    providerId: PROVIDER_ID,
    codeVerifier: verifier,
    codeChallenge: challenge,
    region: null,
    redirectUri: REDIRECT_URI,
    createdAt: Date.now(),
  });

  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set('code', 'true');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  return { authorizationUrl: url.toString(), state };
}

export type CompleteAnthropicOAuthInput = {
  stateStore: OAuthStateStore;
  db: DatabaseClient;
  /**
   * The code the user pasted back. Anthropic's own callback page
   * shows it as `code#state` — the caller is responsible for
   * splitting that apart before calling this function.
   */
  code: string;
  state: string;
  onCredentialPersisted?: CredentialInvalidator;
};

export type CompleteAnthropicOAuthResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Exchange the pasted authorization code for tokens and persist
 * them to `provider_credentials` as an `oauth`-authenticated row.
 */
export async function completeAnthropicOAuth(
  input: CompleteAnthropicOAuthInput,
): Promise<CompleteAnthropicOAuthResult> {
  const flow = await input.stateStore.get(input.state);
  if (!flow || flow.providerId !== PROVIDER_ID) {
    return {
      success: false,
      error: 'This sign-in link has expired. Please try again.',
    };
  }
  // Single-use: consume the state row immediately so a retried or
  // replayed request can't reuse the same PKCE verifier.
  await input.stateStore.delete(input.state);

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: input.code,
        state: input.state,
        client_id: CLIENT_ID,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.codeVerifier,
      }),
    });
  } catch (err) {
    log.error('Token exchange request failed:', err);
    return {
      success: false,
      error:
        err instanceof Error ? err.message : 'Token exchange request failed',
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    log.error(`Token exchange failed (${response.status}): ${body}`);
    return {
      success: false,
      error: `Anthropic rejected the authorization code (${response.status})`,
    };
  }

  const tokenResponse = (await response.json()) as TokenResponse;
  const tokens: AnthropicOAuthTokens = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    ...(tokenResponse.scope ? { scope: tokenResponse.scope } : {}),
  };

  const credentialsRepo = new ProviderCredentialsRepository(
    input.db,
    input.onCredentialPersisted
      ? { onChange: input.onCredentialPersisted }
      : {},
  );
  const encrypted = getEncryptionService().encrypt(JSON.stringify(tokens));
  await credentialsRepo.upsert(PROVIDER_ID, 'oauth', encrypted);

  return { success: true };
}

export type RefreshAnthropicTokenInput = {
  refreshToken: string;
};

/**
 * Exchange a refresh token for a new access token. Returns `null`
 * on any failure — the caller decides whether that means marking
 * the stored credential as errored.
 */
export async function refreshAnthropicToken(
  input: RefreshAnthropicTokenInput,
): Promise<AnthropicOAuthTokens | null> {
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.warn(`Token refresh failed (${response.status}): ${body}`);
      return null;
    }

    const tokenResponse = (await response.json()) as TokenResponse;
    return {
      accessToken: tokenResponse.access_token,
      // Anthropic's refresh grant may omit refresh_token when it
      // doesn't rotate — keep using the one we already have.
      refreshToken: tokenResponse.refresh_token ?? input.refreshToken,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      ...(tokenResponse.scope ? { scope: tokenResponse.scope } : {}),
    };
  } catch (err) {
    log.warn(
      `Token refresh request threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
