import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createProviderServices } from './providers';
import type { ModelProvider, ProviderDescriptor, ModelRequest, ProviderResult, ModelStreamEvent, ModelDescriptor } from '@openaidy/runtime';
import { err, createProviderError, ok } from '@openaidy/runtime';

describe('buildApp', () => {
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

describe('App services lifecycle', () => {
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

    // The registry in app.services should be the same instance used by routes
    const { registry } = app.services.providers;

    // Create a mock provider
    const mockProvider = createMockProvider('test-provider-lifecycle');

    // Register directly on the app's registry
    registry.register(mockProvider, { enabled: true });

    // Now check that the route can see this provider
    const response = await app.inject({
      method: 'GET',
      url: '/providers',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].id).toBe('test-provider-lifecycle');
  });

  it('enable/disable operations affect the shared registry', async () => {
    app = await buildApp();

    const { registry } = app.services.providers;
    const mockProvider = createMockProvider('test-toggle-provider');

    // Register provider
    registry.register(mockProvider, { enabled: true });

    // Verify it's visible via routes
    const listResponse1 = await app.inject({
      method: 'GET',
      url: '/providers',
    });
    expect(listResponse1.json().providers[0].enabled).toBe(true);

    // Disable via route
    const disableResponse = await app.inject({
      method: 'POST',
      url: '/providers/test-toggle-provider/disable',
    });
    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json().enabled).toBe(false);

    // Verify registry reflects the change
    expect(registry.isEnabled('test-toggle-provider')).toBe(false);

    // Verify routes see the disabled state
    const listResponse2 = await app.inject({
      method: 'GET',
      url: '/providers',
    });
    expect(listResponse2.json().providers[0].enabled).toBe(false);

    // Re-enable via route
    const enableResponse = await app.inject({
      method: 'POST',
      url: '/providers/test-toggle-provider/enable',
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
    expect(app1.services.providers.registry.has('app1-only-provider')).toBe(true);

    // App2 should NOT see the provider
    expect(app2.services.providers.registry.has('app1-only-provider')).toBe(false);

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
    {}
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
    hasCapability: (cap: string) => descriptor.capabilities.includes(cap as never),
    listModels: async (): Promise<ProviderResult<readonly ModelDescriptor[]>> => {
      return ok(mockModels);
    },
    getModel: async (modelId: string): Promise<ProviderResult<ModelDescriptor>> => {
      const model = mockModels.find(m => m.id === modelId);
      if (model) {
        return ok(model);
      }
      return err(createProviderError('provider.model_not_found', `Model ${modelId} not found`, { providerId: id }));
    },
    invoke: async (): Promise<ProviderResult<never>> => {
      return err(notImplementedError);
    },
    invokeStream: async function* (_request: ModelRequest): AsyncIterable<ProviderResult<ModelStreamEvent>> {
      yield err(notImplementedError);
    },
  };
}
