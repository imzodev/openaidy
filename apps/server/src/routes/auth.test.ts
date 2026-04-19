import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

vi.mock('../lib/env', () => ({
  env: (() => {
    const appConfigPath = fileURLToPath(
      new URL('../../../.openaidy/test-auth-config.json', import.meta.url),
    );
    const appConfigTemplatePath = fileURLToPath(
      new URL('../../../../config/openaidy.template.json', import.meta.url),
    );
    const bootstrapAdminTokenPath = fileURLToPath(
      new URL('../../../.openaidy/test-bootstrap-admin.json', import.meta.url),
    );

    return {
      HOST: '0.0.0.0',
      PORT: 3001,
      CORS_ORIGIN: 'http://localhost:3000',
      DB_KIND: 'disabled',
      DATABASE_URL: undefined,
      SQLITE_PATH: undefined,
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
      WS_ENABLED: true,
      WS_PORT: 3001,
      WS_PATH: '/ws',
      WS_MAX_CONNECTIONS: 1000,
      WS_HEARTBEAT_INTERVAL: 30000,
      WS_AUTH_REQUIRED: true,
      WS_TOKEN_EXPIRY: 86400000,
      WS_TOKEN_SECRET: 'test-secret-for-auth-tests',
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
import { AuthMiddleware } from '../websocket/middleware/auth';

let app: FastifyInstance;

async function generateTestToken(): Promise<string> {
  const auth = new AuthMiddleware({
    enabled: true,
    port: 3001,
    path: '/ws',
    maxConnections: 1000,
    heartbeatInterval: 30000,
    auth: {
      required: true,
      secret: 'test-secret-for-auth-tests',
      tokenExpiry: 86400000,
    },
    rateLimit: { max: 100, window: 60000 },
  });
  return auth.generateToken({
    clientId: 'test-client',
    type: 'access',
    scopes: ['admin'],
    expiresIn: 86400000,
  });
}

describe('POST /api/auth/verify', () => {
  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when token is missing from body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.valid).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('returns 401 for an invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { token: 'not-a-valid-jwt' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.valid).toBe(false);
    expect(body.error).toBe('Invalid or expired token');
  });

  it('returns 200 with clientId and scopes for a valid token', async () => {
    const token = await generateTestToken();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { token },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.valid).toBe(true);
    expect(body.clientId).toBe('test-client');
    expect(body.scopes).toContain('admin');
    expect(body.expiresAt).toBeDefined();
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const wrongAuth = new AuthMiddleware({
      enabled: true,
      port: 3001,
      path: '/ws',
      maxConnections: 1000,
      heartbeatInterval: 30000,
      auth: { required: true, secret: 'wrong-secret', tokenExpiry: 86400000 },
      rateLimit: { max: 100, window: 60000 },
    });
    const token = await wrongAuth.generateToken({
      clientId: 'attacker',
      type: 'access',
      scopes: ['admin'],
      expiresIn: 86400000,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { token },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.valid).toBe(false);
  });
});
