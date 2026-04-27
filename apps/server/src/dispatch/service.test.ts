import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DispatchService, createDispatchService } from './service';
import { createAgentRegistry, type AgentRegistry } from '../agents';
import { createProviderServices, type ProviderServices } from '../providers';
import { RunEventEmitter, type RunEvent } from './events';
import { createSkillRegistry, type SkillRegistry } from '../skills';
import type { McpClientService } from '../mcp';
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

describe('DispatchService', () => {
  let tempDir: string;
  let agentRegistry: AgentRegistry;
  let providers: ProviderServices;
  let dispatchService: DispatchService;
  let sessionId: string;

  beforeEach(async () => {
    // Create temp directory for agents in the system temp dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-dispatch-agents-'));

    // Create test agents
    fs.writeFileSync(
      path.join(tempDir, 'default.json'),
      JSON.stringify({
        id: 'default',
        name: 'Default Agent',
        enabled: true,
        systemPrompt: 'You are a helpful assistant.',
        model: 'mock-provider/mock-model',
        defaults: {
          providerId: 'mock-provider',
          modelId: 'mock-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      }),
    );

    fs.writeFileSync(
      path.join(tempDir, 'specialist.json'),
      JSON.stringify({
        id: 'specialist',
        name: 'Specialist Agent',
        enabled: true,
        systemPrompt: 'You are a specialist assistant.',
        model: 'specialist-provider/specialist-model',
        defaults: {
          providerId: 'specialist-provider',
          modelId: 'specialist-model',
          temperature: 0.3,
        },
      }),
    );

    fs.writeFileSync(
      path.join(tempDir, 'disabled.json'),
      JSON.stringify({
        id: 'disabled',
        name: 'Disabled Agent',
        enabled: false,
        systemPrompt: 'Disabled prompt.',
        model: 'mock-provider/mock-model',
        defaults: {},
      }),
    );

    // Create agent registry
    agentRegistry = createAgentRegistry({ agentsDir: tempDir });

    // Create provider services
    providers = createProviderServices();

    // Register mock providers
    const mockProvider = createMockProvider('mock-provider');
    const specialistProvider = createMockProvider('specialist-provider');
    providers.registry.register(mockProvider, { defaultModel: 'mock-model' });
    providers.registry.register(specialistProvider, {
      defaultModel: 'specialist-model',
    });

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
        // temperature and maxTokens come from system defaults when not in overrides
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
          model: 'default-provider/default-model',
          defaults: {},
        }),
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

    it('should return error when model format is invalid', () => {
      // Create dispatch service without system defaults
      const noDefaultsService = createDispatchService({
        agents: agentRegistry,
        providers,
        systemDefaults: {
          providerId: '', // Empty
          modelId: '',
        },
      });

      // Agent with invalid model format (missing providerId)
      fs.writeFileSync(
        path.join(tempDir, 'noconfig.json'),
        JSON.stringify({
          id: 'noconfig',
          name: 'No Config Agent',
          enabled: true,
          systemPrompt: 'No config.',
          model: 'invalid-model-format', // Invalid: no "/" separator
          defaults: {},
        }),
      );
      agentRegistry.reload();

      const config = noDefaultsService.resolveConfig('noconfig');

      expect('error' in config).toBe(true);
      if ('error' in config) {
        expect(config.error.code).toBe('agent.model_invalid');
        expect(config.error.message).toContain('Invalid model format');
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
    expect(precedence).toEqual([
      'overrides',
      'agent defaults',
      'system defaults',
    ]);
  });
});

describe('DispatchService streaming', () => {
  let tempDir: string;
  let agentRegistry: AgentRegistry;
  let providers: ProviderServices;
  let dispatchService: DispatchService;
  let runEvents: RunEventEmitter;
  let sessionId: string;

  /**
   * Helper to create a mock streaming provider
   */
  function createMockStreamingProvider(id: string): ModelProvider {
    const descriptor: ProviderDescriptor = {
      id,
      name: `Mock Streaming Provider ${id}`,
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
      invokeStream: async function* (request: ModelRequest) {
        const streamId = `stream_${Date.now()}`;

        // Emit stream started
        yield ok({
          type: 'stream.started' as const,
          timestamp: new Date().toISOString(),
          id: streamId,
          model: request.model,
          providerId: id,
        });

        // Emit content deltas
        const content = `Mock streaming response to: ${request.messages[request.messages.length - 1]?.content}`;
        const words = content.split(' ');

        for (let i = 0; i < words.length; i++) {
          yield ok({
            type: 'stream.content_delta' as const,
            timestamp: new Date().toISOString(),
            id: streamId,
            model: request.model,
            providerId: id,
            delta: (i === 0 ? words[i] : ' ' + words[i]) ?? '',
          });
        }

        // Emit finished
        yield ok({
          type: 'stream.finished' as const,
          timestamp: new Date().toISOString(),
          id: streamId,
          model: request.model,
          providerId: id,
          finishReason: 'stop' as const,
          response: {
            id: `resp_${Date.now()}`,
            model: request.model,
            providerId: id,
            content,
            usage: {
              promptTokens: 10,
              completionTokens: words.length,
              totalTokens: 10 + words.length,
            },
            finishReason: 'stop',
            created: new Date().toISOString(),
          },
        });
      },
    };
  }

  beforeEach(async () => {
    // Create temp directory for agents in the system temp dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-streaming-agents-'));

    // Create test agent
    fs.writeFileSync(
      path.join(tempDir, 'streamer.json'),
      JSON.stringify({
        id: 'streamer',
        name: 'Streaming Agent',
        enabled: true,
        systemPrompt: 'You are a streaming assistant.',
        model: 'stream-provider/stream-model',
        defaults: {
          providerId: 'stream-provider',
          modelId: 'stream-model',
        },
      }),
    );

    agentRegistry = createAgentRegistry({ agentsDir: tempDir });
    providers = createProviderServices();
    runEvents = new RunEventEmitter();

    // Register mock streaming provider
    const streamProvider = createMockStreamingProvider('stream-provider');
    providers.registry.register(streamProvider, {
      defaultModel: 'stream-model',
    });

    dispatchService = createDispatchService({
      agents: agentRegistry,
      providers,
      runEvents,
    });

    sessionId = 'test-stream-session';
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('dispatchStream', () => {
    it('should yield failure event for non-existent agent', async () => {
      // First create a session using the regular dispatch
      await dispatchService.dispatch({
        sessionId,
        agentId: 'streamer',
        input: { role: 'user', content: 'Hello' },
      });

      const events: RunEvent[] = [];

      for await (const event of dispatchService.dispatchStream({
        sessionId,
        agentId: 'non-existent',
        input: { role: 'user', content: 'Hello' },
      })) {
        events.push(event);
      }

      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('run.failed');
      expect(events[0]!.data.errorCode).toBe('agent.not_found');
    });

    it('should yield failure event for disabled agent', async () => {
      // First create a session using the regular dispatch
      await dispatchService.dispatch({
        sessionId,
        agentId: 'streamer',
        input: { role: 'user', content: 'Hello' },
      });

      // Create disabled agent
      fs.writeFileSync(
        path.join(tempDir, 'disabled.json'),
        JSON.stringify({
          id: 'disabled',
          name: 'Disabled Agent',
          enabled: false,
          systemPrompt: 'Disabled.',
          model: 'stream-provider/stream-model',
          defaults: {},
        }),
      );
      agentRegistry.reload();

      const events: RunEvent[] = [];

      for await (const event of dispatchService.dispatchStream({
        sessionId,
        agentId: 'disabled',
        input: { role: 'user', content: 'Hello' },
      })) {
        events.push(event);
      }

      expect(events.length).toBe(1);
      expect(events[0]!.type).toBe('run.failed');
      expect(events[0]!.data.errorCode).toBe('agent.disabled');
    });

    it('should emit events through RunEventEmitter', async () => {
      // First create a session using the regular dispatch
      await dispatchService.dispatch({
        sessionId,
        agentId: 'streamer',
        input: { role: 'user', content: 'Hello' },
      });

      // Subscribe to events
      const receivedEvents: RunEvent[] = [];
      const unsubscribe = runEvents.subscribe('test-run-id', (event) => {
        receivedEvents.push(event);
      });

      // Emit a test event
      runEvents.emit({
        type: 'run.queued',
        runId: 'test-run-id',
        sessionId,
        agentId: 'streamer',
        timestamp: new Date().toISOString(),
        data: {},
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0]!.type).toBe('run.queued');

      unsubscribe();
    });
  });

  describe('MCP Tool Integration', () => {
    let dispatchService: DispatchService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockMcp: any;
    let tempDir: string;
    let _sessionId: string;

    beforeEach(async () => {
      // Create temp directory
      tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'openaidy-dispatch-mcp-test-'),
      );

      // Create mock MCP service
      mockMcp = {
        isConnected: vi.fn().mockReturnValue(true),
        getFilteredTools: vi.fn().mockReturnValue([
          {
            name: 'read_file',
            description: 'Read a file from the filesystem',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path to read' },
              },
              required: ['path'],
            },
          },
          {
            name: 'write_file',
            description: 'Write content to a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        ]),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'file content here' }],
        }),
      };

      // Create mock provider
      const mockProvider = createMockProvider('test-provider');

      // Create services
      const providers = createProviderServices();
      providers.registry.register(mockProvider, {
        enabled: true,
        priority: 50,
        defaultModel: 'test-model',
      });
      providers.registry.setDefault({
        providerId: 'test-provider',
        modelId: 'test-model',
      });

      const agents = createAgentRegistry({
        agentsDir: tempDir,
      });

      // Create agent config with MCP servers
      await fs.promises.writeFile(
        path.join(tempDir, 'mcp-agent.json'),
        JSON.stringify({
          id: 'mcp-agent',
          name: 'MCP Agent',
          enabled: true,
          systemPrompt: 'You have access to filesystem tools.',
          model: 'test-provider/test-model',
          mcpServers: [
            {
              id: 'filesystem',
              tools: ['read_file', 'write_file'],
            },
          ],
        }),
      );

      agents.load();

      dispatchService = createDispatchService({
        agents,
        providers,
        mcp: mockMcp as unknown as McpClientService,
      });

      // Create a session
      const result = await dispatchService.dispatch({
        sessionId: 'test-session-mcp',
        agentId: 'mcp-agent',
        input: { role: 'user', content: 'Hello' },
      });

      if (result.ok) {
        sessionId = result.userMessage.sessionId;
      }
    });

    afterEach(async () => {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    describe('getMcpToolsForAgent', () => {
      it('should return empty array when MCP service not available', () => {
        const service = createDispatchService({
          agents: dispatchService['agents'],
          providers: dispatchService['providers'],
        });
        const tools = service.getMcpToolsForAgent('mcp-agent');
        expect(tools).toEqual([]);
      });

      it('should return empty array for agent without MCP servers', () => {
        // Create agent without MCP servers
        const tools = dispatchService.getMcpToolsForAgent('non-mcp-agent');
        expect(tools).toEqual([]);
      });

      it('should collect tools from configured MCP servers', () => {
        const tools = dispatchService.getMcpToolsForAgent('mcp-agent');
        expect(tools).toHaveLength(2);
        expect(tools[0]?.name).toBe('filesystem::read_file');
        expect(tools[1]?.name).toBe('filesystem::write_file');
      });

      it('should prefix tool names with server ID', () => {
        const tools = dispatchService.getMcpToolsForAgent('mcp-agent');
        expect(tools[0]?.name.startsWith('filesystem::')).toBe(true);
      });

      it('should skip disconnected servers', () => {
        mockMcp.isConnected.mockReturnValue(false);
        const tools = dispatchService.getMcpToolsForAgent('mcp-agent');
        expect(tools).toEqual([]);
      });
    });

    describe('executeMcpToolCall', () => {
      it('should fail when MCP service not available', async () => {
        const service = createDispatchService({
          agents: dispatchService['agents'],
          providers: dispatchService['providers'],
        });
        const result = await service.executeMcpToolCall(
          'filesystem::read_file',
          { path: '/test.txt' },
          'mcp-agent',
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('MCP service not available');
        }
      });

      it('should fail for invalid tool name format', async () => {
        const result = await dispatchService.executeMcpToolCall(
          'invalid-tool-name',
          {},
          'mcp-agent',
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('Invalid tool name format');
        }
      });

      it('should fail for unconfigured server', async () => {
        const result = await dispatchService.executeMcpToolCall(
          'unknown-server::tool',
          {},
          'mcp-agent',
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('not configured');
        }
      });

      it('should fail when server not connected', async () => {
        mockMcp.isConnected.mockReturnValue(false);
        const result = await dispatchService.executeMcpToolCall(
          'filesystem::read_file',
          { path: '/test.txt' },
          'mcp-agent',
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('not connected');
        }
      });

      it('should fail for disallowed tool', async () => {
        // The agent only allows read_file and write_file
        const result = await dispatchService.executeMcpToolCall(
          'filesystem::delete_file',
          { path: '/test.txt' },
          'mcp-agent',
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('not allowed');
        }
      });

      it('should execute allowed tool successfully', async () => {
        const result = await dispatchService.executeMcpToolCall(
          'filesystem::read_file',
          { path: '/test.txt' },
          'mcp-agent',
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.content).toContain('file content');
        }
        expect(mockMcp.callTool).toHaveBeenCalledWith(
          'filesystem',
          'read_file',
          { path: '/test.txt' },
        );
      });

      it('should handle tool execution errors', async () => {
        mockMcp.callTool.mockRejectedValue(new Error('Tool failed'));
        const result = await dispatchService.executeMcpToolCall(
          'filesystem::read_file',
          { path: '/test.txt' },
          'mcp-agent',
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('Tool failed');
        }
      });
    });
  });

  describe('skill injection', () => {
    let skillTempDir: string;
    let skillRegistry: SkillRegistry;

    beforeEach(() => {
      // Create temp directory for skills
      skillTempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'test-dispatch-skills-'),
      );

      // Create skill directories
      fs.mkdirSync(path.join(skillTempDir, 'skill-a'));
      fs.mkdirSync(path.join(skillTempDir, 'skill-b'));
      fs.mkdirSync(path.join(skillTempDir, 'skill-c'));

      // Create SKILL.md files
      fs.writeFileSync(
        path.join(skillTempDir, 'skill-a', 'SKILL.md'),
        [
          '---',
          'name: Skill A',
          'description: First skill',
          '---',
          'Skill A body content.',
        ].join('\n'),
      );

      fs.writeFileSync(
        path.join(skillTempDir, 'skill-b', 'SKILL.md'),
        [
          '---',
          'name: Skill B',
          'description: Second skill',
          '---',
          'Skill B body content.',
        ].join('\n'),
      );

      fs.writeFileSync(
        path.join(skillTempDir, 'skill-c', 'SKILL.md'),
        [
          '---',
          'name: Skill C',
          'description: Third skill',
          '---',
          'Skill C body content.',
        ].join('\n'),
      );

      // Create skill registry
      skillRegistry = createSkillRegistry({ skillsDir: skillTempDir });
      skillRegistry.load();
    });

    afterEach(() => {
      fs.rmSync(skillTempDir, { recursive: true, force: true });
    });

    it('appends skill body to system prompt when agent.skills is set', async () => {
      // Create agent with skills
      fs.writeFileSync(
        path.join(tempDir, 'skill-agent.json'),
        JSON.stringify({
          id: 'skill-agent',
          name: 'Skill Agent',
          enabled: true,
          systemPrompt: 'You are a helpful assistant.',
          model: 'mock-provider/mock-model',
          skills: ['skill-a'],
          defaults: {
            providerId: 'mock-provider',
            modelId: 'mock-model',
          },
        }),
      );
      agentRegistry.reload();

      // Create dispatch service with skill registry
      const serviceWithSkills = createDispatchService({
        agents: agentRegistry,
        providers,
        skills: skillRegistry,
        systemDefaults: {
          providerId: 'mock-provider',
          modelId: 'mock-model',
        },
      });

      // Use buildMessages directly via resolveConfig and dispatch
      const agent = agentRegistry.getAgent('skill-agent');
      const config = serviceWithSkills.resolveConfig('skill-agent');

      expect('error' in config).toBe(false);
      if ('error' in config) return;

      // Verify the dispatch would include skill body in messages
      // Since dispatch requires a session, we verify via the internal buildMessages method
      const dispatchInstance = serviceWithSkills as DispatchService;
      const messages = dispatchInstance.buildMessages(
        [],
        config.systemPrompt,
        agent?.skills,
      );

      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain('Skill A body content.');
      expect(messages[0]?.content).toContain('You are a helpful assistant.');
    });

    it('does not modify system prompt when agent.skills is empty', async () => {
      // Create agent without skills
      fs.writeFileSync(
        path.join(tempDir, 'no-skill-agent.json'),
        JSON.stringify({
          id: 'no-skill-agent',
          name: 'No Skill Agent',
          enabled: true,
          systemPrompt: 'You are a helpful assistant.',
          model: 'mock-provider/mock-model',
          defaults: {
            providerId: 'mock-provider',
            modelId: 'mock-model',
          },
        }),
      );
      agentRegistry.reload();

      const serviceWithSkills = createDispatchService({
        agents: agentRegistry,
        providers,
        skills: skillRegistry,
        systemDefaults: {
          providerId: 'mock-provider',
          modelId: 'mock-model',
        },
      });

      const config = serviceWithSkills.resolveConfig('no-skill-agent');
      expect('error' in config).toBe(false);
      if ('error' in config) return;

      const dispatchInstance = serviceWithSkills as DispatchService;
      const messages = dispatchInstance.buildMessages(
        [],
        config.systemPrompt,
        undefined,
      );

      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toBe('You are a helpful assistant.');
    });

    it('silently skips unknown skill IDs', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'unknown-skill-agent.json'),
        JSON.stringify({
          id: 'unknown-skill-agent',
          name: 'Unknown Skill Agent',
          enabled: true,
          systemPrompt: 'You are a helpful assistant.',
          model: 'mock-provider/mock-model',
          skills: ['skill-a', 'nonexistent', 'skill-b'],
          defaults: {
            providerId: 'mock-provider',
            modelId: 'mock-model',
          },
        }),
      );
      agentRegistry.reload();

      const serviceWithSkills = createDispatchService({
        agents: agentRegistry,
        providers,
        skills: skillRegistry,
        systemDefaults: {
          providerId: 'mock-provider',
          modelId: 'mock-model',
        },
      });

      const agent = agentRegistry.getAgent('unknown-skill-agent');
      const config = serviceWithSkills.resolveConfig('unknown-skill-agent');
      expect('error' in config).toBe(false);
      if ('error' in config) return;

      const dispatchInstance = serviceWithSkills as DispatchService;
      const messages = dispatchInstance.buildMessages(
        [],
        config.systemPrompt,
        agent?.skills,
      );

      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain('Skill A body content.');
      expect(messages[0]?.content).toContain('Skill B body content.');
      expect(messages[0]?.content).not.toContain('nonexistent');
      expect(messages[0]?.content).not.toContain('Skill C body content.');
    });

    it('appends multiple skills in order', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'multi-skill-agent.json'),
        JSON.stringify({
          id: 'multi-skill-agent',
          name: 'Multi Skill Agent',
          enabled: true,
          systemPrompt: 'You are a helpful assistant.',
          model: 'mock-provider/mock-model',
          skills: ['skill-c', 'skill-a', 'skill-b'],
          defaults: {
            providerId: 'mock-provider',
            modelId: 'mock-model',
          },
        }),
      );
      agentRegistry.reload();

      const serviceWithSkills = createDispatchService({
        agents: agentRegistry,
        providers,
        skills: skillRegistry,
        systemDefaults: {
          providerId: 'mock-provider',
          modelId: 'mock-model',
        },
      });

      const agent = agentRegistry.getAgent('multi-skill-agent');
      const config = serviceWithSkills.resolveConfig('multi-skill-agent');
      expect('error' in config).toBe(false);
      if ('error' in config) return;

      const dispatchInstance = serviceWithSkills as DispatchService;
      const messages = dispatchInstance.buildMessages(
        [],
        config.systemPrompt,
        agent?.skills,
      );

      expect(messages[0]?.role).toBe('system');
      const content = messages[0]?.content as string;
      // Skills should be in the same order as specified in agent.skills
      const skillCIndex = content.indexOf('Skill C body content.');
      const skillAIndex = content.indexOf('Skill A body content.');
      const skillBIndex = content.indexOf('Skill B body content.');
      expect(skillCIndex).toBeLessThan(skillAIndex);
      expect(skillAIndex).toBeLessThan(skillBIndex);
    });
  });
});
