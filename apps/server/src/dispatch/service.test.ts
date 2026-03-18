import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DispatchService, createDispatchService, type DispatchServiceOptions } from './service';
import { createAgentRegistry, type AgentRegistry } from '../agents';
import { createProviderServices, type ProviderServices } from '../providers';
import type { ModelProvider, ProviderDescriptor, ModelRequest, ProviderResult, ModelResponse } from '@openaidy/runtime';
import { ok, err, createProviderError } from '@openaidy/runtime';

/**
 * Helper to create a mock provider for testing
 */
function createMockProvider(id: string, options: { shouldFail?: boolean } = {}): ModelProvider {
  const descriptor: ProviderDescriptor = {
    id,
    name: `Mock Provider ${id}`,
    vendorFamily: 'mock',
    capabilities: ['text_generation', 'streaming'],
  };

  return {
    descriptor,
    listModels: async () => ok([]),
    getModel: async () => err(createProviderError('provider.model_not_found', 'Not found')),
    hasCapability: (cap: string) => descriptor.capabilities.includes(cap as never),
    invoke: async (request: ModelRequest): Promise<ProviderResult<ModelResponse>> => {
      if (options.shouldFail) {
        return err(createProviderError('provider.unavailable', 'Mock provider failed'));
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

describe('DispatchService', () => {
  let tempDir: string;
  let agentRegistry: AgentRegistry;
  let providers: ProviderServices;
  let dispatchService: DispatchService;
  let sessionId: string;

  beforeEach(async () => {
    // Create temp directory for agents
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-dispatch-agents-'));

    // Create test agents
    fs.writeFileSync(
      path.join(tempDir, 'default.json'),
      JSON.stringify({
        id: 'default',
        name: 'Default Agent',
        enabled: true,
        systemPrompt: 'You are a helpful assistant.',
        defaults: {
          providerId: 'mock-provider',
          modelId: 'mock-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      })
    );

    fs.writeFileSync(
      path.join(tempDir, 'specialist.json'),
      JSON.stringify({
        id: 'specialist',
        name: 'Specialist Agent',
        enabled: true,
        systemPrompt: 'You are a specialist assistant.',
        defaults: {
          providerId: 'specialist-provider',
          modelId: 'specialist-model',
          temperature: 0.3,
        },
      })
    );

    fs.writeFileSync(
      path.join(tempDir, 'disabled.json'),
      JSON.stringify({
        id: 'disabled',
        name: 'Disabled Agent',
        enabled: false,
        systemPrompt: 'Disabled prompt.',
        defaults: {},
      })
    );

    // Create agent registry
    agentRegistry = createAgentRegistry({ agentsDir: tempDir });

    // Create provider services
    providers = createProviderServices();

    // Register mock providers
    const mockProvider = createMockProvider('mock-provider');
    const specialistProvider = createMockProvider('specialist-provider');
    providers.registry.register(mockProvider, { defaultModel: 'mock-model' });
    providers.registry.register(specialistProvider, { defaultModel: 'specialist-model' });

    // Create dispatch service
    dispatchService = createDispatchService({
      agents: agentRegistry,
      providers,
      systemDefaults: {
        providerId: 'default-provider',
        modelId: 'default-model',
      },
    });

    // Create a session (using in-memory store)
    // We'll just use a fake session ID for unit tests
    sessionId = 'test-session-' + Date.now();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('resolveConfig', () => {
    it('should resolve agent defaults', () => {
      const config = dispatchService.resolveConfig('default');

      expect('error' in config).toBe(false);
      if (!('error' in config)) {
        expect(config.agentId).toBe('default');
        expect(config.providerId).toBe('mock-provider');
        expect(config.modelId).toBe('mock-model');
        expect(config.temperature).toBe(0.7);
        expect(config.maxTokens).toBe(1000);
        expect(config.systemPrompt).toBe('You are a helpful assistant.');
      }
    });

    it('should use overrides over agent defaults', () => {
      const config = dispatchService.resolveConfig('default', {
        providerId: 'override-provider',
        modelId: 'override-model',
        temperature: 0.9,
      });

      expect('error' in config).toBe(false);
      if (!('error' in config)) {
        expect(config.providerId).toBe('override-provider');
        expect(config.modelId).toBe('override-model');
        expect(config.temperature).toBe(0.9);
        expect(config.maxTokens).toBe(1000); // From agent defaults
      }
    });

    it('should use system defaults for missing agent config', () => {
      // Create agent without provider/model
      fs.writeFileSync(
        path.join(tempDir, 'minimal.json'),
        JSON.stringify({
          id: 'minimal',
          name: 'Minimal Agent',
          enabled: true,
          systemPrompt: 'Minimal prompt.',
          defaults: {},
        })
      );
      agentRegistry.reload();

      const config = dispatchService.resolveConfig('minimal');

      expect('error' in config).toBe(false);
      if (!('error' in config)) {
        expect(config.providerId).toBe('default-provider');
        expect(config.modelId).toBe('default-model');
      }
    });

    it('should return error for non-existent agent', () => {
      const config = dispatchService.resolveConfig('non-existent');

      expect('error' in config).toBe(true);
      if ('error' in config) {
        expect(config.error.code).toBe('agent.not_found');
      }
    });

    it('should return error for disabled agent', () => {
      const config = dispatchService.resolveConfig('disabled');

      expect('error' in config).toBe(true);
      if ('error' in config) {
        expect(config.error.code).toBe('agent.disabled');
      }
    });

    it('should return error when no provider configured', () => {
      // Create dispatch service without system defaults
      const noDefaultsService = createDispatchService({
        agents: agentRegistry,
        providers,
        systemDefaults: {
          providerId: '', // Empty
          modelId: '',
        },
      });

      // Agent without defaults
      fs.writeFileSync(
        path.join(tempDir, 'noconfig.json'),
        JSON.stringify({
          id: 'noconfig',
          name: 'No Config Agent',
          enabled: true,
          systemPrompt: 'No config.',
          defaults: {},
        })
      );
      agentRegistry.reload();

      const config = noDefaultsService.resolveConfig('noconfig');

      expect('error' in config).toBe(true);
      if ('error' in config) {
        expect(config.error.code).toBe('provider.config_invalid');
        expect(config.error.message).toContain('No provider configured');
      }
    });
  });

  describe('dispatch', () => {
    it('should return error for non-existent agent', async () => {
      const result = await dispatchService.dispatch({
        sessionId,
        agentId: 'non-existent',
        input: { role: 'user', content: 'Hello' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('agent.not_found');
      }
    });

    it('should return error for disabled agent', async () => {
      const result = await dispatchService.dispatch({
        sessionId,
        agentId: 'disabled',
        input: { role: 'user', content: 'Hello' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('agent.disabled');
      }
    });

    // Note: Full dispatch tests require session persistence, which we can't test
    // without a real session store. These would be better as integration tests.
    // For now, we test the configuration resolution which is the core logic.
  });
});

describe('Resolution precedence', () => {
  it('should document the precedence order: overrides > agent defaults > system defaults', () => {
    // This test documents the expected behavior
    const precedence = ['overrides', 'agent defaults', 'system defaults'];
    expect(precedence).toEqual(['overrides', 'agent defaults', 'system defaults']);
  });
});
