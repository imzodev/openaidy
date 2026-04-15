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
      DB_KIND: 'disabled',
      DATABASE_URL: undefined,
      SQLITE_PATH: undefined,
      OPENAIDY_HOME: fileURLToPath(
        new URL('../../../.openaidy', import.meta.url),
      ),
      APP_CONFIG_PATH: appConfigPath,
      APP_CONFIG_TEMPLATE_PATH: appConfigTemplatePath,
      LOG_LEVEL: 'info',
      // Workspace configuration
      WORKSPACE_BASE_DIR: fileURLToPath(
        new URL('../../../.openaidy/workspaces', import.meta.url),
      ),
      // Bootstrap admin configuration
      BOOTSTRAP_ADMIN_ENABLED: true,
      BOOTSTRAP_ADMIN_TOKEN_PATH: bootstrapAdminTokenPath,
      BOOTSTRAP_ADMIN_CLIENT_ID: 'test-bootstrap-admin',
      BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS: 31536000000,
      // WebSocket configuration
      WS_ENABLED: true,
      WS_PORT: 3001,
      WS_PATH: '/ws',
      WS_MAX_CONNECTIONS: 1000,
      WS_HEARTBEAT_INTERVAL: 30000,
      WS_AUTH_REQUIRED: true,
      WS_TOKEN_EXPIRY: 86400000,
      WS_TOKEN_SECRET: 'test-secret',
      WS_RATE_LIMIT_MAX: 100,
      WS_RATE_LIMIT_WINDOW: 60000,
      // Pairing configuration
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
import type {
  ModelProvider,
  ProviderDescriptor,
  ModelRequest,
  ProviderResult,
  ModelResponse,
} from '@openaidy/runtime';
import { ok, err, createProviderError } from '@openaidy/runtime';

/**
 * Helper to create a mock provider for testing
 */
function createMockProvider(
  id: string,
  options: { shouldFail?: boolean } = {},
): ModelProvider {
  const descriptor: ProviderDescriptor = {
    id,
    name: `Mock Provider ${id}`,
    vendorFamily: 'mock',
    capabilities: ['text_generation', 'streaming'],
  };

  return {
    descriptor,
    listModels: async () => ok([]),
    getModel: async () =>
      err(createProviderError('provider.model_not_found', 'Not found')),
    hasCapability: (cap: string) =>
      descriptor.capabilities.includes(cap as never),
    invoke: async (
      request: ModelRequest,
    ): Promise<ProviderResult<ModelResponse>> => {
      if (options.shouldFail) {
        return err(
          createProviderError('provider.unavailable', 'Mock provider failed'),
        );
      }

      return ok({
        id: `resp_${Date.now()}`,
        model: request.model,
        providerId: id,
        content: `Mock response to: ${request.messages[request.messages.length - 1]?.content}`,
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
        finishReason: 'stop',
        created: new Date().toISOString(),
      });
    },
    invokeStream: async function* () {
      yield ok({
        type: 'stream.started' as const,
        timestamp: new Date().toISOString(),
        id: `stream_${Date.now()}`,
        model: 'mock-model',
        providerId: id,
      });
    },
  };
}

describe('Session Message Routes', { timeout: 15000 }, () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();

    // Register a mock provider for testing
    const mockProvider = createMockProvider('test-provider');
    app.services.providers.registry.register(mockProvider, {
      defaultModel: 'mock-model',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /sessions', () => {
    it('should create a new session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Test Session' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('Test Session');
    });

    it('should reject empty title', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: '' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /sessions', () => {
    it('should list sessions', async () => {
      // Create a session first
      await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Session 1' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/sessions',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /sessions/:sessionId/messages', () => {
    it('should submit a message and return assistant response', async () => {
      // Create a session
      const createResponse = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Chat Session' },
      });
      const session = createResponse.json();

      // Submit a message
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages`,
        payload: {
          role: 'user',
          content: 'Hello!',
          providerId: 'test-provider',
          modelId: 'mock-model',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.userMessage).toBeDefined();
      expect(body.userMessage.role).toBe('user');
      expect(body.userMessage.content).toBe('Hello!');
      expect(body.assistantMessage).toBeDefined();
      expect(body.assistantMessage.role).toBe('assistant');
      expect(body.assistantMessage.content).toContain('Mock response');
      expect(body.run).toBeDefined();
      expect(body.run.status).toBe('succeeded');
    });

    it('should reject invalid role', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Session' },
      });
      const session = createResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages`,
        payload: {
          role: 'invalid-role',
          content: 'Hello',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject empty content', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Session' },
      });
      const session = createResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages`,
        payload: {
          role: 'user',
          content: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/sessions/non-existent-session/messages',
        payload: {
          role: 'user',
          content: 'Hello',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('session.not_found');
    });
  });

  describe('GET /sessions/:sessionId/messages', () => {
    it('should list messages for a session', async () => {
      // Create a session
      const createResponse = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Chat' },
      });
      const session = createResponse.json();

      // Submit a message
      await app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages`,
        payload: {
          role: 'user',
          content: 'First message',
          providerId: 'test-provider',
        },
      });

      // List messages
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${session.id}/messages`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(2); // user + assistant
    });

    it('should return 404 for non-existent session', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/sessions/non-existent/messages',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /sessions/:sessionId/runs', () => {
    it('should list runs for a session', async () => {
      // Create a session
      const createResponse = await app.inject({
        method: 'POST',
        url: '/sessions',
        payload: { title: 'Chat' },
      });
      const session = createResponse.json();

      // Submit a message (creates a run)
      await app.inject({
        method: 'POST',
        url: `/sessions/${session.id}/messages`,
        payload: {
          role: 'user',
          content: 'Test',
          providerId: 'test-provider',
        },
      });

      // List runs
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${session.id}/runs`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].status).toBe('succeeded');
    });
  });
});

describe('Session isolation', { timeout: 15000 }, () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();

    // Register a mock provider
    const mockProvider = createMockProvider('isolation-provider');
    app.services.providers.registry.register(mockProvider, {
      defaultModel: 'isolation-model',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should isolate messages between sessions', async () => {
    // Create two sessions
    const session1Response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { title: 'Session 1' },
    });
    const session1 = session1Response.json();

    const session2Response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { title: 'Session 2' },
    });
    const session2 = session2Response.json();

    // Submit messages to both sessions
    await app.inject({
      method: 'POST',
      url: `/sessions/${session1.id}/messages`,
      payload: {
        role: 'user',
        content: 'Message to session 1',
        providerId: 'isolation-provider',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/sessions/${session2.id}/messages`,
      payload: {
        role: 'user',
        content: 'Message to session 2',
        providerId: 'isolation-provider',
      },
    });

    // Check messages are isolated
    const messages1Response = await app.inject({
      method: 'GET',
      url: `/sessions/${session1.id}/messages`,
    });
    const messages1 = messages1Response.json().items;

    const messages2Response = await app.inject({
      method: 'GET',
      url: `/sessions/${session2.id}/messages`,
    });
    const messages2 = messages2Response.json().items;

    // Each session should have 2 messages (user + assistant)
    expect(messages1.length).toBe(2);
    expect(messages2.length).toBe(2);

    // Messages should be different
    expect(messages1[0].content).toBe('Message to session 1');
    expect(messages2[0].content).toBe('Message to session 2');
  });

  it('should isolate runs between sessions', async () => {
    // Create two sessions
    const session1Response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { title: 'Session 1' },
    });
    const session1 = session1Response.json();

    const session2Response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { title: 'Session 2' },
    });
    const session2 = session2Response.json();

    // Submit messages to both sessions
    await app.inject({
      method: 'POST',
      url: `/sessions/${session1.id}/messages`,
      payload: {
        role: 'user',
        content: 'Test 1',
        providerId: 'isolation-provider',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/sessions/${session2.id}/messages`,
      payload: {
        role: 'user',
        content: 'Test 2',
        providerId: 'isolation-provider',
      },
    });

    // Check runs are isolated
    const runs1Response = await app.inject({
      method: 'GET',
      url: `/sessions/${session1.id}/runs`,
    });
    const runs1 = runs1Response.json().items;

    const runs2Response = await app.inject({
      method: 'GET',
      url: `/sessions/${session2.id}/runs`,
    });
    const runs2 = runs2Response.json().items;

    // Each session should have exactly 1 run
    expect(runs1.length).toBe(1);
    expect(runs2.length).toBe(1);

    // Runs should have different session IDs
    expect(runs1[0].sessionId).toBe(session1.id);
    expect(runs2[0].sessionId).toBe(session2.id);
  });
});
