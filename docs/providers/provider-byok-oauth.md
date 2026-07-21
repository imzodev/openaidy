# Provider BYOK OAuth — Implementation Phases

> **Goal:** Make connecting to an LLM provider frictionless. The user clicks a provider card, picks "Sign in", and a popup opens to the provider's auth page. After signing in, the provider is connected and immediately available to assign to any agent. No API key copy-paste, no client_id/secret, no manual setup.

**Reference implementations studied:** Hermes Agent (Nous Research) for MiniMax OAuth + OpenAI Codex OAuth + Google Gemini CLI OAuth. All three use a **device-code flow with PKCE** against a public OAuth endpoint published by the provider. No per-developer registration is required.

**Provider coverage (this spec, Phase 1):** MiniMax (global + CN). Other providers (OpenAI Codex, Google Gemini, xAI Grok) follow the same pattern and are scheduled in later phases.

---

## Architecture overview

### The user-facing flow (web)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Settings → Providers                                                │
│                                                                       │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐         │
│  │  MiniMax       │  │  OpenAI Codex  │  │  DeepSeek      │  ...    │
│  │  ✓ Connected   │  │  Connect       │  │  ✓ Connected   │         │
│  │  as user@...   │  │                │  │  via API key   │         │
│  └────────────────┘  └────────────────┘  └────────────────┘         │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ Click "Connect" on a provider
┌──────────────────────────────────────────────────────────────────────┐
│  DialogConnectProvider                                                │
│                                                                       │
│  How would you like to connect MiniMax?                             │
│                                                                       │
│  ◉ Sign in with MiniMax  (recommended)                              │
│     Uses your MiniMax account. No API key needed.                    │
│                                                                       │
│  ◯ Use an API key                                                     │
│     For users who already have an API key from platform.minimax.io   │
│                                                                       │
│  Region:  [ Global (minimax.io) ▾ ]  [ China (minimaxi.com) ]        │
│                                                                       │
│                                       [ Cancel ]  [ Continue ]       │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ Click "Continue" with "Sign in" selected
┌──────────────────────────────────────────────────────────────────────┐
│  Popup window opens to https://api.minimax.io/oauth/authorize        │
│                                                                       │
│  ┌────────────────────────────────────────────────────┐             │
│  │  MiniMax wants to access your account             │             │
│  │                                                     │             │
│  │  Sign in with your MiniMax credentials             │             │
│  │  ...                                                │             │
│  │  [ Authorize ]                                      │             │
│  └────────────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ User clicks Authorize
┌──────────────────────────────────────────────────────────────────────┐
│  Popup redirects to https://your-app.com/oauth/callback/minimax?     │
│    code=XXXX&state=YYYY                                              │
│                                                                       │
│  Server validates state, exchanges code for tokens,                 │
│  encrypts and persists, redirects popup to:                          │
│  https://your-app.com/oauth/complete?status=ok&provider=minimax    │
│                                                                       │
│  Parent window receives postMessage, closes popup,                  │
│  updates the provider card to "✓ Connected"                         │
└──────────────────────────────────────────────────────────────────────┘
```

### The CLI flow

```
$ openaidy providers connect minimax

   ┌─────────────────────────────────────────────────┐
   │  Connect MiniMax                                │
   │                                                  │
   │  1. Open this URL in any browser:               │
   │     https://api.minimax.io/oauth/authorize?     │
   │       code=ABCD-1234                             │
   │                                                  │
   │  2. Enter the code when prompted:                │
   │     WXYZ-7890                                    │
   │                                                  │
   │  Waiting for authorization...                    │
   └─────────────────────────────────────────────────┘

# (user completes in browser)

   ✓ Connected to MiniMax as user@example.com
   Available models: MiniMax-M3, MiniMax-M2.7, MiniMax-M2.7-highspeed
```

### Data flow (server-side)

```
User → POST /api/providers/minimax/connect/oauth/start
       │
       ├─ generate PKCE verifier + challenge + state
       ├─ store (state → {verifier, region, redirect_uri}) in Redis/SQLite with 10min TTL
       └─ return { authorizationUrl, state, deviceCode (for CLI flow) }

User → provider's /oauth/authorize (in popup or browser)
       ↓
Provider → redirect to /api/providers/minimax/connect/oauth/callback?code=...&state=...

Server (callback handler):
       │
       ├─ look up state in storage, retrieve verifier
       ├─ POST to provider's /oauth/token with { code, code_verifier }
       ├─ receive { access_token, refresh_token, expires_in }
       ├─ encrypt and persist in provider_credentials
       └─ redirect to frontend /oauth/complete?status=ok&provider=minimax

Frontend:
       │
       ├─ popup window receives the redirect
       ├─ parent window listens via postMessage or localStorage event
       └─ refresh provider list, close popup

Later (invocation):
       │
       ├─ ProviderConfigService.loadProvider("minimax")
       ├─ call connectionService.getCredentials("minimax")
       │     → if access_token expires in <60s, refresh first
       │     → return decrypted access_token
       └─ pass to adapter as apiKey
```

---

## Phase 1: MiniMax OAuth (real implementation)

This phase replaces the OAuth stub in `MiniMaxProfile` with a working device-code + PKCE flow against MiniMax's public OAuth endpoints. After this phase, a user can connect MiniMax from the web UI in ~20 seconds with no API key.

### Files to create

- `apps/server/src/providers/oauth/minimax.ts` — MiniMax-specific OAuth helpers (PKCE generation, state store)
- `apps/server/src/providers/oauth/state-store.ts` — Short-lived state → verifier map (Redis or SQLite)
- `apps/server/src/lib/oauth-flow.ts` — Generic OAuth flow runner (callback handler, refresh logic)
- `apps/server/src/routes/oauth-callback.ts` — Generic OAuth callback handler
- `apps/web/src/components/providers/PopupMessageListener.tsx` — Mounts a postMessage listener in the main window

### Files to modify

- `packages/providers/src/minimax/index.ts` — Override `getDeviceCodeInfo` and `pollDeviceCodeAuth` with real implementations
- `apps/server/src/providers/connection-service.ts` — Use the real profile methods, add state management
- `apps/server/src/routes/providers.ts` — Wire the OAuth start/callback routes with the new helpers
- `apps/web/src/components/providers/DialogConnectProvider.tsx` — Use popup + postMessage pattern
- `apps/web/src/components/settings/tabs/ProvidersTab.tsx` — Refresh list on `oauth:complete` event

### 1.1 — PKCE + state store (DB-backed in dev AND prod)

**New file: `apps/server/src/providers/oauth/state-store.ts`**

A short-lived (10 minute TTL) key-value store for OAuth state. Backed by the same SQLite/Postgres DB the rest of the app uses (`apps/server/data/openaidy.db` in dev, Postgres in prod). One implementation: `DbOAuthStateStore`. No in-memory variant — the user has been bitten by state-loss in multi-process / multi-restart scenarios before.

```ts
export type OAuthFlowState = {
  providerId: string;
  codeVerifier: string; // PKCE verifier
  codeChallenge: string; // S256 of verifier
  region?: 'global' | 'cn';
  redirectUri: string;
  createdAt: number; // epoch ms
};

export interface OAuthStateStore {
  put(state: string, value: OAuthFlowState): Promise<void>;
  get(state: string): Promise<OAuthFlowState | null>;
  delete(state: string): Promise<void>;
}
```

**Implementation: `DbOAuthStateStore`** — backed by a new `oauth_flow_state` table. The same table works on both SQLite (dev) and Postgres (prod) thanks to the dual-target pattern already in `packages/db/src/client.ts`.

### 1.2 — PKCE generation

**In `apps/server/src/providers/oauth/minimax.ts`:**

```ts
import { createHash, randomBytes } from 'node:crypto';

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString('base64url');
}
```

### 1.3 — MiniMax OAuth endpoints (overrides on `MiniMaxProfile`)

**Modify: `packages/providers/src/minimax/index.ts`**

```ts
override getDeviceCodeInfo(): DeviceCodeResponse | undefined {
  // MiniMax uses a hybrid flow: server-side state + PKCE.
  // The "device code" model is a good fit because:
  //   - it works for both popup (web) and print-code (CLI)
  //   - it doesn't require per-developer client_id/secret registration
  return {
    deviceCode: '',         // Filled by the server after generation
    userCode: '',           // Filled by the server after generation
    verificationUrl: 'https://api.minimax.io/oauth/authorize',
    expiresIn: 600,
    interval: 5,
  };
}
```

The actual `/oauth/code` + `/oauth/token` calls live in the server (`apps/server/src/providers/oauth/minimax.ts`), not in the profile, because they need access to the state store. The profile declares the **endpoints and flow shape**; the server orchestrates.

### 1.4 — Server-side OAuth orchestration

**New file: `apps/server/src/providers/oauth/minimax.ts`**

```ts
import { generatePkce, generateState } from './pkce.js';
import type { OAuthStateStore } from './state-store.js';
import type { DatabaseClient } from '@openaidy/db';
import { ProviderCredentialsRepository } from '@openaidy/db';
import { getEncryptionService } from '../../lib/encryption.js';
import type { DeviceCodeResponse } from '@openaidy/shared-types';

const MINIMAX_ENDPOINTS = {
  global: {
    authorize: 'https://api.minimax.io/oauth/authorize',
    code: 'https://api.minimax.io/oauth/code',
    token: 'https://api.minimax.io/oauth/token',
  },
  cn: {
    authorize: 'https://api.minimaxi.com/oauth/authorize',
    code: 'https://api.minimaxi.com/oauth/code',
    token: 'https://api.minimaxi.com/oauth/token',
  },
} as const;

export type MiniMaxRegion = keyof typeof MINIMAX_ENDPOINTS;

export async function startMiniMaxOAuth(opts: {
  stateStore: OAuthStateStore;
  region: MiniMaxRegion;
  redirectUri: string;
}): Promise<{ authorizationUrl: string; state: string }> {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const endpoints = MINIMAX_ENDPOINTS[opts.region];

  await opts.stateStore.put(state, {
    providerId: 'minimax',
    codeVerifier: verifier,
    codeChallenge: challenge,
    region: opts.region,
    redirectUri: opts.redirectUri,
    createdAt: Date.now(),
  });

  const authorizationUrl = new URL(endpoints.authorize);
  authorizationUrl.searchParams.set('code_challenge', challenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('redirect_uri', opts.redirectUri);
  // MiniMax-specific scopes: model access
  authorizationUrl.searchParams.set('scope', 'model:read model:write');

  return { authorizationUrl: authorizationUrl.toString(), state };
}

export async function exchangeMiniMaxCode(opts: {
  stateStore: OAuthStateStore;
  state: string;
  code: string;
  db: DatabaseClient;
}): Promise<{ success: boolean; error?: string; userHint?: string }> {
  const flowState = await opts.stateStore.get(opts.state);
  if (!flowState) {
    return { success: false, error: 'invalid_state' };
  }

  const endpoints = MINIMAX_ENDPOINTS[flowState.region ?? 'global'];
  const credentialsRepo = new ProviderCredentialsRepository(opts.db);
  const encryption = getEncryptionService();

  // Exchange code for tokens
  const tokenResponse = await fetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      code_verifier: flowState.codeVerifier,
      redirect_uri: flowState.redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    return { success: false, error: `token_exchange_failed: ${errorBody}` };
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
    user?: { id: string; email?: string };
  };

  // Encrypt and persist
  const encrypted = encryption.encrypt(
    JSON.stringify({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      region: flowState.region,
      user: tokens.user,
    }),
  );

  await credentialsRepo.upsert('minimax', 'oauth', encrypted);

  // Clean up state
  await opts.stateStore.delete(opts.state);

  return {
    success: true,
    userHint: tokens.user?.email,
  };
}

export async function refreshMiniMaxToken(opts: {
  db: DatabaseClient;
  refreshToken: string;
  region: MiniMaxRegion;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null> {
  const endpoints = MINIMAX_ENDPOINTS[opts.region];
  const response = await fetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
    }),
  });

  if (!response.ok) return null;

  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}
```

### 1.5 — Routes

**Modify: `apps/server/src/routes/providers.ts`**

Add the OAuth start and callback routes. They replace the current stub at lines 515-599.

```ts
// In the plugin, after the existing routes
const stateStore = db
  ? new DbOAuthStateStore(db)
  : new InMemoryOAuthStateStore();

/**
 * POST /providers/:providerId/connect/oauth/start
 *
 * Starts an OAuth flow. For web, returns the authorizationUrl to open
 * in a popup. For CLI (detected via X-Client-Type header), returns a
 * device-code response that the CLI polls.
 */
app.post(
  '/providers/:providerId/connect/oauth/start',
  async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const body = z
      .object({
        region: z.enum(['global', 'cn']).optional(),
        redirectUri: z.string().url(),
      })
      .parse(request.body);

    if (providerId !== 'minimax') {
      reply.code(400);
      return {
        success: false,
        error: `OAuth not yet implemented for ${providerId}`,
      };
    }

    const region = body.region ?? 'global';
    const result = await startMiniMaxOAuth({
      stateStore,
      region,
      redirectUri: body.redirectUri,
    });

    return { success: true, ...result };
  },
);

/**
 * GET /providers/minimax/connect/oauth/callback
 *
 * Receives the redirect from MiniMax after user authorization.
 * Exchanges the code for tokens and redirects the popup to the
 * frontend's completion page.
 */
app.get('/providers/minimax/connect/oauth/callback', async (request, reply) => {
  const { code, state, error } = request.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (error || !code || !state) {
    reply.redirect(
      `${config.appUrl}/oauth/complete?status=error&provider=minimax&reason=${encodeURIComponent(error ?? 'missing_code')}`,
    );
    return;
  }

  const result = await exchangeMiniMaxCode({ stateStore, state, code, db });
  if (!result.success) {
    reply.redirect(
      `${config.appUrl}/oauth/complete?status=error&provider=minimax&reason=${encodeURIComponent(result.error ?? 'unknown')}`,
    );
    return;
  }

  reply.redirect(`${config.appUrl}/oauth/complete?status=ok&provider=minimax`);
});
```

### 1.6 — Frontend popup + postMessage

**Modify: `apps/web/src/components/providers/DialogConnectProvider.tsx`**

```tsx
const handleConnect = async () => {
  if (authMethod() === 'oauth') {
    setIsConnecting(true);
    setError(null);

    try {
      // 1. Get the authorization URL from the server
      const redirectUri = `${window.location.origin}/api/providers/minimax/connect/oauth/callback`;
      const { authorizationUrl, state } = await startProviderOAuth('minimax', {
        region: region(),
        redirectUri,
      });

      // 2. Open a popup window
      const popup = window.open(
        authorizationUrl,
        'oauth-minimax',
        'width=600,height=700,scrollbars=yes',
      );

      if (!popup) {
        setError('Popup blocked. Please allow popups and try again.');
        setIsConnecting(false);
        return;
      }

      // 3. Wait for the popup to close (set in the callback page)
      //    OR for a postMessage from the callback page
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type !== 'oauth:complete') return;
        if (event.data?.provider !== 'minimax') return;

        window.removeEventListener('message', handleMessage);

        if (event.data.status === 'ok') {
          props.onConnected?.('minimax', 'oauth');
          props.onClose();
        } else {
          setError(event.data.reason ?? 'Authorization failed');
        }
        setIsConnecting(false);
      };

      window.addEventListener('message', handleMessage);

      // 4. Fallback: poll for popup closure
      const pollInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollInterval);
          window.removeEventListener('message', handleMessage);
          // If we didn't get a message, refresh state anyway
          // (user might have completed and closed manually)
          props.onConnected?.('minimax', 'oauth');
          props.onClose();
          setIsConnecting(false);
        }
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth failed');
      setIsConnecting(false);
    }
  }
};
```

**New file: `apps/web/src/pages/OAuthComplete.tsx`**

The page that the popup redirects to. It posts a message to the parent window and closes itself.

```tsx
import { useEffect } from 'solid-js';
import { useSearchParams } from '@solidjs/router';

export function OAuthCompletePage() {
  const [params] = useSearchParams();

  useEffect(() => {
    const status = params.status;
    const provider = params.provider;
    const reason = params.reason;

    if (window.opener) {
      window.opener.postMessage(
        { type: 'oauth:complete', provider, status, reason },
        window.location.origin,
      );
      window.close();
    }
  }, []);

  return <div>Completing authorization...</div>;
}
```

Add the route in `apps/web/src/App.tsx`:

```tsx
<Route path="/oauth/complete" component={OAuthCompletePage} />
```

### 1.7 — Tests

**Unit tests (`apps/server/src/providers/oauth/minimax.test.ts`):**

- `startMiniMaxOAuth` generates a valid PKCE pair and stores the state
- `exchangeMiniMaxCode` with a valid code persists encrypted credentials
- `exchangeMiniMaxCode` with an invalid state returns `invalid_state`
- `exchangeMiniMaxCode` with a token-exchange failure returns the error
- `refreshMiniMaxToken` with a valid refresh token returns new tokens
- `refreshMiniMaxToken` with an invalid refresh token returns `null`

**Integration tests (mocked HTTP, real DB):**

- Full happy path: start → callback → credentials persisted → retrievable
- Refresh flow: credentials near expiry → refresh called → new credentials persisted
- Cross-region: `cn` region uses `minimaxi.com` endpoints
- State expiration: state older than 10 minutes is rejected

**Test fixtures:**

Mock the HTTP layer with `nock` (already a devDep in the server package). The fixture responses match MiniMax's documented format.

---

## Phase 2: Bridge vault → invocation

This is the actual "connect → assign to agent → works" piece. The agent's `model` field is `"minimax/MiniMax-M3"`. The runtime needs to find MiniMax's access_token somewhere — currently it only looks at `env.MINIMAX_API_KEY`. This phase teaches it to look at the connection-service vault first.

### Files to modify

- `apps/server/src/providers/config-service.ts` — Add `connectionService` as an optional dep
- `apps/server/src/app.ts` — Wire `ProviderConfigService` with the connection service
- `apps/server/src/providers/connection-service.ts` — Add `getValidAccessToken(providerId)` that refreshes if needed
- `apps/server/src/providers/registry.ts` — Register MiniMax as a built-in provider that uses the OAuth-backed credentials (instead of `apiKeyEnv`)

### 2.1 — `getValidAccessToken` with auto-refresh

**Modify: `apps/server/src/providers/connection-service.ts`:**

```ts
/**
 * Get a fresh access token for a provider, refreshing if needed.
 * Returns null if no credentials are stored.
 *
 * For OAuth providers: decrypts the stored tokens, checks expiry,
 * and refreshes if the access token is within 60s of expiring.
 * For API-key providers: returns the stored API key.
 */
async getValidAccessToken(
  providerId: string,
): Promise<{ apiKey: string; authMethod: 'api_key' | 'oauth' } | null> {
  const credential = await this.credentialsRepo.findByProviderId(providerId);
  if (!credential) return null;

  const decrypted = this.encryption.decrypt(credential.encryptedCredentials);

  if (credential.authMethod === 'api_key') {
    return { apiKey: decrypted, authMethod: 'api_key' };
  }

  // OAuth: parse the stored token bundle
  const tokens = JSON.parse(decrypted) as {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    region?: 'global' | 'cn';
  };

  if (tokens.expiresAt - Date.now() > 60_000) {
    return { apiKey: tokens.accessToken, authMethod: 'oauth' };
  }

  // Need to refresh
  if (providerId === 'minimax') {
    const refreshed = await refreshMiniMaxToken({
      db: this.db,
      refreshToken: tokens.refreshToken,
      region: tokens.region ?? 'global',
    });
    if (!refreshed) {
      // Refresh failed — mark credential as errored
      await this.credentialsRepo.setError(providerId, 'refresh_failed');
      return null;
    }

    // Re-encrypt and persist
    const newEncrypted = this.encryption.encrypt(
      JSON.stringify({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        region: tokens.region,
      }),
    );
    await this.credentialsRepo.upsert(providerId, 'oauth', newEncrypted);

    return { apiKey: refreshed.accessToken, authMethod: 'oauth' };
  }

  return null;
}
```

### 2.2 — ProviderConfigService reads from vault

**Modify: `apps/server/src/providers/config-service.ts`:**

```ts
export class ProviderConfigService {
  constructor(
    private readonly options: {
      secretProvider?: SecretProvider;
      connectionService?: ProviderConnectionService; // NEW
    } = {},
  ) {
    this.secretProvider =
      options.secretProvider ?? createDefaultSecretProvider();
  }

  async loadProvider(config: ProviderConfig): Promise<ConfigLoadResult> {
    // ... existing validation ...

    // NEW: Try vault first, fall back to apiKeyEnv
    let apiKey: string | null = null;

    if (this.options.connectionService) {
      const vaultCreds =
        await this.options.connectionService.getValidAccessToken(
          validConfig.id,
        );
      if (vaultCreds) {
        apiKey = vaultCreds.apiKey;
      }
    }

    if (!apiKey) {
      apiKey = envSecret(validConfig.apiKeyEnv) ?? null;
    }

    if (!apiKey) {
      return {
        ok: false,
        error: createProviderError(
          'provider.not_connected',
          `Provider "${validConfig.id}" has no credentials. Connect it in Settings → Providers.`,
          { providerId: validConfig.id },
        ),
      };
    }

    // Use apiKey in the resolved config
    const resolvedConfig: ResolvedProviderConfig = {
      ...resolveResult.value,
      apiKey,
    };
    // ... rest of the function unchanged ...
  }
}
```

### 2.3 — Wire in `app.ts`

**Modify: `apps/server/src/app.ts`:**

```ts
let connectionService: ProviderConnectionService | undefined;
let providerConfigService: ProviderConfigService | undefined;

if (dbAdapter) {
  connectionService = new ProviderConnectionService(dbAdapter);

  providerConfigService = new ProviderConfigService({
    secretProvider: createDefaultSecretProvider(),
    connectionService, // <-- vault is now reachable
  });
}
```

### 2.4 — Tests

- `getValidAccessToken` returns the stored key for `api_key` auth
- `getValidAccessToken` returns the access token for `oauth` when not expiring
- `getValidAccessToken` triggers a refresh when within 60s of expiry
- `getValidAccessToken` calls `setError` when refresh fails
- `loadProvider` prefers vault over `apiKeyEnv`
- `loadProvider` falls back to `apiKeyEnv` if vault has no entry
- `loadProvider` returns `provider.not_connected` if neither has credentials

---

## Phase 3: Agent form with provider/model selector

Replace the free-text `model` field in the agent creation/edit form with a dropdown that lists only models from connected providers. This is the "asignar a un agente" piece of the user's request.

### Files to modify

- `apps/web/src/components/agents/AgentForm.tsx` — Replace text input with selector (or add new component)
- `apps/web/src/components/providers/ModelSelector.tsx` — New component: dropdown grouped by provider
- `apps/server/src/agents/schema.ts` — Optional: add a refined validation that checks against connected providers
- `apps/server/src/routes/agents.ts` — Optional: server-side validation that the providerId in `model` is connected

### 3.1 — API: list connected providers with their models

**New file: `apps/server/src/routes/agent-models.ts`:**

```ts
app.get('/agents/available-models', async (request, reply) => {
  // Returns: { providers: [{ id, displayName, models: [{id, displayName}] }] }
  // Filtered to only providers that have valid credentials (vault or env).
  const available = await providerConfigService.listAvailableProviders();
  return { providers: available };
});
```

The endpoint returns the providers the agent can actually use, based on what the runtime would do. The UI then renders a dropdown of these.

### 3.2 — Frontend: ModelSelector component

**New file: `apps/web/src/components/providers/ModelSelector.tsx`:**

```tsx
import { For, Show, createSignal, createResource } from 'solid-js';
import type { ProviderInfo } from '@openaidy/shared-types';
import { listAvailableModels } from '../../lib/api';

interface ModelSelectorProps {
  value: string; // e.g. "minimax/MiniMax-M3"
  onChange: (model: string) => void;
}

export function ModelSelector(props: ModelSelectorProps) {
  const [data] = createResource(() => listAvailableModels());
  const [filter, setFilter] = createSignal('');

  return (
    <Show
      when={data()}
      fallback={<div class="loading">Loading providers...</div>}
    >
      <div class="model-selector">
        <input
          type="text"
          placeholder="Filter models..."
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
        <select
          value={props.value}
          onChange={(e) => props.onChange(e.currentTarget.value)}
          size={6}
        >
          <For each={data()!.providers}>
            {(provider) => (
              <optgroup label={provider.displayName}>
                <For each={provider.models.filter(/* filter logic */)}>
                  {(model) => (
                    <option value={`${provider.id}/${model.id}`}>
                      {model.displayName}
                    </option>
                  )}
                </For>
              </optgroup>
            )}
          </For>
        </select>
        <Show when={data()!.providers.length === 0}>
          <div class="empty-state">
            No providers connected.{' '}
            <a href="/settings/providers">Connect one →</a>
          </div>
        </Show>
      </div>
    </Show>
  );
}
```

### 3.3 — Wire into AgentForm

**Modify: `apps/web/src/components/agents/AgentForm.tsx`:**

Replace the `model` `<input>` with `<ModelSelector>`:

```tsx
<label>
  Model
  <ModelSelector
    value={formData().model}
    onChange={(v) => setFormData({ ...formData(), model: v })}
  />
</label>
```

### 3.4 — Server-side validation (optional but recommended)

**Modify: `apps/server/src/agents/schema.ts`:**

Add a custom refinement on the `model` field that checks the format and (if a connection service is reachable) the provider connection.

```ts
export const AgentSchema = z.object({
  // ... existing fields ...
  model: z
    .string()
    .regex(
      /^[a-z0-9-]+\/[a-z0-9_.-]+$/i,
      'Model must be in the format "providerId/modelId" (e.g. "minimax/MiniMax-M3")',
    ),
});
```

The runtime check (that the providerId in `model` is actually connected) happens at invocation time, not at form-submit time, because the user might disconnect a provider after creating the agent. The form validation just ensures the format is right; the runtime validation ensures it can actually be invoked.

---

## Phase 4: Cleanup and dead-code removal

After Phases 1-3, several pieces of the original `ProviderConnectionService` may be unused or duplicated. Clean up.

### Likely deletions

- The `OAuthAuthMethod`, `DeviceCodeAuthMethod` types in `shared-types/providers.ts` — replaced by per-provider implementations in `oauth/minimax.ts`
- The default `exchangeOAuthCode` and `pollDeviceCodeAuth` stubs on `ProviderProfile` — each provider implements its own
- The `getEncryptionService()` singleton — replaced by dependency injection for testability
- The `isProviderConnected()` sync method (which had a known bug returning `Promise` truthy)
- The `OAuthCompleteResult` type — replaced by a more specific `MiniMaxTokenResponse`

### Files to clean up

- `apps/server/src/lib/encryption.ts` — Convert from singleton to class with DI
- `packages/providers/src/types.ts` — Remove the default OAuth stubs
- `apps/server/src/providers/connection-service.ts` — Simplify after Phase 2's `getValidAccessToken` absorbs the logic
- `apps/web/src/components/providers/DialogConnectProvider.tsx` — Remove the API key code path **only if** the user's preference is OAuth-only (TBD)

---

## Phase 5: Add the same flow for OpenAI Codex, Google Gemini, xAI Grok

The pattern is identical for all of these. Each provider gets a `oauth/<provider>.ts` file with the same shape as `oauth/minimax.ts`, and `MiniMaxProfile` becomes `OpenAICodexProfile`, `GoogleGeminiProfile`, etc.

**Implementation order** (by user demand, once Phase 3 ships):

1. OpenAI Codex (most requested; matches `codex login` UX)
2. Google Gemini CLI (free tier OAuth)
3. xAI Grok SuperGrok OAuth

Each is a 100-200 line file, mostly copy-paste of the MiniMax one with provider-specific URL changes.

---

## Phase 6: Tests and docs

### 6.1 — E2E integration test

**New file: `apps/server/src/providers/__integration__/oauth-flow.test.ts`**

Uses a real SQLite database and `nock` for the HTTP layer. Tests the full flow:

1. Open provider
2. Start OAuth flow
3. Receive callback with code
4. Persist credentials
5. Load provider (verify vault is used)
6. Refresh token (verify auto-refresh)
7. Disconnect (verify cleanup)

### 6.2 — Update docs

- **`docs/providers/README.md`**: New overview page pointing to the phase specs
- **`docs/providers/provider-byok-oauth.md`** (this file): Already created
- **`docs/providers/known-limitations.md`**: Track:
  - OAuth is only implemented for MiniMax in Phase 1
  - State store is in-memory by default; DB-backed is opt-in
  - No multi-account support yet (one credential per provider)
  - Popup blockers require the user to enable popups for the app's domain

---

## Success criteria

- A user can connect MiniMax from the web UI in under 30 seconds with no copy-paste
- A user can connect MiniMax from the CLI in under 40 seconds with no copy-paste
- A user can disconnect and reconnect a provider without restarting the server
- The agent form only shows models from connected providers
- An agent with `model: "minimax/MiniMax-M3"` runs successfully after the user connects MiniMax via OAuth
- Token refresh happens transparently; the user never sees an auth error
- Disconnecting a provider fails the next agent run with a clear "provider not connected" error
- All 13+ pre-existing tsc errors are unchanged (no regressions)
- The new code adds no `any`, no `// TODO`, no dead-code paths

---

## Decision points for the user

These affect implementation. Defaults shown; confirm before coding.

| Question                              | Default                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MiniMax region default in the dialog? | Global (`minimax.io`); user can toggle to CN                                                                                                                                                             |
| State store backend?                  | **DB in dev AND prod** (`oauth_flow_state` table, same SQLite/Postgres dual-target pattern). No in-memory variant — we use the same DB the rest of the app uses (`apps/server/data/openaidy.db` in dev). |
| Token refresh window?                 | Refresh if expiring in <60s                                                                                                                                                                              |
| Popup blocker fallback?               | Show a "click to open in a new tab" link if the popup is blocked                                                                                                                                         |
| API key option in the dialog?         | Keep it for power users; OAuth is the default/recommended option                                                                                                                                         |
| Multi-account support?                | Out of scope for this phase; one credential per providerId                                                                                                                                               |
| Encryption                            | AES-256-GCM (already in place via `EncryptionService`)                                                                                                                                                   |
| State TTL                             | 10 minutes (matches typical OAuth code lifetimes)                                                                                                                                                        |
