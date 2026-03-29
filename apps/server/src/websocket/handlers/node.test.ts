import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { NodeRegistry, type Node, type NodeType } from '../node-registry';
import {
  NodeHandler,
  registerNodeHandlers,
  createNodeHandler,
} from './node';
import { type HandlerContext } from '../message-router';
import { ConnectionManager } from '../connection-manager';
import { createWSMessage, WS_ERROR_CODES } from '@openaidy/shared-types';

// ============================================================================
// Mock Factories
// ============================================================================

const createMockLogger = (): FastifyBaseLogger => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  level: 'info',
  silent: false,
} as unknown as FastifyBaseLogger);

// Create a test node
function createTestNode(overrides: Partial<Node> = {}): Node {
  return {
    nodeId: 'node-1',
    name: 'Test Node',
    type: 'mobile',
    status: 'online',
    capabilities: ['camera', 'microphone'],
    metadata: {},
    registeredAt: Date.now(),
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe('NodeHandler', () => {
  let handler: NodeHandler;
  let nodeRegistry: NodeRegistry;
  let connectionManager: ConnectionManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handlerContext: HandlerContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    nodeRegistry = new NodeRegistry({}, mockLogger);
    connectionManager = new ConnectionManager();
    handler = new NodeHandler(nodeRegistry, connectionManager, mockLogger);
    handlerContext = {
      connectionManager,
      services: {},
      logger: mockLogger,
    };
  });

  afterEach(() => {
    nodeRegistry.clear();
  });

  // ============================================================================
  // handleList Tests
  // ============================================================================

  describe('handleList', () => {
    it('should list all registered nodes', async () => {
      nodeRegistry.registerNode(createTestNode({
        nodeId: 'node-1',
        name: 'Test Node 1',
        capabilities: ['camera', 'microphone'],
      }));
      nodeRegistry.registerNode(createTestNode({
        nodeId: 'node-2',
        name: 'Test Node 2',
        capabilities: ['screen', 'keyboard'],
      }));

      const request = createWSMessage('node.list', {});
      const response = await handler.handleList('conn-1', request, handlerContext);

      if (response.type === 'node.list') {
        expect(response.payload.nodes).toHaveLength(2);
        expect(response.payload.nodes.map(n => n.nodeId)).toContain('node-1');
        expect(response.payload.nodes.map(n => n.nodeId)).toContain('node-2');
      } else {
        expect.fail('Expected node.list response');
      }
    });

    it('should return empty array when no nodes registered', async () => {
      const request = createWSMessage('node.list', {});
      const response = await handler.handleList('conn-1', request, handlerContext);

      if (response.type === 'node.list') {
        expect(response.payload.nodes).toHaveLength(0);
      } else {
        expect.fail('Expected node.list response');
      }
    });

    it('should log node list operation', async () => {
      const request = createWSMessage('node.list', {});
      await handler.handleList('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { connectionId: 'conn-1' },
        'Listing nodes via WebSocket'
      );
    });
  });

  // ============================================================================
  // handleDescribe Tests
  // ============================================================================

  describe('handleDescribe', () => {
    it('should return node details for existing node', async () => {
      const node = createTestNode({
        nodeId: 'node-1',
        name: 'Test Node',
        type: 'mobile',
        capabilities: ['camera'],
      });
      nodeRegistry.registerNode(node);

      const request = createWSMessage('node.describe', { nodeId: 'node-1' });
      const response = await handler.handleDescribe('conn-1', request, handlerContext);

      if (response.type === 'node.describe') {
        expect(response.payload.node.nodeId).toBe('node-1');
        expect(response.payload.node.name).toBe('Test Node');
        expect(response.payload.node.type).toBe('mobile');
        expect(response.payload.node.capabilities).toContain('camera');
      } else {
        expect.fail('Expected node.describe response');
      }
    });

    it('should return error for non-existent node', async () => {
      const request = createWSMessage('node.describe', { nodeId: 'non-existent' });
      const response = await handler.handleDescribe('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
        expect(response.payload.error.message).toContain('Node not found');
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should log describe operation', async () => {
      nodeRegistry.registerNode(createTestNode({ nodeId: 'node-1' }));

      const request = createWSMessage('node.describe', { nodeId: 'node-1' });
      await handler.handleDescribe('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { connectionId: 'conn-1', nodeId: 'node-1' },
        'Describing node via WebSocket'
      );
    });
  });

  // ============================================================================
  // handleInvoke Tests
  // ============================================================================

  describe('handleInvoke', () => {
    it('should return error for non-existent node', async () => {
      const request = createWSMessage('node.invoke', {
        nodeId: 'non-existent',
        capability: 'camera',
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should return error if node is offline', async () => {
      nodeRegistry.registerNode(createTestNode({
        nodeId: 'node-1',
        status: 'offline',
        capabilities: ['camera'],
      }));

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
        expect(response.payload.error.message).toContain('not online');
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should return error if node is stale', async () => {
      nodeRegistry.registerNode(createTestNode({
        nodeId: 'node-1',
        status: 'stale',
        capabilities: ['camera'],
      }));

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should return error if node lacks capability', async () => {
      nodeRegistry.registerNode(createTestNode({
        nodeId: 'node-1',
        status: 'online',
        capabilities: ['microphone'],
        connectionId: 'conn-node',
      }));

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INSUFFICIENT_CAPABILITY);
        expect(response.payload.error.message).toContain('does not have capability');
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should return error if node has no connection', async () => {
      const { connectionId: _, ...nodeWithoutConnection } = createTestNode({
        nodeId: 'node-1',
        status: 'online',
        capabilities: ['camera'],
      });
      nodeRegistry.registerNode({
        ...nodeWithoutConnection,
        connectionId: undefined,
      } as Node);

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
        expect(response.payload.error.message).toContain('not connected');
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should return placeholder response for valid invocation', async () => {
      nodeRegistry.registerNode(createTestNode({
        nodeId: 'node-1',
        status: 'online',
        capabilities: ['camera'],
        connectionId: 'conn-node',
      }));

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      if (response.type === 'node.invoke') {
        expect(response.payload.result).toBeDefined();
        expect(response.payload.duration).toBe(0);
      } else {
        expect.fail('Expected node.invoke response');
      }
    });

    it('should log invoke operation', async () => {
      nodeRegistry.registerNode(createTestNode({
        nodeId: 'node-1',
        status: 'online',
        capabilities: ['camera'],
        connectionId: 'conn-node',
      }));

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
      });
      await handler.handleInvoke('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { connectionId: 'conn-1', nodeId: 'node-1', capability: 'camera' },
        'Invoking node capability via WebSocket'
      );
    });
  });

  // ============================================================================
  // handleRegister Tests
  // ============================================================================

  describe('handleRegister', () => {
    it('should register a new node', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'mobile' as NodeType,
        capabilities: ['camera', 'microphone'],
      });
      const response = await handler.handleRegister('conn-1', request, handlerContext);

      if (response.type === 'node.registered') {
        expect(response.payload.node.name).toBe('New Node');
        expect(response.payload.node.type).toBe('mobile');
        expect(response.payload.node.capabilities).toContain('camera');
        expect(response.payload.node.status).toBe('online');
        expect(response.payload.node.nodeId).toBeDefined();
      } else {
        expect.fail('Expected node.registered response');
      }
    });

    it('should use connectionId from payload if provided', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'desktop' as NodeType,
        capabilities: ['screen'],
        connectionId: 'custom-conn',
      });
      const response = await handler.handleRegister('conn-1', request, handlerContext);

      if (response.type === 'node.registered') {
        expect(response.payload.node.connectionId).toBe('custom-conn');
      } else {
        expect.fail('Expected node.registered response');
      }
    });

    it('should use connectionId from handler if not in payload', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'browser' as NodeType,
        capabilities: ['notifications'],
      });
      const response = await handler.handleRegister('conn-handler', request, handlerContext);

      if (response.type === 'node.registered') {
        expect(response.payload.node.connectionId).toBe('conn-handler');
      } else {
        expect.fail('Expected node.registered response');
      }
    });

    it('should store metadata if provided', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'mobile' as NodeType,
        capabilities: ['camera'],
        metadata: { version: '1.0', platform: 'ios' },
      });
      const response = await handler.handleRegister('conn-1', request, handlerContext);

      if (response.type === 'node.registered') {
        expect(response.payload.node.metadata).toEqual({ version: '1.0', platform: 'ios' });
      } else {
        expect.fail('Expected node.registered response');
      }
    });

    it('should store tokenHash and scopes if provided', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'service' as NodeType,
        capabilities: ['api'],
        tokenHash: 'abc123',
        scopes: ['read', 'write'],
      });
      const response = await handler.handleRegister('conn-1', request, handlerContext);

      if (response.type === 'node.registered') {
        expect(response.payload.node.tokenHash).toBe('abc123');
        expect(response.payload.node.scopes).toEqual(['read', 'write']);
      } else {
        expect.fail('Expected node.registered response');
      }
    });

    it('should add node to registry', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      await handler.handleRegister('conn-1', request, handlerContext);

      expect(nodeRegistry.size).toBe(1);
    });

    it('should log register operation', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      await handler.handleRegister('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { connectionId: 'conn-1', name: 'New Node' },
        'Registering node via WebSocket'
      );
    });
  });

  // ============================================================================
  // handleUnregister Tests
  // ============================================================================

  describe('handleUnregister', () => {
    it('should unregister an existing node', async () => {
      nodeRegistry.registerNode(createTestNode({ nodeId: 'node-1' }));

      const request = createWSMessage('node.unregister', { nodeId: 'node-1' });
      const response = await handler.handleUnregister('conn-1', request, handlerContext);

      if (response.type === 'node.unregistered') {
        expect(response.payload.nodeId).toBe('node-1');
      } else {
        expect.fail('Expected node.unregistered response');
      }

      expect(nodeRegistry.size).toBe(0);
    });

    it('should return error for non-existent node', async () => {
      const request = createWSMessage('node.unregister', { nodeId: 'non-existent' });
      const response = await handler.handleUnregister('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
        expect(response.payload.error.message).toContain('Node not found');
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should log unregister operation', async () => {
      nodeRegistry.registerNode(createTestNode({ nodeId: 'node-1' }));

      const request = createWSMessage('node.unregister', { nodeId: 'node-1' });
      await handler.handleUnregister('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { connectionId: 'conn-1', nodeId: 'node-1' },
        'Unregistering node via WebSocket'
      );
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('error handling', () => {
    it('should handle errors in handleList', async () => {
      // Force an error by making getAllNodes throw
      const errorRegistry = {
        getAllNodes: () => { throw new Error('Test error'); },
      } as unknown as NodeRegistry;

      const errorHandler = new NodeHandler(errorRegistry, connectionManager, mockLogger);
      const request = createWSMessage('node.list', {});
      const response = await errorHandler.handleList('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
        expect(response.payload.error.message).toBe('Test error');
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should handle errors in handleDescribe', async () => {
      // Force an error by making getNode throw
      const errorRegistry = {
        getNode: () => { throw new Error('Describe error'); },
      } as unknown as NodeRegistry;

      const errorHandler = new NodeHandler(errorRegistry, connectionManager, mockLogger);
      const request = createWSMessage('node.describe', { nodeId: 'node-1' });
      const response = await errorHandler.handleDescribe('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should handle errors in handleRegister', async () => {
      // Force an error by making registerNode throw
      const errorRegistry = {
        registerNode: () => { throw new Error('Register error'); },
      } as unknown as NodeRegistry;

      const errorHandler = new NodeHandler(errorRegistry, connectionManager, mockLogger);
      const request = createWSMessage('node.register', {
        name: 'Test',
        type: 'mobile' as NodeType,
        capabilities: ['camera'],
      });
      const response = await errorHandler.handleRegister('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      } else {
        expect.fail('Expected error response');
      }
    });

    it('should handle errors in handleUnregister', async () => {
      // Force an error by making getNode and unregisterNode throw
      const errorRegistry = {
        getNode: () => { throw new Error('Unregister error'); },
        unregisterNode: () => {},
      } as unknown as NodeRegistry;

      const errorHandler = new NodeHandler(errorRegistry, connectionManager, mockLogger);
      const request = createWSMessage('node.unregister', { nodeId: 'node-1' });
      const response = await errorHandler.handleUnregister('conn-1', request, handlerContext);

      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      } else {
        expect.fail('Expected error response');
      }
    });
  });
});

// ============================================================================
// registerNodeHandlers Tests
// ============================================================================

describe('registerNodeHandlers', () => {
  it('should register all node handlers', () => {
    const mockRouter = {
      registerHandler: vi.fn(),
    };

    const mockLogger = createMockLogger();
    const nodeRegistry = new NodeRegistry({}, mockLogger);
    const connectionManager = new ConnectionManager();
    const handler = new NodeHandler(nodeRegistry, connectionManager, mockLogger);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerNodeHandlers(mockRouter as any, handler);

    expect(mockRouter.registerHandler).toHaveBeenCalledTimes(5);
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.list', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.describe', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.invoke', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.register', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.unregister', expect.any(Function));
  });
});

// ============================================================================
// createNodeHandler Factory Tests
// ============================================================================

describe('createNodeHandler', () => {
  it('should create NodeHandler instance', () => {
    const mockLogger = createMockLogger();
    const nodeRegistry = new NodeRegistry({}, mockLogger);
    const connectionManager = new ConnectionManager();

    const handler = createNodeHandler(nodeRegistry, connectionManager, mockLogger);

    expect(handler).toBeInstanceOf(NodeHandler);
  });
});
