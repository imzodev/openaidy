import {
  spawnMmxLogin,
  readMmxTokens,
  isMmxInstalled,
  type MmxLoginHandle,
  type MiniMaxLoginResult,
  type MiniMaxOAuthTokens,
  type SpawnMmxLoginOptions,
} from './mmx-bridge.js';
import { createLogger } from '../../lib/logger.js';
import type { OAuthStateStore } from './state-store.js';
import type { DatabaseClient } from '@openaidy/db';
import type { CredentialInvalidator } from '@openaidy/shared-types';

const log = createLogger('MiniMaxOAuth');
/**
 * MiniMax OAuth orchestration — backed by the official `mmx-cli` subprocess.
 *
 * Background: MiniMax's OAuth endpoints (`/oauth2/device/code`,
 * `/oauth2/token`) require a special `client_id` that is only embedded
 * inside the official `mmx-cli` binary. They are NOT publicly accessible
 * to third parties (verified by curl: 404). So we cannot implement the
 * device-code flow directly from OpenAidy — we have to delegate to
 * `mmx`, which has the privileged client_id.
 *
 * The user-facing experience is the same as a normal OAuth flow:
 *   1. User clicks "Sign in with MiniMax" in the Settings → Providers dialog
 *   2. Server spawns `mmx auth login --recommend --region=...` in the
 *      background, which contacts MiniMax and prints a `user_code` + URL
 *   3. We return that URL to the frontend, which opens it in a popup
 *   4. The user signs in to MiniMax in the popup and clicks Authorize
 *   5. `mmx` receives the tokens via MiniMax's private callback channel,
 *      saves them to `~/.mmx/config.json`, and exits cleanly
 *   6. We read the tokens from the config file, encrypt them, and
 *      persist them in our own `provider_credentials` table
 *   7. The frontend dialog closes, the user is connected
 *
 * The OAuth state store we built earlier still serves a purpose: it
 * stores the in-flight login attempt (`state → region + abort signal`)
 * so the HTTP callback route can stream progress updates to the
 * frontend via Server-Sent Events.
 *
 * The PKCE code_verifier in oauth_flow_state is unused now (mmx handles
 * PKCE internally). We keep the table for future OAuth flows that DO
 * use PKCE (OpenAI Codex, Google Gemini).
 */

const MINIMAX_PROVIDER_ID = 'minimax';

// ── Start ─────────────────────────────────────────────────────────────────

export type StartMiniMaxOAuthInput = {
  stateStore: OAuthStateStore;
  region: 'global' | 'cn';
  /** Unique token returned to the client to identify this flow. */
  flowId: string;
  /** Optional AbortSignal tied to the client disconnecting. */
  signal?: AbortSignal;
  /** Database client used to persist the encrypted tokens on success. */
  db?: DatabaseClient;
  /**
   * Called after tokens are written to `provider_credentials` so
   * any in-memory credential cache (e.g. the OpenAI-compatible
   * adapter's per-request resolver) picks up the new value on the
   * next chat call without a server restart.
   */
  onCredentialPersisted?: CredentialInvalidator;
};

export type StartMiniMaxOAuthResult =
  | {
      ok: true;
      flowId: string;
      verificationUrl: string;
    }
  | {
      ok: false;
      error: 'mmx_not_installed' | 'internal_error';
      message: string;
    };

/**
 * Begin a MiniMax OAuth flow. Returns the verification URL the user
 * should open in a browser. The flow continues in the background.
 */
export async function startMiniMaxOAuth(
  input: StartMiniMaxOAuthInput,
): Promise<StartMiniMaxOAuthResult> {
  // 1. Verify mmx is installed before we promise anything
  const installed = await isMmxInstalled();
  if (!installed) {
    return {
      ok: false,
      error: 'mmx_not_installed',
      message:
        'The mmx-cli tool could not be found. OpenAidy bundles it as a ' +
        'server dependency, so this usually means dependencies are not ' +
        'installed — run: pnpm install',
    };
  }

  // 2. Persist the flow state so the callback route can find it
  await input.stateStore.put(input.flowId, {
    providerId: MINIMAX_PROVIDER_ID,
    codeVerifier: '', // unused — mmx handles PKCE
    codeChallenge: '',
    region: input.region,
    redirectUri: '',
    createdAt: Date.now(),
  });

  // 3. Spawn mmx in the background
  try {
    const handle: MmxLoginHandle = spawnMmxLogin({
      region: input.region,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    // 4. Wire up the handle: when mmx resolves user_code, update
    //    the state store so the /status polling endpoint can return
    //    it; when mmx completes successfully, persist the tokens
    //    to provider_credentials and clean up state.
    wireMmxHandleToFlow(handle, input);

    // 5. Wait for the user_code so we can return a useful URL.
    //    In practice mmx prints the user_code within ~1s of being
    //    spawned with a PTY, but we wait up to 30s to cover any
    //    cold-start latency (e.g. mmx fetching the device-code
    //    from MiniMax on first run).
    let verificationUrl = '';
    try {
      const code = await Promise.race([
        handle.userCode,
        new Promise<string>((_, rej) =>
          setTimeout(() => rej(new Error('user_code_timeout')), 30_000),
        ),
      ]);
      verificationUrl = await handle.verificationUrl;
      // Store the user_code in the state for later retrieval
      const stored = await input.stateStore.get(input.flowId);
      if (stored) {
        await input.stateStore.put(input.flowId, {
          ...stored,
          codeChallenge: code, // repurpose field to hold user_code
        });
      } else {
        // Defensive: this shouldn't happen — we just put the state
        // row at the start of this function. If it does, log it
        // and continue (the verificationUrl is still useful).
        log.warn(
          `startMiniMaxOAuth: state row missing for flowId=${input.flowId}`,
        );
      }
    } catch {
      // mmx didn't print user_code within 30s. Return an empty
      // verificationUrl. The frontend polls /status and will
      // pick up the user_code from the state store when mmx
      // eventually prints it (wireMmxHandleToFlow stores it in
      // the background). mmx's own browser tab is already open
      // and waits for the user independently.
    }

    return { ok: true, flowId: input.flowId, verificationUrl };
  } catch (err) {
    await input.stateStore.delete(input.flowId);
    return {
      ok: false,
      error: 'internal_error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Status / poll ─────────────────────────────────────────────────────────

export type GetMiniMaxOAuthStatusInput = {
  stateStore: OAuthStateStore;
  flowId: string;
};

export type GetMiniMaxOAuthStatusResult =
  | {
      ok: true;
      status: 'pending' | 'authorized' | 'failed';
      verificationUrl?: string;
      userCode?: string;
      error?: string;
    }
  | { ok: false; error: 'not_found' | 'expired' };

/**
 * Read the current state of a flow. Used by the frontend to poll
 * for progress (until the popup-based approach is wired up to
 * receive a postMessage from the mmx callback).
 */
export async function getMiniMaxOAuthStatus(
  input: GetMiniMaxOAuthStatusInput,
): Promise<GetMiniMaxOAuthStatusResult> {
  const flow = await input.stateStore.get(input.flowId);
  if (!flow) {
    return { ok: false, error: 'not_found' };
  }
  if (flow.providerId !== MINIMAX_PROVIDER_ID) {
    return { ok: false, error: 'not_found' };
  }

  // Re-read tokens to see if mmx has written them yet
  const tokens = readMmxTokens();
  if (tokens) {
    const verificationUrl = flow.codeChallenge
      ? `https://platform.minimax.io/oauth-authorize?user_code=${flow.codeChallenge}&client=OpenAidy`
      : undefined;
    return {
      ok: true,
      status: 'authorized',
      ...(verificationUrl ? { verificationUrl } : {}),
      ...(flow.codeChallenge ? { userCode: flow.codeChallenge } : {}),
    };
  }

  return {
    ok: true,
    status: 'pending' as const,
    verificationUrl: flow.codeChallenge
      ? `https://platform.minimax.io/oauth-authorize?user_code=${flow.codeChallenge}&client=OpenAidy`
      : undefined,
    userCode: flow.codeChallenge || undefined,
  } as Extract<GetMiniMaxOAuthStatusResult, { ok: true }>;
}

// ── Internal: wire up a spawned mmx handle to a flow state ──────────────

async function wireMmxHandleToFlow(
  handle: MmxLoginHandle,
  input: StartMiniMaxOAuthInput,
): Promise<void> {
  // Background task: when mmx finishes (success or fail), persist the
  // tokens (or error) and clean up the state.
  handle.done
    .then(async (result) => {
      if (result.ok) {
        // Persist tokens to provider_credentials.
        // We do this lazily here; a separate "complete" call from the
        // frontend could also be added. For now: auto-persist on success.
        try {
          const { ProviderCredentialsRepository } =
            await import('@openaidy/db');
          const { getEncryptionService } =
            await import('../../lib/encryption.js');
          const credentialsRepo = new ProviderCredentialsRepository(
            input.db as never,
            input.onCredentialPersisted
              ? { onChange: input.onCredentialPersisted }
              : {},
          );
          const encryption = getEncryptionService();
          const encrypted = encryption.encrypt(
            JSON.stringify({
              accessToken: result.tokens.access_token,
              refreshToken: result.tokens.refresh_token,
              expiresAt: new Date(result.tokens.expires_at).getTime(),
              region: result.tokens.region ?? input.region,
              account: result.tokens.account,
            }),
          );
          await credentialsRepo.upsert(MINIMAX_PROVIDER_ID, 'oauth', encrypted);
          log.info(
            `[DIAG-LOG] wireMmxHandleToFlow: tokens persisted to provider_credentials for flowId=${input.flowId}, accessTokenLength=${result.tokens.access_token.length}, refreshTokenLength=${result.tokens.refresh_token.length}`,
          );
        } catch (err) {
          // Log but don't crash — the user can retry
          log.error('Failed to persist MiniMax tokens:', err);
        }
      }
      // Clean up state regardless
      await input.stateStore.delete(input.flowId);
    })
    .catch(async () => {
      await input.stateStore.delete(input.flowId);
    });
}

// ── Re-exports for convenience ───────────────────────────────────────────

export {
  isMmxInstalled,
  readMmxTokens,
  type MiniMaxOAuthTokens,
  type MiniMaxLoginResult,
  type MmxLoginHandle,
  type SpawnMmxLoginOptions,
};
