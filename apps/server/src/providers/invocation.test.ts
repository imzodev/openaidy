import { describe, it, expect, beforeEach } from 'vitest';
import {
  ok,
  err,
  createProviderError,
  type ModelProvider,
  type ProviderDescriptor,
  type ModelRequest,
  type ModelStreamEvent,
} from '@openaidy/runtime';
import { ProviderRegistryService, createProviderRegistry } from './registry';
import { ProviderSelectionService, createProviderSelection } from './selection';
import { ModelInvocationService, createModelInvocation } from './invocation';

/**
 * Helper to create a mock provider with customizable behavior
 */
function createMockProvider(options?: {
  id?: string;
  capabilities?: string[];
  invokeResponse?: string;
  shouldFail?: boolean;
  streamError?: boolean;
}): ModelProvider {
  const id = options?.id ?? 'test-provider';
  const capabilities = options?.capabilities ?? ['text_generation', 'streaming'];
  
  const descriptor: ProviderDescriptor = {
    id,
    name: `Provider ${id}`,
    capabilities: capabilities as ProviderDescriptor['capabilities'],
    vendorFamily: 'test',
  };

  return {
    descriptor,
    listModels: async () =>
      ok([
        {
          id: 'test-model',
          providerId: id,
          name: 'Test Model',
          capabilities: capabilities.slice(0, 1) as ProviderDescriptor['capabilities'],
        },
      ]),
    getModel: async (modelId: string) => {
      if (modelId === 'test-model') {
        return ok({
          id: 'test-model',
          providerId: id,
          name: 'Test Model',
          capabilities: capabilities.slice(0, 1) as ProviderDescriptor['capabilities'],
        });
      }
      return err(createProviderError('provider.model_not_found', 'Model not found'));
    },
    hasCapability: (cap) => descriptor.capabilities.includes(cap),
    invoke: async (req: ModelRequest) => {
      if (options?.shouldFail) {
        return err(
          createProviderError('provider.unavailable', 'Provider failed', {
            providerId: id,
            modelId: req.model,
          })
        );
      }
      return ok({
        id: 'resp_123',
        model: req.model,
        providerId: id,
        content: options?.invokeResponse ?? 'Test response',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
        finishReason: 'stop' as const,
        created: new Date().toISOString(),
      });
    },
    invokeStream: async function* (req: ModelRequest): AsyncIterable<
      { ok: true; value: ModelStreamEvent } | { ok: false; error: ReturnType<typeof createProviderError> }
    > {
      if (options?.streamError) {
        yield err(
          createProviderError('provider.stream_error', 'Stream failed', {
            providerId: id,
            modelId: req.model,
          })
        );
        return;
      }
      yield ok({
        type: 'stream.started' as const,
        timestamp: new Date().toISOString(),
        id: 'stream_123',
        model: req.model,
        providerId: id,
      });
      yield ok({
        type: 'stream.content_delta' as const,
        timestamp: new Date().toISOString(),
        id: 'stream_123',
        delta: options?.invokeResponse ?? 'Hello',
      });
      yield ok({
        type: 'stream.finished' as const,
        timestamp: new Date().toISOString(),
        id: 'stream_123',
        finishReason: 'stop' as const,
      });
    },
  };
}

describe('ModelInvocationService', () => {
  let registry: ProviderRegistryService;
  let selection: ProviderSelectionService;
  let invocation: ModelInvocationService;

  beforeEach(() => {
    registry = createProviderRegistry();
    selection = createProviderSelection(registry);
    invocation = createModelInvocation(registry, selection);
  });

  describe('invoke', () => {
    it('should invoke a model successfully', async () => {
      const provider = createMockProvider();
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      const result = await invocation.invoke({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Test response');
        expect(result.value.providerId).toBe('test-provider');
      }
    });

    it('should use explicit provider override', async () => {
      const provider1 = createMockProvider({ id: 'provider-1', invokeResponse: 'Response 1' });
      const provider2 = createMockProvider({ id: 'provider-2', invokeResponse: 'Response 2' });
      
      registry.register(provider1);
      registry.register(provider2);
      registry.setDefault({ providerId: 'provider-1', modelId: 'test-model' });

      const result = await invocation.invoke(
        { model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] },
        { providerId: 'provider-2' }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Response 2');
      }
    });

    it('should use explicit model override', async () => {
      const provider = createMockProvider();
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'default-model' });

      const result = await invocation.invoke(
        { model: 'default-model', messages: [{ role: 'user', content: 'Hello' }] },
        { modelId: 'custom-model' }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe('custom-model');
      }
    });

    it('should return error for non-existent provider', async () => {
      registry.setDefault({ providerId: 'missing', modelId: 'test-model' });

      const result = await invocation.invoke({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
      }
    });

    it('should return error for disabled provider', async () => {
      const provider = createMockProvider();
      registry.register(provider, { enabled: false });
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      const result = await invocation.invoke({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
      }
    });

    it('should return error when provider lacks streaming capability', async () => {
      const provider = createMockProvider({
        id: 'no-stream',
        capabilities: ['text_generation'],
      });
      registry.register(provider);
      registry.setDefault({ providerId: 'no-stream', modelId: 'test-model' });

      const result = await invocation.invoke({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.capability_unsupported');
      }
    });

    it('should normalize provider errors', async () => {
      const provider = createMockProvider({ shouldFail: true });
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      const result = await invocation.invoke({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.providerId).toBe('test-provider');
      }
    });

    it('should include metadata in request', async () => {
      const provider = createMockProvider();
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      const result = await invocation.invoke(
        {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }],
          metadata: { userId: 'user-123' },
        },
        { metadata: { requestId: 'req-456' } }
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('invokeStream', () => {
    it('should stream events successfully', async () => {
      const provider = createMockProvider();
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      const events: ModelStreamEvent[] = [];
      for await (const result of invocation.invokeStream({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        expect(result.ok).toBe(true);
        if (result.ok) {
          events.push(result.value);
        }
      }

      expect(events).toHaveLength(3);
      expect(events[0]?.type).toBe('stream.started');
      expect(events[1]?.type).toBe('stream.content_delta');
      expect(events[2]?.type).toBe('stream.finished');
    });

    it('should yield selection error', async () => {
      // No provider registered

      const events = [];
      for await (const result of invocation.invokeStream({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(result);
      }

      expect(events).toHaveLength(1);
      expect(events[0]?.ok).toBe(false);
      if (!events[0]?.ok) {
        expect(events[0]?.error.code).toBe('provider.config_invalid');
      }
    });

    it('should yield capability error for non-streaming provider', async () => {
      const provider = createMockProvider({
        id: 'no-stream',
        capabilities: ['text_generation'],
      });
      registry.register(provider);
      registry.setDefault({ providerId: 'no-stream', modelId: 'test-model' });

      const events = [];
      for await (const result of invocation.invokeStream({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(result);
      }

      expect(events).toHaveLength(1);
      expect(events[0]?.ok).toBe(false);
      if (!events[0]?.ok) {
        expect(events[0]?.error.code).toBe('provider.capability_unsupported');
      }
    });

    it('should yield stream error from provider', async () => {
      const provider = createMockProvider({ streamError: true });
      registry.register(provider);
      registry.setDefault({ providerId: 'test-provider', modelId: 'test-model' });

      const events = [];
      for await (const result of invocation.invokeStream({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        events.push(result);
      }

      expect(events).toHaveLength(1);
      expect(events[0]?.ok).toBe(false);
      if (!events[0]?.ok) {
        expect(events[0]?.error.code).toBe('provider.stream_error');
      }
    });

    it('should use explicit provider override', async () => {
      const provider1 = createMockProvider({ id: 'provider-1' });
      const provider2 = createMockProvider({ id: 'provider-2', invokeResponse: 'Stream from 2' });
      
      registry.register(provider1);
      registry.register(provider2);
      registry.setDefault({ providerId: 'provider-1', modelId: 'test-model' });

      const events: ModelStreamEvent[] = [];
      for await (const result of invocation.invokeStream(
        { model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] },
        { providerId: 'provider-2' }
      )) {
        if (result.ok) {
          events.push(result.value);
        }
      }

      expect(events[0]?.providerId).toBe('provider-2');
    });
  });

  describe('getRegistry', () => {
    it('should return the registry instance', () => {
      expect(invocation.getRegistry()).toBe(registry);
    });
  });

  describe('getSelection', () => {
    it('should return the selection instance', () => {
      expect(invocation.getSelection()).toBe(selection);
    });
  });
});
