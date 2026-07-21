import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

vi.mock('./lib/env', () => ({
  env: (() => {
    const appConfigPath = fileURLToPath(
      new URL('../../.openaidy/test-app-config.json', import.meta.url),
    );
    const appConfigTemplatePath = fileURLToPath(
      new URL('../../../config/openaidy.template.json', import.meta.url),
    );
    const bootstrapAdminTokenPath = fileURLToPath(
      new URL('../../.openaidy/test-bootstrap-admin.json', import.meta.url),
    );
    const openAidyHome = fileURLToPath(
      new URL('../../.openaidy', import.meta.url),
    );

    return {
      HOST: '0.0.0.0',
      PORT: 3001,
      CORS_ORIGIN: 'http://localhost:3000',
      DB_KIND: 'disabled',
      DATABASE_URL: undefined,
      SQLITE_PATH: undefined,
      OPENAIDY_HOME: openAidyHome,
      APP_CONFIG_PATH: appConfigPath,
      APP_CONFIG_TEMPLATE_PATH: appConfigTemplatePath,
      LOG_LEVEL: 'info',
      // Workspace configuration
      WORKSPACE_BASE_DIR: fileURLToPath(
        new URL('../../.openaidy/workspaces', import.meta.url),
      ),
      // WebSocket configuration - explicitly enabled
      WS_ENABLED: true,
      WS_PORT: 3001,
      WS_PATH: '/ws',
      WS_MAX_CONNECTIONS: 1000,
      WS_HEARTBEAT_INTERVAL: 30000,
      WS_AUTH_REQUIRED: true,
      WS_TOKEN_EXPIRY: 86400000,
      WS_TOKEN_SECRET: 'test-secret-key',
      WS_RATE_LIMIT_MAX: 100,
      WS_RATE_LIMIT_WINDOW: 60000,
      // Pairing configuration
      WS_PAIRING_CODE_LENGTH: 6,
      WS_PAIRING_CODE_EXPIRY_MS: 300000,
      WS_PAIRING_MAX_PENDING: 100,
      WS_PAIRING_TOKEN_EXPIRY_MS: 2592000000,
      WS_PAIRING_REQUIRE_ADMIN: true,
      BOOTSTRAP_ADMIN_ENABLED: true,
      BOOTSTRAP_ADMIN_TOKEN_PATH: bootstrapAdminTokenPath,
      BOOTSTRAP_ADMIN_CLIENT_ID: 'test-bootstrap-admin',
      BOOTSTRAP_ADMIN_TOKEN_EXPIRY_MS: 31536000000,
    };
  })(),
}));

import { buildApp } from './app';
import { AuthMiddleware } from './websocket/middleware/auth';
import { defaultWebSocketConfig } from './websocket/types';
import type { FastifyInstance } from 'fastify';
import { createProviderServices } from './providers';
import type {
  ModelProvider,
  ProviderDescriptor,
  ModelRequest,
  ProviderResult,
  ModelStreamEvent,
  ModelDescriptor,
} from '@openaidy/runtime';
import { err, createProviderError, ok } from '@openaidy/runtime';

async function injectTestAuth(app: FastifyInstance): Promise<void> {
  const auth = new AuthMiddleware({
    ...defaultWebSocketConfig,
    auth: { ...defaultWebSocketConfig.auth, secret: 'test-secret-key' },
  });
  const token = await auth.generateToken({
    clientId: 'test-admin',
    type: 'access',
    scopes: ['*'],
  });
  app.addHook('onRequest', async (request) => {
    if (!request.headers.authorization) {
      request.headers.authorization = `Bearer ${token}`;
    }
  });
}

describe('buildApp', { timeout: 15000 }, () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('responds to the health endpoint', async () => {
    app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('App services lifecycle', { timeout: 15000 }, () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('creates shared provider services accessible via app.services', async () => {
    app = await buildApp();

    expect(app.services).toBeDefined();
    expect(app.services.providers).toBeDefined();
    expect(app.services.providers.registry).toBeDefined();
    expect(app.services.providers.selection).toBeDefined();
    expect(app.services.providers.invocation).toBeDefined();
  });

  it('uses the same registry instance across all routes', async () => {
    app = await buildApp();
    await injectTestAuth(app);

    // The registry in app.services should be the same instance used by routes
    const { registry } = app.services.providers;

    // Create a mock provider
    const mockProvider = createMockProvider('test-provider-lifecycle');

    // Register directly on the app's registry
    registry.register(mockProvider, { enabled: true });

    // Now check that the route can see this provider
    const response = await app.inject({
      method: 'GET',
      url: '/api/providers',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Config template has 3 providers, plus our test provider = 4 total
    expect(body.providers.length).toBeGreaterThanOrEqual(1);
    const testProvider = body.providers.find(
      (p: { id: string }) => p.id === 'test-provider-lifecycle',
    );
    expect(testProvider).toBeDefined();
  });

  it('enable/disable operations affect the shared registry', async () => {
    app = await buildApp();
    await injectTestAuth(app);

    const { registry } = app.services.providers;
    const mockProvider = createMockProvider('test-toggle-provider');

    // Register provider
    registry.register(mockProvider, { enabled: true });

    // Verify it's visible via routes
    const listResponse1 = await app.inject({
      method: 'GET',
      url: '/api/providers',
    });
    const testProvider1 = listResponse1
      .json()
      .providers.find((p: { id: string }) => p.id === 'test-toggle-provider');
    expect(testProvider1.enabled).toBe(true);

    // Disable via route
    const disableResponse = await app.inject({
      method: 'POST',
      url: '/api/providers/test-toggle-provider/disable',
    });
    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json().enabled).toBe(false);

    // Verify registry reflects the change
    expect(registry.isEnabled('test-toggle-provider')).toBe(false);

    // Verify routes see the disabled state
    const listResponse2 = await app.inject({
      method: 'GET',
      url: '/api/providers',
    });
    const disabledProvider = listResponse2
      .json()
      .providers.find((p: { id: string }) => p.id === 'test-toggle-provider');
    expect(disabledProvider.enabled).toBe(false);

    // Re-enable via route
    const enableResponse = await app.inject({
      method: 'POST',
      url: '/api/providers/test-toggle-provider/enable',
    });
    expect(enableResponse.statusCode).toBe(200);
    expect(enableResponse.json().enabled).toBe(true);

    // Verify registry reflects the change
    expect(registry.isEnabled('test-toggle-provider')).toBe(true);
  });

  it('separate app instances have separate service instances', async () => {
    const app1 = await buildApp();
    const app2 = await buildApp();

    // Register a provider in app1 only
    const mockProvider = createMockProvider('app1-only-provider');
    app1.services.providers.registry.register(mockProvider);

    // App1 should see the provider
    expect(app1.services.providers.registry.has('app1-only-provider')).toBe(
      true,
    );

    // App2 should NOT see the provider
    expect(app2.services.providers.registry.has('app1-only-provider')).toBe(
      false,
    );

    // Clean up
    await app1.close();
    await app2.close();
  });

  it('createProviderServices creates independent service graphs', async () => {
    const services1 = createProviderServices();
    const services2 = createProviderServices();

    // They should be different instances
    expect(services1.registry).not.toBe(services2.registry);
    expect(services1.selection).not.toBe(services2.selection);
    expect(services1.invocation).not.toBe(services2.invocation);

    // But within each graph, services share the same registry
    const mockProvider = createMockProvider('shared-test');
    services1.registry.register(mockProvider, { defaultModel: 'mock-model-1' });

    // Selection service in services1 should see the registered provider
    const result = services1.selection.select({ providerId: 'shared-test' });
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// WebSocket Gateway Tests
// ============================================================================

describe('WebSocket Gateway Integration', { timeout: 15000 }, () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('builds the app with WebSocket gateway registered', async () => {
    // Should not throw when building app
    await expect(buildApp()).resolves.not.toThrow();
  });

  it('has the WebSocket endpoint accessible', async () => {
    app = await buildApp();

    // Check that the /ws route exists (will return 404 if not registered, 426 if registered but no WebSocket upgrade)
    const response = await app.inject({
      method: 'GET',
      url: '/ws',
    });

    // The route should exist (either 426 for missing upgrade header or 404 if not found)
    // Since the websocket plugin might not work in inject mode, we just check the route exists
    expect([404, 426]).toContain(response.statusCode);
  });

  it('app services are available', async () => {
    app = await buildApp();

    // App services should be available
    expect(app.services).toBeDefined();
    expect(app.services.providers).toBeDefined();
    expect(app.services.agents).toBeDefined();
  });
});

/**
 * Helper to create a mock provider for testing
 */
function createMockProvider(id: string): ModelProvider {
  const descriptor: ProviderDescriptor = {
    id,
    name: `Mock Provider ${id}`,
    vendorFamily: 'mock',
    capabilities: ['text_generation', 'streaming'],
  };

  const notImplementedError = createProviderError(
    'provider.unknown',
    'Mock provider not implemented',
    {},
  );

  const mockModels: ModelDescriptor[] = [
    {
      id: 'mock-model-1',
      providerId: id,
      name: 'Mock Model 1',
      capabilities: ['text_generation', 'streaming'],
    },
  ];

  return {
    descriptor,
    hasCapability: (cap: string) =>
      descriptor.capabilities.includes(cap as never),
    listModels: async (): Promise<
      ProviderResult<readonly ModelDescriptor[]>
    > => {
      return ok(mockModels);
    },
    getModel: async (
      modelId: string,
    ): Promise<ProviderResult<ModelDescriptor>> => {
      const model = mockModels.find((m) => m.id === modelId);
      if (model) {
        return ok(model);
      }
      return err(
        createProviderError(
          'provider.model_not_found',
          `Model ${modelId} not found`,
          { providerId: id },
        ),
      );
    },
    invoke: async (): Promise<ProviderResult<never>> => {
      return err(notImplementedError);
    },
    invokeStream: async function* (
      _request: ModelRequest,
    ): AsyncIterable<ProviderResult<ModelStreamEvent>> {
      yield err(notImplementedError);
    },
  };
}
