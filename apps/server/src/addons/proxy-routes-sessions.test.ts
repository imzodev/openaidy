/**
 * Addon proxy routes — session endpoints
 *
 * Tests the HTTP layer for:
 *   GET  /api/addon-proxy/sessions
 *   POST /api/addon-proxy/sessions
 *
 * Uses a minimal Fastify instance with the addonProxyRoutes plugin so we
 * exercise the full request → auth → permission → service path without
 * spinning up the entire application.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { addonProxyRoutes } from './proxy-routes';
import { AddonService } from './service';
import type { SessionMessageService } from '../sessions/service';
import type { Addon } from '@openaidy/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

function makeAddonService() {
  return new AddonService({
    repository: null as never,
    validator: null as never,
    jwtSecret: JWT_SECRET,
    openAidyVersion: '0.0.0',
  });
}

function makeEnabledAddon(addonId: string, permissions: string[]): Addon {
  return {
    id: 'db-row-id',
    addonId,
    name: 'Test Addon',
    version: '1.0.0',
    status: 'enabled',
    permissions,
    manifest: { permissions },
    config: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    installedBy: 'admin',
  } as unknown as Addon;
}

function makeSessionService(sessions: object[] = []): SessionMessageService {
  return {
    listSessions: vi.fn().mockResolvedValue(sessions),
    submitMessage: vi.fn().mockResolvedValue({
      ok: true,
      assistantMessage: { content: 'Agent response' },
    }),
  } as unknown as SessionMessageService;
}

/** Build a minimal Fastify app with the proxy routes registered */
async function buildProxyApp(opts: {
  addon: Addon | null;
  sessionService?: SessionMessageService;
}): Promise<{ app: FastifyInstance; token: string }> {
  const addonSvc = makeAddonService();

  // Generate a token for the addon (private method accessed via cast)
  const permissions = (opts.addon?.permissions as string[]) ?? [
    'sessions.list',
    'sessions.write',
  ];
  const addonId = opts.addon?.addonId ?? 'test-addon';
  const token = (
    addonSvc as unknown as {
      generateAccessToken: (id: string, perms: string[]) => string;
    }
  ).generateAccessToken(addonId, permissions);

  vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
    opts.addon as never,
  );
  vi.spyOn(addonSvc as never, 'recordUsage' as never).mockResolvedValue(
    undefined as never,
  );

  const app = Fastify({ logger: false });
  await app.register(addonProxyRoutes, {
    addonService: addonSvc,
    authMiddleware: null as never,
    internalApiBaseUrl: '',
    ...(opts.sessionService ? { sessionService: opts.sessionService } : {}),
  });

  return { app, token };
}

// ---------------------------------------------------------------------------
// GET /api/addon-proxy/sessions
// ---------------------------------------------------------------------------

describe('GET /api/addon-proxy/sessions', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    const setup = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['sessions.list']),
      sessionService: makeSessionService([
        { id: 's1', title: 'Session One' },
        { id: 's2', title: 'Session Two' },
      ]),
    });
    app = setup.app;
    token = setup.token;
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/sessions',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a malformed bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/sessions',
      headers: { authorization: 'Bearer not.a.real.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when addon lacks sessions.list permission', async () => {
    const { app: restrictedApp, token: restrictedToken } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['agents.invoke']), // no sessions.list
      sessionService: makeSessionService(),
    });
    const res = await restrictedApp.inject({
      method: 'GET',
      url: '/api/addon-proxy/sessions',
      headers: { authorization: `Bearer ${restrictedToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PERMISSION_DENIED');
  });

  it('returns 401 when addon is not found (token validation fails)', async () => {
    const { app: notFoundApp, token: notFoundToken } = await buildProxyApp({
      addon: null,
      sessionService: makeSessionService(),
    });
    const res = await notFoundApp.inject({
      method: 'GET',
      url: '/api/addon-proxy/sessions',
      headers: { authorization: `Bearer ${notFoundToken}` },
    });
    // validateToken calls getAddon internally; null → "Addon not found" → 401
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('INVALID_TOKEN');
  });

  it('returns empty sessions array when no sessionService is wired', async () => {
    const { app: noSvcApp, token: noSvcToken } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['sessions.list']),
      // no sessionService
    });
    const res = await noSvcApp.inject({
      method: 'GET',
      url: '/api/addon-proxy/sessions',
      headers: { authorization: `Bearer ${noSvcToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessions: [] });
  });

  it('returns sessions from the sessionService', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].id).toBe('s1');
    expect(body.sessions[1].id).toBe('s2');
  });
});

// ---------------------------------------------------------------------------
// POST /api/addon-proxy/sessions/:sessionId/messages
// ---------------------------------------------------------------------------

describe('POST /api/addon-proxy/sessions/:sessionId/messages', () => {
  let app: FastifyInstance;
  let token: string;
  let sessionSvc: SessionMessageService;

  beforeEach(async () => {
    sessionSvc = makeSessionService();
    const setup = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['sessions.write']),
      sessionService: sessionSvc,
    });
    app = setup.app;
    token = setup.token;
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/sessions/sess-123/messages',
      payload: { content: 'Hello', agentId: 'default' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when addon lacks sessions.write permission', async () => {
    const { app: restrictedApp, token: restrictedToken } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['sessions.list']), // no sessions.write
      sessionService: makeSessionService(),
    });
    const res = await restrictedApp.inject({
      method: 'POST',
      url: '/api/addon-proxy/sessions/sess-123/messages',
      headers: { authorization: `Bearer ${restrictedToken}` },
      payload: { content: 'Hello', agentId: 'default' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PERMISSION_DENIED');
  });

  it('returns 400 when content or agentId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/sessions/sess-123/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Hello' }, // missing agentId
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_REQUEST');
  });

  it('returns 503 when no sessionService is wired', async () => {
    const { app: noSvcApp, token: noSvcToken } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['sessions.write']),
      // no sessionService
    });
    const res = await noSvcApp.inject({
      method: 'POST',
      url: '/api/addon-proxy/sessions/sess-123/messages',
      headers: { authorization: `Bearer ${noSvcToken}` },
      payload: { content: 'Hello', agentId: 'default' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('SERVICE_UNAVAILABLE');
  });

  it('sends message to existing session and returns agent response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/sessions/sess-123/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Summarize this', agentId: 'default' },
    });
    expect(res.statusCode).toBe(201);
    expect(sessionSvc.submitMessage).toHaveBeenCalledWith({
      sessionId: 'sess-123',
      role: 'user',
      content: 'Summarize this',
      agentId: 'default',
    });
    const body = res.json();
    expect(body.message).toBe('Agent response');
    expect(body.sessionId).toBe('sess-123');
  });
});
