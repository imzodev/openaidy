/**
 * Agent Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentHandler, registerAgentHandlers, createAgentHandler } from './agent';
import { MessageRouter, type HandlerContext } from '../message-router';
import { ConnectionManager } from '../connection-manager';
import { createWSMessage, WS_ERROR_CODES,
} from '@openaidy/shared-types';
import type { AgentRegistry } from '../../agents/registry';
import type { Agent } from '../../agents/schema';

// ============================================================================
// Mock Factories
// ============================================================================

const createMockLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  level: 'info',
  silent: false,
});

const createMockAgentRegistry = (): AgentRegistry => {
  const agents: Map<string, Agent> = new Map([
    [
      'agent-1',
      {
        id: 'agent-1',
        name: 'Test Agent 1',
        description: 'A test agent',
        systemPrompt: 'You are a helpful assistant',
        tools: ['chat', 'streaming'],
        enabled: true,
        defaults: {},
        model: 'openai/gpt-4o-mini',
        version: 1,
      },
    ],
    [
      'agent-2',
      {
        id: 'agent-2',
        name: 'Test Agent 2',
        description: 'Another test agent',
        systemPrompt: 'You are a coding assistant',
        tools: ['code', 'debug'],
        enabled: true,
        defaults: {},
        model: 'openai/gpt-4',
        version: 1,
      },
    ],
    [
      'agent-disabled',
      {
        id: 'agent-disabled',
        name: 'Disabled Agent',
        description: 'A disabled agent',
        systemPrompt: 'Disabled',
        tools: [],
        enabled: false,
        defaults: {},
        model: 'openai/gpt-3.5-turbo',
        version: 1,
      },
    ],
  ]);

  return {
    listAgents: vi.fn().mockImplementation(() => {
      return Array.from(agents.values())
        .filter((a) => a.enabled)
        .map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
          capabilities: a.tools ?? [], // Map tools to capabilities for summary
        }));
      },
    }),
    listAllAgents: vi.fn().mockImplementation(() => {
      return Array.from(agents.values()).map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        capabilities: a.tools ?? [],
      }));
    }),
    getAgent: vi.fn().mockImplementation((id: string) => agents.get(id)),
    hasAgent: vi.fn().mockImplementation((id: string) => agents.has(id)),
    load: vi.fn(),
    reload: vi.fn(),
    replaceAll: vi.fn(),
    size: agents.size,
  } as unknown as AgentRegistry;
};

// ============================================================================
// Tests
// ============================================================================

describe('AgentHandler', () => {
  let handler: AgentHandler;
  let mockRegistry: AgentRegistry;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handlerContext: HandlerContext;
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    mockRegistry = createMockAgentRegistry();
    mockLogger = createMockLogger();
    handler = new AgentHandler(mockRegistry, mockLogger as unknown as HandlerContext['logger']);
    connectionManager = new ConnectionManager();
    handlerContext = {
      connectionManager,
      services: {},
      logger: mockLogger as unknown as HandlerContext['logger'],
    };
  });

  // ============================================================================
  // agent.list Tests
  // ============================================================================

  describe('handleList', () => {
    it('should list enabled agents', async () => {
    const request = createWSMessage('agent.list', {});
    const response = await handler.handleList('conn-1', request as never, handlerContext);

    expect(response.type).toBe('agent.list');
    expect(response.payload.agents).toHaveLength(2);
    expect(response.payload.agents[0].id).toBe('agent-1');
    expect(response.payload.agents[1].name).toBe('Test Agent 1');
  });

  it('should only include enabled agents', async () => {
    const request = createWSMessage('agent.list', {});
    const response = await handler.handleList('conn-1', request as never, handlerContext);

    expect(response.payload.agents).toHaveLength(2);
    expect(response.payload.agents.find((a) => a.id === 'agent-disabled')).toBeUndefined();
  });

  it('should log agent list operation async () => {
    const request = createWSMessage('agent.list', {});
    await handler.handleList('conn-1', request as never, handlerContext);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-1' }),
      'Listing agents via WebSocket',
    );
  });
  });

  // ============================================================================
  // agent.get Tests
  // ============================================================================

  describe('handleGet', () => {
    it('should get an existing agent', async () => {
    const request = createWSMessage('agent.get', { agentId: 'agent-1' });
    const response = await handler.handleGet('conn-1', request as never, handlerContext);

    expect(response.type).toBe('agent.get');
    if (response.type === 'agent.get') {
      expect(response.payload.agent.id).toBe('agent-1');
      expect(response.payload.agent.name).toBe('Test Agent 1');
      expect(response.payload.agent.description).toBe('A test agent');
    }
  });

  it('should include system prompt in get response', async () => {
    const request = createWSMessage('agent.get', { agentId: 'agent-1' });
    const response = await handler.handleGet('conn-1', request as never, handlerContext);

    if (response.type === 'agent.get') {
      expect(response.payload.agent.systemPrompt).toBe('You are a helpful assistant');
    }
  });

  it('should include enabled status in get response', async () => {
    const request = createWSMessage('agent.get', { agentId: 'agent-1' });
    const response = await handler.handleGet('conn-1', request as never, handlerContext);

    if (response.type === 'agent.get') {
      expect(response.payload.agent.enabled).toBe(true);
    }
  });

  it('should include model in get response', async () => {
    const request = createWSMessage('agent.get', { agentId: 'agent-1' });
    const response = await handler.handleGet('conn-1', request as never, handlerContext);

    if (response.type === 'agent.get') {
      expect(response.payload.agent.model).toBe('openai/gpt-4o-mini');
    }
  });

  it('should return error for non-existent agent', async () => {
    const request = createWSMessage('agent.get', { agentId: 'non-existent' });
    const response = await handler.handleGet('conn-1', request as never, handlerContext);

    expect(response.type).toBe('error');
  });

  it('should log agent get', async () => {
    const request = createWSMessage('agent.get', { agentId: 'agent-1' });
    await handler.handleGet('conn-1', request as never, handlerContext);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', connectionId: 'conn-1' }),
      'Getting agent via WebSocket',
    );
  });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle registry errors in list', async () => {
    (mockRegistry.listAgents as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Registry error');
    });

    const request = createWSMessage('agent.list', {});
    const response = await handler.handleList('conn-1', request as never, handlerContext);

    expect(response.type).toBe('error');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should handle registry errors in get', async () => {
    (mockRegistry.getAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Registry error');
    });

    const request = createWSMessage('agent.get', { agentId: 'agent-1' });
    const response = await handler.handleGet('conn-1', request as never, handlerContext);

    expect(response.type).toBe('error');
    expect(mockLogger.error).toHaveBeenCalled();
  });
  });
});

// ============================================================================
// Handler Registration Tests
// ============================================================================

describe('registerAgentHandlers', () => {
  let messageRouter: MessageRouter;
  let handler: AgentHandler;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    messageRouter = new MessageRouter(mockLogger as unknown as HandlerContext['logger']);
    handler = new AgentHandler(
      createMockAgentRegistry(),
      mockLogger as unknown as HandlerContext['logger'],
    );
  });

  it('should register agent.list handler', () => {
    registerAgentHandlers(messageRouter, handler);
    expect(messageRouter.hasHandler('agent.list')).toBe(true);
  });

  it('should register agent.get handler', () => {
    registerAgentHandlers(messageRouter, handler);
    expect(messageRouter.hasHandler('agent.get')).toBe(true);
  });

  it('should have exactly 2 agent handlers', () => {
    registerAgentHandlers(messageRouter, handler);
    const types = messageRouter.getHandlerTypes();
    const agentHandlers = types.filter((t) => t.startsWith('agent.'));
    expect(agentHandlers).toHaveLength(2);
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createAgentHandler', () => {
  it('should create an agent handler instance', () => {
    const mockRegistry = createMockAgentRegistry();
    const mockLogger = createMockLogger();
    const handler = createAgentHandler(
      mockRegistry,
      mockLogger as unknown as HandlerContext['logger'],
    );

    expect(handler).toBeInstanceOf(AgentHandler);
  });
});
