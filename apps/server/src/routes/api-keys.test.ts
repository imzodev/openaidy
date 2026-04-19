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
        new URL('../../../.openaidy/test-api-keys.db', import.meta.url),
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
import type { CreateApiKeyResponse } from '@openaidy/shared-types';
import { rm } from 'node:fs/promises';

const DB_PATH = fileURLToPath(
  new URL('../../../.openaidy/test-api-keys.db', import.meta.url),
);

let app: FastifyInstance;

describe('API Key Routes', () => {
  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(DB_PATH, { force: true });
  });

  describe('POST /api/keys', () => {
    it('creates a key and returns the raw key once', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/keys',
        payload: { name: 'My Key', scopes: ['sessions.read'] },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<CreateApiKeyResponse>();
      expect(body.rawKey).toMatch(/^oak_/);
      expect(body.key.name).toBe('My Key');
      expect(body.key.scopes).toEqual(['sessions.read']);
      expect(body.key.revoked).toBe(false);
      expect(body.key.keyPrefix).toMatch(/^oak_/);
    });

    it('returns 400 when name is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/keys',
        payload: { scopes: ['sessions.read'] },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when scopes array is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/keys',
        payload: { name: 'Key', scopes: [] },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/keys', () => {
    it('lists all keys without exposing the raw key or hash', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/keys',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'Key A', scopes: ['admin'] },
      });
      await app.inject({
        method: 'POST',
        url: '/api/keys',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'Key B', scopes: ['sessions.read'] },
      });

      const response = await app.inject({ method: 'GET', url: '/api/keys' });
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

  describe('POST /api/auth/verify (API key exchange)', () => {
    it('returns a JWT when a valid API key is submitted', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/keys',
        payload: { name: 'Auth Key', scopes: ['sessions.read'] },
      });
      const { rawKey } = createRes.json<CreateApiKeyResponse>();

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

    it('returns 401 for a revoked API key', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/keys',
        payload: { name: 'Revoked Key', scopes: ['sessions.read'] },
      });
      const { key, rawKey } = createRes.json<CreateApiKeyResponse>();

      await app.inject({ method: 'DELETE', url: `/api/keys/${key.id}` });

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: { token: rawKey },
      });

      expect(verifyRes.statusCode).toBe(401);
      expect(verifyRes.json<{ valid: boolean }>().valid).toBe(false);
    });

    it('returns 401 for an unknown API key', async () => {
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/verify',
        payload: {
          token:
            'oak_0000000000000000000000000000000000000000000000000000000000000000',
        },
      });

      expect(verifyRes.statusCode).toBe(401);
    });
  });

  describe('DELETE /api/keys/:id', () => {
    it('revokes an existing key', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/keys',
        payload: { name: 'Revokable Key', scopes: ['sessions.read'] },
      });
      const { key } = createResponse.json<CreateApiKeyResponse>();

      const revokeResponse = await app.inject({
        method: 'DELETE',
        url: `/api/keys/${key.id}`,
      });
      expect(revokeResponse.statusCode).toBe(200);
      const body = revokeResponse.json<{ key: { revoked: boolean } }>();
      expect(body.key.revoked).toBe(true);
    });

    it('returns 404 for a non-existent key', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/keys/nonexistent-id',
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
