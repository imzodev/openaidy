/**
 * Shared Adapter Contract Test Suite
 * 
 * This module provides a reusable test suite that validates provider adapters
 * behave consistently through the common ModelProvider interface.
 * 
 * Usage:
 * ```typescript
 * import { describeProviderAdapterContract } from '@openaidy/runtime/adapter-contract';
 * import { createMyProvider } from './my-provider';
 * 
 * describeProviderAdapterContract('MyProvider', {
 *   createProvider: () => createMyProvider({ apiKey: 'test-key' }),
 *   supportedCapabilities: ['text_generation', 'streaming'],
 *   defaultModelId: 'my-model',
 * });
 * ```
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type {
  ModelProvider,
  ProviderDescriptor,
  ProviderCapability,
  ModelRequest,
  ModelStreamEvent,
} from './provider';
import { isProviderError } from './errors';

/**
 * Configuration for the adapter contract tests
 */
export type AdapterContractConfig = {
  /** Factory function to create the provider instance */
  createProvider: () => ModelProvider | Promise<ModelProvider>;
  /** Capabilities that this provider supports (used to skip unsupported tests) */
  supportedCapabilities: readonly ProviderCapability[];
  /** Default model ID to use for tests */
  defaultModelId: string;
  /** Optional: skip specific tests by name */
  skipTests?: readonly string[];
  /** Optional: custom timeout for tests (ms) */
  timeout?: number;
};

/**
 * Test result for contract validation
 */
export type ContractTestResult = {
  passed: boolean;
  testName: string;
  error?: Error | undefined;
};

/**
 * Validates that a provider descriptor has all required fields
 */
export function validateProviderDescriptor(
  descriptor: ProviderDescriptor
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!descriptor.id || typeof descriptor.id !== 'string') {
    errors.push('Provider descriptor must have a valid "id" string');
  }

  if (!descriptor.name || typeof descriptor.name !== 'string') {
    errors.push('Provider descriptor must have a valid "name" string');
  }

  if (!descriptor.vendorFamily || typeof descriptor.vendorFamily !== 'string') {
    errors.push('Provider descriptor must have a valid "vendorFamily" string');
  }

  if (!Array.isArray(descriptor.capabilities)) {
    errors.push('Provider descriptor must have a "capabilities" array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a test request for invoking the provider
 */
export function createTestRequest(modelId: string, stream = false): ModelRequest {
  return {
    model: modelId,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Say "Hello, World!" and nothing else.' },
    ],
    maxTokens: 100,
    temperature: 0,
    stream,
  };
}

/**
 * Collects all events from a stream
 */
export async function collectStreamEvents(
  stream: AsyncIterable<{ ok: boolean; value?: ModelStreamEvent; error?: unknown }>
): Promise<{ events: ModelStreamEvent[]; errors: unknown[] }> {
  const events: ModelStreamEvent[] = [];
  const errors: unknown[] = [];

  for await (const result of stream) {
    if (result.ok && result.value) {
      events.push(result.value);
    } else if (!result.ok && result.error) {
      errors.push(result.error);
    }
  }

  return { events, errors };
}

/**
 * Creates the shared adapter contract test suite
 * 
 * @param providerName Name of the provider (used in test descriptions)
 * @param config Configuration for the tests
 * @param testFn The test function from vitest (describe/it)
 */
export function describeProviderAdapterContract(
  providerName: string,
  config: AdapterContractConfig,
  testFn: {
    describe: typeof describe;
    it: typeof it;
    beforeAll: typeof beforeAll;
  } = { describe, it, beforeAll }
): void {
  const { describe: d, it: i, beforeAll: b } = testFn;
  const {
    createProvider,
    supportedCapabilities,
    defaultModelId,
    skipTests = [],
    timeout = 10000,
  } = config;

  const shouldSkip = (testName: string) => skipTests.includes(testName);
  const hasCapability = (cap: ProviderCapability) => supportedCapabilities.includes(cap);

  d(`${providerName} Adapter Contract`, () => {
    let provider: ModelProvider;

    // Setup: Create provider before each test
    b(async () => {
      provider = await createProvider();
    });

    // =====================
    // Provider Descriptor Tests
    // =====================
    d('Provider Descriptor', () => {
      i(
        'should expose a valid descriptor',
        async () => {
          if (shouldSkip('descriptor exposure')) return;

          const descriptor = provider.descriptor;
          const validation = validateProviderDescriptor(descriptor);

          expect(validation.valid).toBe(true);
          expect(validation.errors).toHaveLength(0);
        },
        timeout
      );

      i(
        'should have a non-empty id',
        async () => {
          if (shouldSkip('descriptor id')) return;

          expect(provider.descriptor.id).toBeTruthy();
          expect(typeof provider.descriptor.id).toBe('string');
        },
        timeout
      );

      i(
        'should have a non-empty name',
        async () => {
          if (shouldSkip('descriptor name')) return;

          expect(provider.descriptor.name).toBeTruthy();
          expect(typeof provider.descriptor.name).toBe('string');
        },
        timeout
      );

      i(
        'should have a vendor family',
        async () => {
          if (shouldSkip('descriptor vendor family')) return;

          expect(provider.descriptor.vendorFamily).toBeTruthy();
          expect(typeof provider.descriptor.vendorFamily).toBe('string');
        },
        timeout
      );

      i(
        'should declare capabilities',
        async () => {
          if (shouldSkip('descriptor capabilities')) return;

          expect(Array.isArray(provider.descriptor.capabilities)).toBe(true);
          expect(provider.descriptor.capabilities.length).toBeGreaterThan(0);
        },
        timeout
      );
    });

    // =====================
    // Capability Declaration Tests
    // =====================
    d('Capability Declaration', () => {
      i(
        'should correctly report supported capabilities',
        async () => {
          if (shouldSkip('capability declaration')) return;

          for (const capability of supportedCapabilities) {
            expect(provider.hasCapability(capability)).toBe(true);
          }
        },
        timeout
      );

      i(
        'should correctly report unsupported capabilities',
        async () => {
          if (shouldSkip('unsupported capability')) return;

          const allCaps: readonly ProviderCapability[] = [
            'text_generation',
            'streaming',
            'tool_calls',
            'vision',
            'audio_input',
            'audio_output',
            'embedding',
          ];
          const unsupportedCaps = allCaps.filter(
            (cap) => !supportedCapabilities.includes(cap)
          );

          for (const capability of unsupportedCaps) {
            expect(provider.hasCapability(capability)).toBe(false);
          }
        },
        timeout
      );
    });

    // =====================
    // Model Listing Tests
    // =====================
    d('Model Listing', () => {
      i(
        'should list available models',
        async () => {
          if (shouldSkip('list models')) return;

          const result = await provider.listModels();

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(Array.isArray(result.value)).toBe(true);
            expect(result.value.length).toBeGreaterThan(0);
          }
        },
        timeout
      );

      i(
        'should return model descriptors with required fields',
        async () => {
          if (shouldSkip('model descriptor fields')) return;

          const result = await provider.listModels();

          if (result.ok && result.value.length > 0) {
            const model = result.value[0]!;
            expect(model.id).toBeTruthy();
            expect(model.providerId).toBe(provider.descriptor.id);
            expect(model.name).toBeTruthy();
            expect(Array.isArray(model.capabilities)).toBe(true);
          }
        },
        timeout
      );

      i(
        'should get a specific model by id',
        async () => {
          if (shouldSkip('get model')) return;

          const result = await provider.getModel(defaultModelId);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.id).toBe(defaultModelId);
            expect(result.value.providerId).toBe(provider.descriptor.id);
          }
        },
        timeout
      );

      i(
        'should return error for non-existent model',
        async () => {
          if (shouldSkip('model not found')) return;

          const result = await provider.getModel('non-existent-model-xyz');

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(isProviderError(result.error)).toBe(true);
            expect(result.error.code).toBe('provider.model_not_found');
          }
        },
        timeout
      );
    });

    // =====================
    // Non-Streaming Invocation Tests
    // =====================
    d('Non-Streaming Invocation', () => {
      i(
        'should successfully invoke the model',
        async () => {
          if (shouldSkip('invoke success')) return;

          const request = createTestRequest(defaultModelId);
          const result = await provider.invoke(request);

          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.id).toBeTruthy();
            expect(result.value.model).toBe(defaultModelId);
            expect(result.value.providerId).toBe(provider.descriptor.id);
            expect(result.value.content).toBeTruthy();
            expect(result.value.finishReason).toBeTruthy();
            expect(result.value.created).toBeTruthy();
          }
        },
        timeout
      );

      i(
        'should return usage information',
        async () => {
          if (shouldSkip('invoke usage')) return;

          const request = createTestRequest(defaultModelId);
          const result = await provider.invoke(request);

          if (result.ok) {
            expect(result.value.usage).toBeDefined();
            expect(typeof result.value.usage.promptTokens).toBe('number');
            expect(typeof result.value.usage.completionTokens).toBe('number');
            expect(typeof result.value.usage.totalTokens).toBe('number');
            expect(result.value.usage.totalTokens).toBe(
              result.value.usage.promptTokens + result.value.usage.completionTokens
            );
          }
        },
        timeout
      );

      i(
        'should return a valid finish reason',
        async () => {
          if (shouldSkip('invoke finish reason')) return;

          const request = createTestRequest(defaultModelId);
          const result = await provider.invoke(request);

          if (result.ok) {
            const validReasons = ['stop', 'length', 'tool_calls', 'content_filter', 'error'];
            expect(validReasons).toContain(result.value.finishReason);
          }
        },
        timeout
      );

      i(
        'should return ISO timestamp in created field',
        async () => {
          if (shouldSkip('invoke timestamp')) return;

          const request = createTestRequest(defaultModelId);
          const result = await provider.invoke(request);

          if (result.ok) {
            const created = new Date(result.value.created);
            expect(created).toBeInstanceOf(Date);
            expect(created.getTime()).not.toBeNaN();
          }
        },
        timeout
      );
    });

    // =====================
    // Streaming Invocation Tests
    // =====================
    d('Streaming Invocation', () => {
      b(async () => {
        // Skip entire streaming suite if not supported
        if (!hasCapability('streaming')) {
          return;
        }
      });

      i(
        'should successfully stream model output',
        async () => {
          if (shouldSkip('stream success') || !hasCapability('streaming')) return;

          const request = createTestRequest(defaultModelId, true);

          const { events, errors } = await collectStreamEvents(provider.invokeStream(request));

          // Should have at least started and finished events
          expect(events.length).toBeGreaterThan(0);
          expect(errors.length).toBe(0);
          expect(events[0]?.type).toBe('stream.started');
        },
        timeout
      );

      i(
        'should emit stream.started event first',
        async () => {
          if (shouldSkip('stream started') || !hasCapability('streaming')) return;

          const request = createTestRequest(defaultModelId, true);

          const { events } = await collectStreamEvents(provider.invokeStream(request));

          const startedEvent = events.find((e) => e.type === 'stream.started');
          expect(startedEvent).toBeDefined();
          if (startedEvent && startedEvent.type === 'stream.started') {
            expect(startedEvent.id).toBeTruthy();
            expect(startedEvent.model).toBe(defaultModelId);
            expect(startedEvent.providerId).toBe(provider.descriptor.id);
          }
        },
        timeout
      );

      i(
        'should emit content delta events',
        async () => {
          if (shouldSkip('stream content delta') || !hasCapability('streaming')) return;

          const request = createTestRequest(defaultModelId, true);

          const { events } = await collectStreamEvents(provider.invokeStream(request));

          const contentEvents = events.filter((e) => e.type === 'stream.content_delta');
          expect(contentEvents.length).toBeGreaterThan(0);
        },
        timeout
      );

      i(
        'should emit stream.finished event last',
        async () => {
          if (shouldSkip('stream finished') || !hasCapability('streaming')) return;

          const request = createTestRequest(defaultModelId, true);

          const { events } = await collectStreamEvents(provider.invokeStream(request));

          const lastEvent = events[events.length - 1];
          expect(lastEvent?.type).toBe('stream.finished');
          if (lastEvent && lastEvent.type === 'stream.finished') {
            const validReasons = ['stop', 'length', 'tool_calls', 'content_filter', 'error'];
            expect(validReasons).toContain(lastEvent.finishReason);
          }
        },
        timeout
      );

      i(
        'should emit usage event before finish',
        async () => {
          if (shouldSkip('stream usage') || !hasCapability('streaming')) return;

          const request = createTestRequest(defaultModelId, true);

          const { events } = await collectStreamEvents(provider.invokeStream(request));

          const usageEvent = events.find((e) => e.type === 'stream.usage');
          // Usage event is optional but if present, should have valid data
          if (usageEvent && usageEvent.type === 'stream.usage') {
            expect(usageEvent.usage).toBeDefined();
            expect(typeof usageEvent.usage.promptTokens).toBe('number');
            expect(typeof usageEvent.usage.completionTokens).toBe('number');
          }
        },
        timeout
      );
    });

    // =====================
    // Error Normalization Tests
    // =====================
    d('Error Normalization', () => {
      i(
        'should return normalized error for invalid model',
        async () => {
          if (shouldSkip('error invalid model')) return;

          const request = createTestRequest('invalid-model-xyz-123');
          const result = await provider.invoke(request);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(isProviderError(result.error)).toBe(true);
          }
        },
        timeout
      );

      i(
        'should have valid error structure',
        async () => {
          if (shouldSkip('error structure')) return;

          const request = createTestRequest('invalid-model-xyz-123');
          const result = await provider.invoke(request);

          if (!result.ok) {
            const error = result.error;
            expect(typeof error.code).toBe('string');
            expect(typeof error.message).toBe('string');
            expect(typeof error.retryable).toBe('boolean');
          }
        },
        timeout
      );

      i(
        'should include provider id in error when available',
        async () => {
          if (shouldSkip('error provider id')) return;

          const request = createTestRequest('invalid-model-xyz-123');
          const result = await provider.invoke(request);

          if (!result.ok && result.error.providerId) {
            expect(result.error.providerId).toBe(provider.descriptor.id);
          }
        },
        timeout
      );
    });

    // =====================
    // Capability Rejection Tests
    // =====================
    d('Capability Rejection', () => {
      i(
        'should reject streaming request if not supported',
        async () => {
          if (shouldSkip('reject streaming') || hasCapability('streaming')) return;

          const request = createTestRequest(defaultModelId, true);

          const result = await provider.invoke(request);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe('provider.capability_unsupported');
          }
        },
        timeout
      );

      i(
        'should reject tool calls if not supported',
        async () => {
          if (shouldSkip('reject tool calls') || hasCapability('tool_calls')) return;

          const request: ModelRequest = {
            model: defaultModelId,
            messages: [{ role: 'user', content: 'What is the weather?' }],
            tools: [
              {
                name: 'get_weather',
                description: 'Get weather',
                parameters: { type: 'object', properties: {} },
              },
            ],
          };

          const result = await provider.invoke(request);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe('provider.capability_unsupported');
          }
        },
        timeout
      );
    });
  });
}

/**
 * Runs a quick contract validation and returns results
 * Useful for programmatic validation outside of test framework
 */
export async function validateAdapterContract(
  provider: ModelProvider,
  config: Partial<AdapterContractConfig> = {}
): Promise<ContractTestResult[]> {
  const results: ContractTestResult[] = [];
  const defaultModelId = config.defaultModelId || 'default-model';

  // Test 1: Descriptor validation
  try {
    const validation = validateProviderDescriptor(provider.descriptor);
    results.push({
      passed: validation.valid,
      testName: 'descriptor validation',
      error: validation.valid ? undefined : new Error(validation.errors.join(', ')),
    });
  } catch (e) {
    results.push({
      passed: false,
      testName: 'descriptor validation',
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }

  // Test 2: listModels
  try {
    const result = await provider.listModels();
    results.push({
      passed: result.ok,
      testName: 'list models',
      error: result.ok
        ? undefined
        : new Error(`listModels failed: ${result.error.message}`),
    });
  } catch (e) {
    results.push({
      passed: false,
      testName: 'list models',
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }

  // Test 3: getModel
  try {
    const result = await provider.getModel(defaultModelId);
    results.push({
      passed: result.ok,
      testName: 'get model',
      error: result.ok
        ? undefined
        : new Error(`getModel failed: ${result.error.message}`),
    });
  } catch (e) {
    results.push({
      passed: false,
      testName: 'get model',
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }

  // Test 4: invoke
  try {
    const request = createTestRequest(defaultModelId);
    const result = await provider.invoke(request);
    results.push({
      passed: result.ok,
      testName: 'invoke',
      error: result.ok
        ? undefined
        : new Error(`invoke failed: ${result.error.message}`),
    });
  } catch (e) {
    results.push({
      passed: false,
      testName: 'invoke',
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }

  return results;
}
