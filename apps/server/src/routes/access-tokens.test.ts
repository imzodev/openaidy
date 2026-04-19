import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

vi.mock('../lib/env', () => ({
  env: (() => {
    const appConfigPath = fileURLToPath(
      new URL('../../../.openaidy/test-sessions-config.json', import.meta.url),
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
      DB_KIND: 'sqlite',
      DATABASE_URL: undefined,
      SQLITE_PATH: fileURLToPath(
        new URL('../../../.openaidy/test-access-tokens.db', import.meta.url),
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
import type { CreateAccessTokenResponse } from '@openaidy/shared-types';
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
  new URL('../../../.openaidy/test-access-tokens.db', import.meta.url),
);

let app: FastifyInstance;

describe('Access Token Routes', () => {
  let adminToken: string;

  beforeEach(async () => {
    adminToken = await generateAdminToken();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(DB_PATH, { force: true });
  });

  describe('Auth guard', () => {
    it('returns 401 on POST /api/access-tokens without a token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        payload: { name: 'K', scopes: ['admin'] },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on GET /api/access-tokens without a token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/access-tokens',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on DELETE /api/access-tokens/:id without a token', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/access-tokens/any-id',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when token lacks admin scope', async () => {
      const auth = new AuthMiddleware({
        enabled: false,
        port: 3001,
        path: '/ws',
        maxConnections: 1000,
        heartbeatInterval: 30000,
        auth: { required: true, secret: 'test-secret', tokenExpiry: 86400000 },
        rateLimit: { max: 100, window: 60000 },
      });
      const limitedToken = await auth.generateToken({
        clientId: 'limited-user',
        type: 'access',
        scopes: ['sessions.read'],
        expiresIn: 86400000,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${limitedToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/access-tokens', () => {
    it('creates a token and returns the raw token once', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'My Token', scopes: ['sessions.read'] },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<CreateAccessTokenResponse>();
      expect(body.rawKey).toMatch(/^oat_/);
      expect(body.key.name).toBe('My Token');
      expect(body.key.scopes).toEqual(['sessions.read']);
      expect(body.key.revoked).toBe(false);
      expect(body.key.keyPrefix).toMatch(/^oat_/);
    });

    it('returns 400 when name is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { scopes: ['sessions.read'] },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when scopes array is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Token', scopes: [] },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/access-tokens', () => {
    it('lists all tokens without exposing the raw token or hash', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Token A', scopes: ['admin'] },
      });
      await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Token B', scopes: ['sessions.read'] },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(200);
      const { keys } = response.json<{ keys: unknown[] }>();
      expect(keys).toHaveLength(2);

      for (const key of keys as Record<string, unknown>[]) {
        expect(key).not.toHaveProperty('keyHash');
        expect(key).not.toHaveProperty('rawKey');
        expect(key).toHaveProperty('keyPrefix');
        expect(key).toHaveProperty('scopes');
      }
    });
  });

  describe('POST /api/auth/verify (access token exchange)', () => {
    it('returns a JWT when a valid access token is submitted', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Auth Token', scopes: ['sessions.read'] },
      });
      const { rawKey } = createRes.json<CreateAccessTokenResponse>();

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: rawKey },
      });

      expect(verifyRes.statusCode).toBe(200);
      const body = verifyRes.json<{
        valid: boolean;
        token: string;
        scopes: string[];
        clientId: string;
      }>();
      expect(body.valid).toBe(true);
      expect(body.token).toBeDefined();
      expect(body.token.split('.')).toHaveLength(3);
      expect(body.scopes).toEqual(['sessions.read']);
    });

    it('returns 401 for a revoked access token', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Revoked Token', scopes: ['sessions.read'] },
      });
      const { key, rawKey } = createRes.json<CreateAccessTokenResponse>();

      await app.inject({
        method: 'DELETE',
        url: `/api/access-tokens/${key.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: rawKey },
      });

      expect(verifyRes.statusCode).toBe(401);
      expect(verifyRes.json<{ valid: boolean }>().valid).toBe(false);
    });

    it('returns 401 for an unknown access token', async () => {
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: {
          token:
            'oat_0000000000000000000000000000000000000000000000000000000000000000',
        },
      });

      expect(verifyRes.statusCode).toBe(401);
    });

    it('returns 401 for an expired access token', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Expired Token',
          scopes: ['sessions.read'],
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      });
      const { rawKey } = createRes.json<CreateAccessTokenResponse>();

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: rawKey },
      });

      expect(verifyRes.statusCode).toBe(401);
      expect(verifyRes.json<{ valid: boolean }>().valid).toBe(false);
    });
  });

  describe('DELETE /api/access-tokens/:id', () => {
    it('revokes an existing token', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/access-tokens',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'Revokable Token', scopes: ['sessions.read'] },
      });
      const { key } = createResponse.json<CreateAccessTokenResponse>();

      const revokeResponse = await app.inject({
        method: 'DELETE',
        url: `/api/access-tokens/${key.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(revokeResponse.statusCode).toBe(200);
      const body = revokeResponse.json<{ key: { revoked: boolean } }>();
      expect(body.key.revoked).toBe(true);
    });

    it('returns 404 for a non-existent token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/access-tokens/nonexistent-id',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
