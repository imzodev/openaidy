import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

vi.mock('../lib/env', () => ({
  env: (() => {
    const appConfigPath = fileURLToPath(
      new URL('../../../.openaidy/test-update-config.json', import.meta.url),
    );
    const appConfigTemplatePath = fileURLToPath(
      new URL('../../../../config/openaidy.template.json', import.meta.url),
    );
    const bootstrapAdminTokenPath = fileURLToPath(
      new URL(
        '../../../.openaidy/test-update-bootstrap-admin.json',
        import.meta.url,
      ),
    );
    return {
      HOST: '0.0.0.0',
      PORT: 3001,
      CORS_ORIGIN: 'http://localhost:3000',
      DB_KIND: 'sqlite',
      DATABASE_URL: undefined,
      SQLITE_PATH: fileURLToPath(
        new URL('../../../.openaidy/test-update.db', import.meta.url),
      ),
      OPENAIDY_HOME: fileURLToPath(
        new URL('../../../.openaidy', import.meta.url),
      ),
      APP_CONFIG_PATH: appConfigPath,
      APP_CONFIG_TEMPLATE_PATH: appConfigTemplatePath,
      LOG_LEVEL: 'silent',
      WORKSPACE_BASE_DIR: fileURLToPath(
        new URL('../../../.openaidy/workspaces', import.meta.url),
      ),
      BOOTSTRAP_ADMIN_ENABLED: true,
      BOOTSTRAP_ADMIN_TOKEN_PATH: bootstrapAdminTokenPath,
      BOOTSTRAP_ADMIN_CLIENT_ID: 'test-bootstrap-admin',
      BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS: 31536000000,
      WS_ENABLED: false,
      WS_PORT: 3001,
      WS_PATH: '/ws',
      WS_MAX_CONNECTIONS: 1000,
      WS_HEARTBEAT_INTERVAL: 30000,
      WS_AUTH_REQUIRED: false,
      WS_TOKEN_EXPIRY: 86400000,
      WS_TOKEN_SECRET: 'test-secret',
      WS_RATE_LIMIT_MAX: 100,
      WS_RATE_LIMIT_WINDOW: 60000,
      WS_PAIRING_CODE_LENGTH: 6,
      WS_PAIRING_CODE_EXPIRY_MS: 300000,
      WS_PAIRING_MAX_PENDING: 100,
      WS_PAIRING_TOKEN_EXPIRY_MS: 2592000000,
      WS_PAIRING_REQUIRE_ADMIN: true,
    };
  })(),
}));

import { buildApp } from '../app';
import type { FastifyInstance } from 'fastify';
import { rm } from 'node:fs/promises';
import { AuthMiddleware } from '../websocket/middleware/auth';

async function generateAdminToken(): Promise<string> {
  const auth = new AuthMiddleware({
    enabled: false,
    port: 3001,
    path: '/ws',
    maxConnections: 1000,
    heartbeatInterval: 30000,
    auth: { required: true, secret: 'test-secret', tokenExpiry: 86400000 },
    rateLimit: { max: 100, window: 60000 },
  });
  return auth.generateToken({
    clientId: 'test-admin',
    type: 'access',
    scopes: ['*'],
    expiresIn: 86400000,
  });
}

const DB_PATH = fileURLToPath(
  new URL('../../../.openaidy/test-update.db', import.meta.url),
);

/** Stub global fetch: npm registry `/latest` → `latest`, GitHub release → 404. */
function stubFetch(latest = '9.9.9', registryOk = true) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org')) {
        return {
          ok: registryOk,
          status: registryOk ? 200 : 503,
          statusText: registryOk ? 'OK' : 'Service Unavailable',
          json: async () => ({ version: latest }),
        } as Response;
      }
      // GitHub release notes: pretend there are none.
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      } as Response;
    });
}

let app: FastifyInstance;

describe('Update Routes', () => {
  let adminToken: string;

  beforeEach(async () => {
    adminToken = await generateAdminToken();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    await rm(DB_PATH, { force: true });
  });

  const auth = () => ({ authorization: `Bearer ${adminToken}` });

  describe('Auth guard', () => {
    it('returns 401 on GET /api/update/check without a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/update/check' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on POST /api/update without a token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/update' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on GET /api/update/status without a token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/update/status',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/update/check', () => {
    it('reports an available update and canSelfUpdate=false in dev/test', async () => {
      const fetchSpy = stubFetch('9.9.9');
      const res = await app.inject({
        method: 'GET',
        url: '/api/update/check',
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.latestVersion).toBe('9.9.9');
      expect(body.updateAvailable).toBe(true);
      // The test harness resolves to the monorepo, which cannot self-update.
      expect(body.canSelfUpdate).toBe(false);
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('returns 502 when the registry is unreachable', async () => {
      stubFetch('9.9.9', false);
      const res = await app.inject({
        method: 'GET',
        url: '/api/update/check',
        headers: auth(),
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('UPDATE_CHECK_FAILED');
    });
  });

  describe('GET /api/update/status', () => {
    it('returns idle on a fresh server', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/update/status',
        headers: auth(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('idle');
    });
  });

  describe('POST /api/update', () => {
    it('returns 409 UPDATE_NOT_SUPPORTED in dev/test (cannot self-update)', async () => {
      stubFetch('9.9.9');
      const res = await app.inject({
        method: 'POST',
        url: '/api/update',
        headers: auth(),
        payload: {},
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('UPDATE_NOT_SUPPORTED');
    });

    it('rejects a non-string version with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/update',
        headers: auth(),
        payload: { version: 123 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_BODY');
    });
  });
});
