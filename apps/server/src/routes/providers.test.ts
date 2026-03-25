import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

vi.mock('../lib/env', () => ({
  env: (() => {
    const appConfigPath = fileURLToPath(new URL('../../../.openaidy/test-providers-config.json', import.meta.url));
    const appConfigTemplatePath = fileURLToPath(new URL('../../../../config/openaidy.template.json', import.meta.url));

    return {
      HOST: '0.0.0.0',
      PORT: 3001,
      CORS_ORIGIN: 'http://localhost:3000',
      DB_KIND: 'disabled',
      DATABASE_URL: undefined,
      SQLITE_PATH: undefined,
      APP_CONFIG_PATH: appConfigPath,
      APP_CONFIG_TEMPLATE_PATH: appConfigTemplatePath,
      LOG_LEVEL: 'info',
    };
  })(),
}));

import { buildApp } from '../app';
import type { FastifyInstance } from 'fastify';

describe('Provider Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  describe('GET /providers', () => {
    it('should return empty providers list when no providers registered', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('providers');
      expect(body.providers).toEqual([]);
    });

    it('should return providers list with enabled filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers?enabled=true',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('providers');
    });
  });

  describe('GET /providers/health', () => {
    it('should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('providers');
      expect(body).toHaveProperty('timestamp');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    });

    it('should return unhealthy status when no providers registered', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('unhealthy');
    });
  });

  describe('POST /providers/test-invoke', () => {
    it('should reject invalid request payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          // Missing required 'messages' field
          providerId: 'test-provider',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject empty messages array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid message role', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [
            {
              role: 'invalid_role',
              content: 'Hello',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid temperature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'Hello',
            },
          ],
          temperature: 3, // Max is 2
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return error when no default provider configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [
            {
              role: 'user',
              content: 'Hello',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error.code).toBe('provider.config_invalid');
    });

    it('should return error for non-existent provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          providerId: 'non-existent-provider',
          messages: [
            {
              role: 'user',
              content: 'Hello',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error.code).toBe('provider.unavailable');
    });

    it('should accept valid request with all optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          providerId: 'test-provider',
          modelId: 'test-model',
          messages: [
            {
              role: 'system',
              content: 'You are helpful',
            },
            {
              role: 'user',
              content: 'Hello',
            },
          ],
          maxTokens: 100,
          temperature: 0.7,
          stream: false,
        },
      });

      // Will fail because provider doesn't exist, but validates input parsing
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('provider.unavailable');
    });
  });

  describe('GET /providers/:providerId', () => {
    it('should return 404 for non-existent provider', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers/non-existent-provider',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('Provider not found');
    });
  });

  describe('POST /providers/:providerId/enable', () => {
    it('should return 404 for non-existent provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/non-existent-provider/enable',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /providers/:providerId/disable', () => {
    it('should return 404 for non-existent provider', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/non-existent-provider/disable',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /providers/register', () => {
    it('should return 501 not implemented', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/register',
        payload: {},
      });

      expect(response.statusCode).toBe(501);
      const body = response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('Not implemented');
    });
  });
});

describe('Provider Routes with registered provider', () => {
  let app: FastifyInstance;

  // Note: In a real implementation, providers would be registered at app startup
  // For these tests, we're testing the route structure and error handling

  beforeEach(async () => {
    app = await buildApp();
  });

  describe('Error normalization', () => {
    it('should return normalized error for disabled provider', async () => {
      // First, we need to test the error response format
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          providerId: 'disabled-provider',
          messages: [
            {
              role: 'user',
              content: 'Test',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(body.error).toHaveProperty('retryable');
      expect(typeof body.error.retryable).toBe('boolean');
    });

    it('should return normalized error for capability mismatch', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          providerId: 'test-provider',
          messages: [
            {
              role: 'user',
              content: 'Test',
            },
          ],
          stream: true, // Requesting streaming capability
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.ok).toBe(false);
      expect(body.error).toHaveProperty('code');
    });
  });

  describe('Response format validation', () => {
    it('should return providers in correct format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      // Validate response structure
      expect(body).toHaveProperty('providers');
      expect(Array.isArray(body.providers)).toBe(true);
      
      // If there are providers, validate their structure
      if (body.providers.length > 0) {
        const provider = body.providers[0];
        expect(provider).toHaveProperty('id');
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('capabilities');
        expect(provider).toHaveProperty('vendorFamily');
        expect(provider).toHaveProperty('enabled');
        expect(provider).toHaveProperty('priority');
      }
    });

    it('should return health in correct format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      
      // Validate response structure
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('providers');
      expect(body).toHaveProperty('timestamp');
      
      // Validate status values
      expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
      
      // Validate timestamp is valid ISO string
      expect(() => new Date(body.timestamp)).not.toThrow();
      
      // Validate providers array structure
      expect(Array.isArray(body.providers)).toBe(true);
      
      if (body.providers.length > 0) {
        const provider = body.providers[0];
        expect(provider).toHaveProperty('id');
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('enabled');
        expect(provider).toHaveProperty('status');
        expect(['available', 'unavailable']).toContain(provider.status);
      }
    });
  });
});

describe('Input validation with Zod', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  describe('test-invoke schema validation', () => {
    it('should accept valid system message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [
            { role: 'system', content: 'You are helpful' },
          ],
        },
      });

      // Request is valid, will fail due to no provider
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('provider.config_invalid');
    });

    it('should accept valid assistant message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello!' },
            { role: 'user', content: 'How are you?' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('provider.config_invalid');
    });

    it('should accept valid tool message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [
            { role: 'tool', content: 'Tool result', toolCallId: 'call-123' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('provider.config_invalid');
    });

    it('should reject negative maxTokens', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: -10,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject zero maxTokens', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 0,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject negative temperature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: -0.5,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept temperature at boundary (0)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 0,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('provider.config_invalid');
    });

    it('should accept temperature at boundary (2)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
          temperature: 2,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('provider.config_invalid');
    });

    it('should reject non-boolean stream', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user', content: 'Hi' }],
          stream: 'yes',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject non-string content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user', content: 123 }],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ role: 'user' }],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing role', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/providers/test-invoke',
        payload: {
          messages: [{ content: 'Hello' }],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('providers query schema validation', () => {
    it('should accept enabled=true', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers?enabled=true',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should accept enabled=false', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers?enabled=false',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should work without query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/providers',
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
