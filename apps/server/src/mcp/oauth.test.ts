import { describe, it, expect, beforeEach } from 'vitest';
import type { McpServerConfig } from '@openaidy/config';
import {
  InMemoryMcpOAuthStore,
  McpAuthRequiredError,
  McpOAuthClientProvider,
  McpOAuthService,
  MCP_OAUTH_CALLBACK_PATH,
} from './oauth';
import { EnvPlaceholderResolver } from './placeholder-resolver';
import { createMcpClientService } from './client';
import type {
  OAuthFlowState,
  OAuthStateStore,
} from '../providers/oauth/state-store';

const SERVER_URL = 'https://mcp.example.com/mcp';
const AUTH_SERVER = 'https://auth.example.com';
const ORIGIN = 'http://localhost:3001';

class InMemoryFlowStates implements OAuthStateStore {
  readonly rows = new Map<string, OAuthFlowState>();
  async put(state: string, value: OAuthFlowState) {
    this.rows.set(state, value);
  }
  async get(state: string) {
    return this.rows.get(state) ?? null;
  }
  async delete(state: string) {
    this.rows.delete(state);
  }
}

type Recorded = { url: string; method: string; body: string };

/**
 * Minimal MCP authorization server: protected-resource metadata pointing at
 * an authorization server that supports dynamic registration, PKCE and the
 * authorization_code + refresh_token grants.
 */
function createFakeAuthServer() {
  const requests: Recorded[] = [];
  let registrations = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchFn = async (
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body =
      init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === 'string'
          ? init.body
          : '';
    requests.push({ url: url.toString(), method, body });

    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      if (url.host !== 'mcp.example.com') return json({}, 404);
      return json({
        resource: SERVER_URL,
        authorization_servers: [AUTH_SERVER],
      });
    }
    if (
      url.host === 'auth.example.com' &&
      url.pathname === '/.well-known/oauth-authorization-server'
    ) {
      return json({
        issuer: AUTH_SERVER,
        authorization_endpoint: `${AUTH_SERVER}/authorize`,
        token_endpoint: `${AUTH_SERVER}/token`,
        registration_endpoint: `${AUTH_SERVER}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      });
    }
    if (url.toString() === `${AUTH_SERVER}/register` && method === 'POST') {
      registrations += 1;
      const metadata = JSON.parse(body) as Record<string, unknown>;
      return json(
        { ...metadata, client_id: `dyn-client-${registrations}` },
        201,
      );
    }
    if (url.toString() === `${AUTH_SERVER}/token` && method === 'POST') {
      return json({
        access_token: 'access-1',
        token_type: 'Bearer',
        refresh_token: 'refresh-1',
        expires_in: 3600,
      });
    }
    return json({ error: 'not_found' }, 404);
  };

  return { fetchFn, requests, registrations: () => registrations };
}

function oauthServer(
  overrides: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    id: 'notion',
    transport: 'http',
    url: SERVER_URL,
    auth: { type: 'oauth' },
    ...overrides,
  };
}

describe('McpOAuthService', () => {
  let store: InMemoryMcpOAuthStore;
  let flowStates: InMemoryFlowStates;
  let fake: ReturnType<typeof createFakeAuthServer>;
  let service: McpOAuthService;

  beforeEach(() => {
    store = new InMemoryMcpOAuthStore();
    flowStates = new InMemoryFlowStates();
    fake = createFakeAuthServer();
    service = new McpOAuthService({
      store,
      flowStates,
      resolver: new EnvPlaceholderResolver({ GOOGLE_SECRET: 'shh' }),
      fetchFn: fake.fetchFn,
    });
  });

  it('registers dynamically and returns an authorization URL', async () => {
    const result = await service.startAuthorization(oauthServer(), ORIGIN);

    expect(result.status).toBe('redirect');
    if (result.status !== 'redirect') return;
    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${AUTH_SERVER}/authorize`);
    expect(url.searchParams.get('client_id')).toBe('dyn-client-1');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${ORIGIN}${MCP_OAUTH_CALLBACK_PATH}`,
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(flowStates.rows.get(state!)?.providerId).toBe('mcp:notion');
  });

  it('maps the callback state back to the server exactly once', async () => {
    const result = await service.startAuthorization(oauthServer(), ORIGIN);
    if (result.status !== 'redirect') throw new Error('expected redirect');
    const state = new URL(result.authorizationUrl).searchParams.get('state')!;

    await expect(service.consumeFlowState(state)).resolves.toEqual({
      serverId: 'notion',
      origin: ORIGIN,
    });
    await expect(service.consumeFlowState(state)).resolves.toBeNull();
    await expect(service.consumeFlowState('made-up')).resolves.toBeNull();
  });

  it('exchanges the code for tokens and persists them', async () => {
    await service.startAuthorization(oauthServer(), ORIGIN);
    const verifier = (await store.load('notion'))?.codeVerifier;
    expect(verifier).toBeTruthy();

    await service.completeAuthorization(oauthServer(), 'the-code');

    expect(await service.hasTokens('notion')).toBe(true);
    const stored = await store.load('notion');
    expect(stored?.tokens?.access_token).toBe('access-1');
    expect(stored?.codeVerifier).toBeUndefined();

    const tokenRequest = fake.requests.find((r) => r.url.endsWith('/token'));
    const params = new URLSearchParams(tokenRequest?.body);
    expect(params.get('code')).toBe('the-code');
    expect(params.get('code_verifier')).toBe(verifier);
    expect(params.get('client_id')).toBe('dyn-client-1');
  });

  it('uses a pre-registered client instead of registering', async () => {
    const config = oauthServer({
      auth: {
        type: 'oauth',
        clientId: 'google-client',
        clientSecret: '${GOOGLE_SECRET}',
        scopes: ['calendar.readonly'],
      },
    });

    const result = await service.startAuthorization(config, ORIGIN);
    if (result.status !== 'redirect') throw new Error('expected redirect');
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get('client_id')).toBe('google-client');
    expect(url.searchParams.get('scope')).toBe('calendar.readonly');
    expect(fake.registrations()).toBe(0);

    await service.completeAuthorization(config, 'code');
    const tokenRequest = fake.requests.find((r) => r.url.endsWith('/token'));
    expect(new URLSearchParams(tokenRequest?.body).get('client_secret')).toBe(
      'shh',
    );
  });

  it('asks Google for offline access so a refresh token is issued', async () => {
    const provider = await McpOAuthClientProvider.create({
      config: oauthServer(),
      store,
    });
    provider.redirectToAuthorization(
      new URL('https://accounts.google.com/o/oauth2/v2/auth?client_id=x'),
    );
    expect(provider.authorizationUrl?.searchParams.get('access_type')).toBe(
      'offline',
    );
    expect(provider.authorizationUrl?.searchParams.get('prompt')).toBe(
      'consent',
    );

    provider.redirectToAuthorization(new URL(`${AUTH_SERVER}/authorize`));
    expect(provider.authorizationUrl?.searchParams.has('access_type')).toBe(
      false,
    );
  });

  it('re-registers when signing in from a different origin', async () => {
    await service.startAuthorization(oauthServer(), ORIGIN);
    await service.startAuthorization(oauthServer(), ORIGIN);
    expect(fake.registrations()).toBe(1);

    await service.startAuthorization(
      oauthServer(),
      'https://agents.example.org',
    );
    expect(fake.registrations()).toBe(2);
  });

  it('signOut forgets everything', async () => {
    await service.startAuthorization(oauthServer(), ORIGIN);
    await service.completeAuthorization(oauthServer(), 'code');

    await service.signOut('notion');

    expect(await service.hasTokens('notion')).toBe(false);
    expect(await store.load('notion')).toBeNull();
  });
});

describe('McpClientService with OAuth servers', () => {
  it('reports needs_sign_in and refuses to connect without tokens', async () => {
    const service = new McpOAuthService({
      store: new InMemoryMcpOAuthStore(),
      flowStates: new InMemoryFlowStates(),
      resolver: new EnvPlaceholderResolver({}),
    });
    const client = createMcpClientService({
      oauth: service,
      uvxRepairer: null,
    });

    expect(await client.authStatus(oauthServer())).toBe('needs_sign_in');
    await expect(client.connect(oauthServer())).rejects.toBeInstanceOf(
      McpAuthRequiredError,
    );
    expect(client.isConnected('notion')).toBe(false);
  });

  it('reports none for servers without OAuth', async () => {
    const client = createMcpClientService({ uvxRepairer: null });
    expect(
      await client.authStatus({
        id: 'plain',
        transport: 'http',
        url: SERVER_URL,
      }),
    ).toBe('none');
  });
});
