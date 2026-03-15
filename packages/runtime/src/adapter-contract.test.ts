/**
 * Tests for the shared adapter contract test suite
 * 
 * This file tests the contract test utilities using the fake provider.
 */

import { describe, it, expect } from 'vitest';
import {
  describeProviderAdapterContract,
  validateAdapterContract,
  validateProviderDescriptor,
  createTestRequest,
  collectStreamEvents,
} from '../src/adapter-contract';
import {
  createFakeProvider,
  createNonStreamingFakeProvider,
  createAuthErrorFakeProvider,
  createRateLimitedFakeProvider,
  createTimeoutFakeProvider,
  createUnavailableFakeProvider,
  createFullCapabilityFakeProvider,
} from '../src/testing/fake-provider';
import type { ProviderDescriptor, ProviderCapability } from '../src/provider';
import { isProviderError } from '../src/errors';

describe('Adapter Contract Utilities', () => {
  describe('validateProviderDescriptor', () => {
    it('should validate a correct descriptor', () => {
      const descriptor: ProviderDescriptor = {
        id: 'test-provider',
        name: 'Test Provider',
        capabilities: ['text_generation'],
        vendorFamily: 'test',
      };

      const result = validateProviderDescriptor(descriptor);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject descriptor without id', () => {
      const descriptor = {
        name: 'Test Provider',
        capabilities: ['text_generation'],
        vendorFamily: 'test',
      } as unknown as ProviderDescriptor;

      const result = validateProviderDescriptor(descriptor);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject descriptor without name', () => {
      const descriptor = {
        id: 'test-provider',
        capabilities: ['text_generation'],
        vendorFamily: 'test',
      } as unknown as ProviderDescriptor;

      const result = validateProviderDescriptor(descriptor);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject descriptor without vendorFamily', () => {
      const descriptor = {
        id: 'test-provider',
        name: 'Test Provider',
        capabilities: ['text_generation'],
      } as unknown as ProviderDescriptor;

      const result = validateProviderDescriptor(descriptor);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject descriptor without capabilities array', () => {
      const descriptor = {
        id: 'test-provider',
        name: 'Test Provider',
        vendorFamily: 'test',
        capabilities: 'not-an-array',
      } as unknown as ProviderDescriptor;

      const result = validateProviderDescriptor(descriptor);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('createTestRequest', () => {
    it('should create a valid model request', () => {
      const request = createTestRequest('test-model');

      expect(request.model).toBe('test-model');
      expect(request.messages).toHaveLength(2);
      expect(request.messages[0]?.role).toBe('system');
      expect(request.messages[1]?.role).toBe('user');
      expect(request.maxTokens).toBeDefined();
      expect(request.temperature).toBeDefined();
    });
  });

  describe('collectStreamEvents', () => {
    it('should collect all events from a stream', async () => {
      const provider = createFakeProvider();
      const request = createTestRequest('fake-model', true);

      const { events, errors } = await collectStreamEvents(provider.invokeStream(request));

      expect(events.length).toBeGreaterThan(0);
      expect(errors.length).toBe(0);
    });

    it('should collect errors from a failing stream', async () => {
      const provider = createAuthErrorFakeProvider();
      const request = createTestRequest('fake-model', true);

      const { events, errors } = await collectStreamEvents(provider.invokeStream(request));

      // Should have at least started event and error
      expect(events.length).toBeGreaterThan(0);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe('Fake Provider Tests', () => {
  describe('createFakeProvider', () => {
    it('should create a provider with default options', () => {
      const provider = createFakeProvider();

      expect(provider.descriptor.id).toBe('fake-provider');
      expect(provider.descriptor.name).toBe('Fake Provider');
      expect(provider.descriptor.vendorFamily).toBe('fake');
      expect(provider.descriptor.capabilities).toContain('text_generation');
      expect(provider.descriptor.capabilities).toContain('streaming');
    });

    it('should create a provider with custom options', () => {
      const provider = createFakeProvider({
        id: 'custom-provider',
        name: 'Custom Provider',
        vendorFamily: 'custom',
        capabilities: ['text_generation', 'vision'],
      });

      expect(provider.descriptor.id).toBe('custom-provider');
      expect(provider.descriptor.name).toBe('Custom Provider');
      expect(provider.descriptor.vendorFamily).toBe('custom');
      expect(provider.hasCapability('vision')).toBe(true);
      expect(provider.hasCapability('streaming')).toBe(false);
    });

    it('should return models', async () => {
      const provider = createFakeProvider();
      const result = await provider.listModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it('should return specific model', async () => {
      const provider = createFakeProvider();
      const result = await provider.getModel('fake-model');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('fake-model');
      }
    });

    it('should return error for non-existent model', async () => {
      const provider = createFakeProvider();
      const result = await provider.getModel('non-existent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.model_not_found');
      }
    });

    it('should invoke successfully', async () => {
      const provider = createFakeProvider({ responseContent: 'Test response' });
      const request = createTestRequest('fake-model');
      const result = await provider.invoke(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Test response');
        expect(result.value.finishReason).toBe('stop');
      }
    });

    it('should stream successfully', async () => {
      const provider = createFakeProvider({ streamChunks: ['Hello', ' ', 'World'] });
      const request = createTestRequest('fake-model', true);

      const { events } = await collectStreamEvents(provider.invokeStream(request));

      expect(events[0]?.type).toBe('stream.started');
      const contentEvents = events.filter((e) => e.type === 'stream.content_delta');
      expect(contentEvents.length).toBe(3);
      expect(events[events.length - 1]?.type).toBe('stream.finished');
    });
  });

  describe('createNonStreamingFakeProvider', () => {
    it('should create a provider without streaming capability', () => {
      const provider = createNonStreamingFakeProvider();

      expect(provider.hasCapability('text_generation')).toBe(true);
      expect(provider.hasCapability('streaming')).toBe(false);
    });

    it('should reject streaming requests', async () => {
      const provider = createNonStreamingFakeProvider();
      const request = createTestRequest('fake-model', true);

      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.capability_unsupported');
      }
    });
  });

  describe('createAuthErrorFakeProvider', () => {
    it('should simulate auth errors', async () => {
      const provider = createAuthErrorFakeProvider();
      const request = createTestRequest('fake-model');
      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.auth.invalid');
        expect(result.error.retryable).toBe(false);
      }
    });
  });

  describe('createRateLimitedFakeProvider', () => {
    it('should simulate rate limit errors', async () => {
      const provider = createRateLimitedFakeProvider();
      const request = createTestRequest('fake-model');
      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.rate_limited');
        expect(result.error.retryable).toBe(true);
        expect(result.error.retryAfterMs).toBeDefined();
      }
    });
  });

  describe('createTimeoutFakeProvider', () => {
    it('should simulate timeout errors', async () => {
      const provider = createTimeoutFakeProvider();
      const request = createTestRequest('fake-model');
      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.timeout');
        expect(result.error.retryable).toBe(true);
      }
    });
  });

  describe('createUnavailableFakeProvider', () => {
    it('should simulate unavailable errors', async () => {
      const provider = createUnavailableFakeProvider();
      const request = createTestRequest('fake-model');
      const result = await provider.invoke(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('provider.unavailable');
        expect(result.error.retryable).toBe(true);
      }
    });
  });

  describe('createFullCapabilityFakeProvider', () => {
    it('should have all capabilities', () => {
      const provider = createFullCapabilityFakeProvider();

      const allCaps: ProviderCapability[] = [
        'text_generation',
        'streaming',
        'tool_calls',
        'vision',
        'audio_input',
        'audio_output',
        'embedding',
      ];

      for (const cap of allCaps) {
        expect(provider.hasCapability(cap)).toBe(true);
      }
    });
  });
});

describe('validateAdapterContract', () => {
  it('should pass all tests for a valid fake provider', async () => {
    const provider = createFakeProvider();
    const results = await validateAdapterContract(provider, {
      defaultModelId: 'fake-model',
    });

    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should fail for error-simulating provider', async () => {
    const provider = createAuthErrorFakeProvider();
    const results = await validateAdapterContract(provider, {
      defaultModelId: 'fake-model',
    });

    const invokeResult = results.find((r) => r.testName === 'invoke');
    expect(invokeResult?.passed).toBe(false);
  });
});

describe('describeProviderAdapterContract', () => {
  // Run the full contract test suite against the fake provider
  describeProviderAdapterContract('FakeProvider', {
    createProvider: () => createFakeProvider(),
    supportedCapabilities: ['text_generation', 'streaming', 'tool_calls'],
    defaultModelId: 'fake-model',
  });

  // Run against non-streaming provider
  describeProviderAdapterContract('NonStreamingFakeProvider', {
    createProvider: () => createNonStreamingFakeProvider(),
    supportedCapabilities: ['text_generation'],
    defaultModelId: 'fake-model',
  });

  // Run against full capability provider
  describeProviderAdapterContract('FullCapabilityFakeProvider', {
    createProvider: () => createFullCapabilityFakeProvider(),
    supportedCapabilities: [
      'text_generation',
      'streaming',
      'tool_calls',
      'vision',
      'audio_input',
      'audio_output',
      'embedding',
    ],
    defaultModelId: 'fake-model',
  });
});

describe('Error Normalization Contract Tests', () => {
  it('should return normalized auth error', async () => {
    const provider = createAuthErrorFakeProvider();
    const request = createTestRequest('fake-model');
    const result = await provider.invoke(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isProviderError(result.error)).toBe(true);
      expect(result.error.code).toBe('provider.auth.invalid');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('should return normalized rate limit error with retry info', async () => {
    const provider = createRateLimitedFakeProvider();
    const request = createTestRequest('fake-model');
    const result = await provider.invoke(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isProviderError(result.error)).toBe(true);
      expect(result.error.code).toBe('provider.rate_limited');
      expect(result.error.retryable).toBe(true);
      expect(result.error.retryAfterMs).toBe(60000);
    }
  });

  it('should return normalized timeout error', async () => {
    const provider = createTimeoutFakeProvider();
    const request = createTestRequest('fake-model');
    const result = await provider.invoke(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isProviderError(result.error)).toBe(true);
      expect(result.error.code).toBe('provider.timeout');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('should return normalized unavailable error', async () => {
    const provider = createUnavailableFakeProvider();
    const request = createTestRequest('fake-model');
    const result = await provider.invoke(request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isProviderError(result.error)).toBe(true);
      expect(result.error.code).toBe('provider.unavailable');
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('Stream Error Normalization', () => {
  it('should normalize stream errors', async () => {
    const provider = createAuthErrorFakeProvider();
    const request = createTestRequest('fake-model', true);

    const { events, errors } = await collectStreamEvents(provider.invokeStream(request));

    // Should have started event before error
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('stream.started');

    // Should have error
    expect(errors.length).toBeGreaterThan(0);
    const error = errors[0];
    expect(isProviderError(error)).toBe(true);
  });
});
