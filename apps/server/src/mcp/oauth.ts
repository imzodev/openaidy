/**
 * OAuth sign-in for remote (http) MCP servers.
 *
 * The MCP SDK implements the client side of the MCP authorization spec —
 * protected-resource discovery (RFC 9728), dynamic client registration
 * (RFC 7591), PKCE and token refresh — behind the `OAuthClientProvider`
 * interface. This module supplies that provider (persisting everything to an
 * encrypted per-server blob) and drives the browser round-trip:
 *
 *   1. {@link McpOAuthService.startAuthorization} runs the SDK's `auth()` up
 *      to the point where it would redirect, captures the authorization URL
 *      and hands it to the UI, which opens it in a popup.
 *   2. The authorization server redirects to `/api/mcp/oauth/callback`, which
 *      calls {@link McpOAuthService.completeAuthorization} to exchange the
 *      code for tokens.
 *   3. Later connections pass {@link McpOAuthService.createProvider} to the
 *      HTTP transport, which attaches the access token and refreshes it.
 *
 * The server can't open a browser itself, so a background connection whose
 * tokens are missing or rejected ends in `UnauthorizedError` — surfaced to the
 * UI as "needs sign-in" rather than as a connection failure.
 */

import { createHash } from 'node:crypto';
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '@openaidy/config';
import {
  McpOAuthCredentialsRepository,
  type DatabaseClient,
} from '@openaidy/db';
import { getEncryptionService } from '../lib/encryption';
import { generateState } from '../providers/oauth/pkce';
import type { OAuthStateStore } from '../providers/oauth/state-store';
import type { EnvPlaceholderResolver } from './placeholder-resolver';

/** Path (under the `/api` prefix) the authorization server redirects back to. */
export const MCP_OAUTH_CALLBACK_PATH = '/api/mcp/oauth/callback';

/**
 * `providerId` prefix for MCP rows in the shared `oauth_flow_state` table, so
 * they never collide with model-provider flows.
 */
const FLOW_STATE_PREFIX = 'mcp:';

/** Everything persisted for one server between connections. */
export type McpOAuthData = {
  clientInformation?: OAuthClientInformationMixed | undefined;
  tokens?: OAuthTokens | undefined;
  codeVerifier?: string | undefined;
  discoveryState?: OAuthDiscoveryState | undefined;
  /** Redirect URL used at sign-in; must match at refresh/re-auth time. */
  redirectUrl?: string | undefined;
};

/** Persistence for {@link McpOAuthData}, keyed by server id. */
export interface McpOAuthStore {
  load(serverId: string): Promise<McpOAuthData | null>;
  save(serverId: string, data: McpOAuthData): Promise<void>;
  delete(serverId: string): Promise<void>;
}

/** DB-backed store; the blob is AES-256-GCM encrypted before it's written. */
export class DbMcpOAuthStore implements McpOAuthStore {
  private readonly repo: McpOAuthCredentialsRepository;

  constructor(db: DatabaseClient) {
    this.repo = new McpOAuthCredentialsRepository(db);
  }

  async load(serverId: string): Promise<McpOAuthData | null> {
    const encrypted = await this.repo.get(serverId);
    if (!encrypted) return null;
    return JSON.parse(
      getEncryptionService().decrypt(encrypted),
    ) as McpOAuthData;
  }

  async save(serverId: string, data: McpOAuthData): Promise<void> {
    await this.repo.put(
      serverId,
      getEncryptionService().encrypt(JSON.stringify(data)),
    );
  }

  async delete(serverId: string): Promise<void> {
    await this.repo.delete(serverId);
  }
}

/** In-memory store for tests and DB-less runs. */
export class InMemoryMcpOAuthStore implements McpOAuthStore {
  private readonly data = new Map<string, McpOAuthData>();

  async load(serverId: string): Promise<McpOAuthData | null> {
    const value = this.data.get(serverId);
    return value ? structuredClone(value) : null;
  }

  async save(serverId: string, data: McpOAuthData): Promise<void> {
    this.data.set(serverId, structuredClone(data));
  }

  async delete(serverId: string): Promise<void> {
    this.data.delete(serverId);
  }
}

/** Thrown when an OAuth server needs the user to sign in (again). */
export class McpAuthRequiredError extends Error {
  constructor(serverId: string) {
    super(`MCP server ${serverId} requires sign-in`);
    this.name = 'McpAuthRequiredError';
  }
}

/** Whether a server config uses OAuth sign-in. */
export function usesOAuth(config: McpServerConfig): boolean {
  return config.transport === 'http' && config.auth?.type === 'oauth';
}

/**
 * `OAuthClientProvider` for one MCP server, backed by an {@link McpOAuthStore}.
 * Create via {@link McpOAuthClientProvider.create} so the stored data is
 * loaded up front — several provider members are synchronous getters.
 */
export class McpOAuthClientProvider implements OAuthClientProvider {
  /** Set when the SDK wants the user sent to the authorization server. */
  authorizationUrl: URL | undefined;

  private constructor(
    private readonly serverId: string,
    private readonly config: McpServerConfig,
    private readonly store: McpOAuthStore,
    private data: McpOAuthData,
    private readonly clientSecret: string | undefined,
    private readonly flowState: string | undefined,
  ) {}

  static async create(options: {
    config: McpServerConfig;
    store: McpOAuthStore;
    clientSecret?: string | undefined;
    /** Overrides the stored redirect URL (a fresh interactive sign-in). */
    redirectUrl?: string | undefined;
    /** OAuth `state` to send with the authorization request. */
    state?: string | undefined;
  }): Promise<McpOAuthClientProvider> {
    const { config, store } = options;
    const data = (await store.load(config.id)) ?? {};
    if (options.redirectUrl && options.redirectUrl !== data.redirectUrl) {
      data.redirectUrl = options.redirectUrl;
      // A dynamically registered client is bound to the redirect URIs it
      // registered with. Signing in from a different origin (localhost vs
      // the droplet's domain) needs a fresh registration.
      if (
        !config.auth?.clientId &&
        data.clientInformation &&
        !registeredRedirectUris(data.clientInformation).includes(
          options.redirectUrl,
        )
      ) {
        data.clientInformation = undefined;
      }
    }
    return new McpOAuthClientProvider(
      config.id,
      config,
      store,
      data,
      options.clientSecret,
      options.state,
    );
  }

  get redirectUrl(): string | undefined {
    return this.data.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    const scopes = this.config.auth?.scopes;
    return {
      client_name: 'OpenAidy',
      redirect_uris: this.data.redirectUrl ? [this.data.redirectUrl] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.clientSecret
        ? 'client_secret_post'
        : 'none',
      ...(scopes && scopes.length > 0 ? { scope: scopes.join(' ') } : {}),
    };
  }

  state(): string {
    return this.flowState ?? generateState();
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const clientId = this.config.auth?.clientId;
    if (clientId) {
      return {
        client_id: clientId,
        ...(this.clientSecret ? { client_secret: this.clientSecret } : {}),
      };
    }
    return this.data.clientInformation;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    await this.update({ clientInformation });
  }

  tokens(): OAuthTokens | undefined {
    return this.data.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.update({ tokens, codeVerifier: undefined });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Google only issues a refresh token when asked for offline access (and
    // only re-issues one on a consent prompt); without it the user would
    // have to sign in again every hour.
    if (authorizationUrl.hostname === 'accounts.google.com') {
      authorizationUrl.searchParams.set('access_type', 'offline');
      authorizationUrl.searchParams.set('prompt', 'consent');
    }
    this.authorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.update({ codeVerifier });
  }

  codeVerifier(): string {
    if (!this.data.codeVerifier) {
      throw new Error(`No pending sign-in for MCP server ${this.serverId}`);
    }
    return this.data.codeVerifier;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.data.discoveryState;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    await this.update({ discoveryState });
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    const cleared: McpOAuthData = {};
    if (scope === 'all' || scope === 'client') {
      cleared.clientInformation = undefined;
    }
    if (scope === 'all' || scope === 'tokens') cleared.tokens = undefined;
    if (scope === 'all' || scope === 'verifier') {
      cleared.codeVerifier = undefined;
    }
    if (scope === 'all' || scope === 'discovery') {
      cleared.discoveryState = undefined;
    }
    await this.update(cleared);
  }

  private async update(patch: Partial<McpOAuthData>): Promise<void> {
    this.data = { ...this.data, ...patch };
    await this.store.save(this.serverId, this.data);
  }
}

function registeredRedirectUris(info: OAuthClientInformationMixed): string[] {
  const uris = (info as { redirect_uris?: unknown }).redirect_uris;
  return Array.isArray(uris) ? uris.map(String) : [];
}

export type StartAuthorizationResult =
  | { status: 'authorized' }
  | { status: 'redirect'; authorizationUrl: string };

export type McpOAuthServiceOptions = {
  store: McpOAuthStore;
  /** Short-lived `state → server` mapping between start and callback. */
  flowStates: OAuthStateStore;
  /** Resolves `auth.clientSecret` (`${VAR}` reference or inline ciphertext). */
  resolver: EnvPlaceholderResolver;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: FetchLike | undefined;
};

/** Orchestrates sign-in, sign-out and token lookup for OAuth MCP servers. */
export class McpOAuthService {
  constructor(private readonly options: McpOAuthServiceOptions) {}

  /** Provider for a (non-interactive) connection using stored credentials. */
  async createProvider(
    config: McpServerConfig,
  ): Promise<McpOAuthClientProvider> {
    return McpOAuthClientProvider.create({
      config,
      store: this.options.store,
      clientSecret: this.resolveClientSecret(config),
    });
  }

  /** Whether the server has stored tokens (it may still reject them). */
  async hasTokens(serverId: string): Promise<boolean> {
    const data = await this.options.store.load(serverId);
    return !!data?.tokens?.access_token;
  }

  /**
   * Begin an interactive sign-in. `origin` is the browser origin the UI runs
   * on, so the redirect lands back on the same host whether OpenAidy is
   * reached via localhost, an IP, or a domain.
   */
  async startAuthorization(
    config: McpServerConfig,
    origin: string,
  ): Promise<StartAuthorizationResult> {
    const serverUrl = requireOAuthUrl(config);
    const redirectUrl = new URL(MCP_OAUTH_CALLBACK_PATH, origin).toString();
    const state = generateState();

    // Drop stale tokens first: the user asked to sign in, so don't let a
    // still-valid token short-circuit them into the old account.
    const existing = await this.options.store.load(config.id);
    if (existing?.tokens) {
      await this.options.store.save(config.id, {
        ...existing,
        tokens: undefined,
      });
    }

    const provider = await McpOAuthClientProvider.create({
      config,
      store: this.options.store,
      clientSecret: this.resolveClientSecret(config),
      redirectUrl,
      state,
    });

    const result = await auth(provider, {
      serverUrl,
      ...this.scopeOption(config),
      ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
    });
    if (result === 'AUTHORIZED') return { status: 'authorized' };
    if (!provider.authorizationUrl) {
      throw new Error(
        `MCP server ${config.id} did not provide an authorization URL`,
      );
    }

    const codeVerifier = provider.codeVerifier();
    await this.options.flowStates.put(state, {
      providerId: `${FLOW_STATE_PREFIX}${config.id}`,
      codeVerifier,
      codeChallenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
      region: null,
      redirectUri: redirectUrl,
      createdAt: Date.now(),
    });

    return {
      status: 'redirect',
      authorizationUrl: provider.authorizationUrl.toString(),
    };
  }

  /**
   * Resolve the server a callback's `state` belongs to. The state is
   * single-use: it's deleted here, so a replayed callback is rejected.
   */
  async consumeFlowState(
    state: string,
  ): Promise<{ serverId: string; origin: string } | null> {
    const flow = await this.options.flowStates.get(state);
    if (!flow || !flow.providerId.startsWith(FLOW_STATE_PREFIX)) return null;
    await this.options.flowStates.delete(state);
    return {
      serverId: flow.providerId.slice(FLOW_STATE_PREFIX.length),
      origin: new URL(flow.redirectUri).origin,
    };
  }

  /** Exchange the authorization code from the callback for tokens. */
  async completeAuthorization(
    config: McpServerConfig,
    authorizationCode: string,
  ): Promise<void> {
    const provider = await this.createProvider(config);
    const result = await auth(provider, {
      serverUrl: requireOAuthUrl(config),
      authorizationCode,
      ...this.scopeOption(config),
      ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
    });
    if (result !== 'AUTHORIZED') {
      throw new Error(`Sign-in for MCP server ${config.id} did not complete`);
    }
  }

  /** Forget all stored credentials for a server. */
  async signOut(serverId: string): Promise<void> {
    await this.options.store.delete(serverId);
  }

  private resolveClientSecret(config: McpServerConfig): string | undefined {
    const secret = config.auth?.clientSecret;
    if (secret === undefined) return undefined;
    return this.options.resolver.resolveRecord(
      { clientSecret: secret },
      `MCP server ${config.id} auth`,
    )?.['clientSecret'];
  }

  private scopeOption(config: McpServerConfig): { scope?: string } {
    const scopes = config.auth?.scopes;
    return scopes && scopes.length > 0 ? { scope: scopes.join(' ') } : {};
  }
}

function requireOAuthUrl(config: McpServerConfig): string {
  if (!usesOAuth(config) || !config.url) {
    throw new Error(`MCP server ${config.id} is not an OAuth http server`);
  }
  return config.url;
}
