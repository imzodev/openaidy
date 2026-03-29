import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { NodeRegistry, type Node } from '../node-registry';
import {
  NodeHandler,
  registerNodeHandlers,
  createNodeHandler,
  type NodeListRequest,
  type NodeDescribeRequest,
  type NodeInvokeRequest,
  type NodeRegisterRequest,
  type NodeUnregisterRequest,
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

      expect(response.type).toBe('node.list');
      if (response.type === 'node.list') {
        expect(response.payload.nodes).toHaveLength(2);
        expect(response.payload.nodes.map(n => n.nodeId)).toContain('node-1');
        expect(response.payload.nodes.map(n => n.nodeId)).toContain('node-2');
      }
    });

    it('should return empty array when no nodes registered', async () => {
      const request = createWSMessage('node.list', {});
      const response = await handler.handleList('conn-1', request, handlerContext);

      expect(response.type).toBe('node.list');
      if (response.type === 'node.list') {
        expect(response.payload.nodes).toHaveLength(0);
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
    it('should return node details for valid nodeId', async () => {
      const testNode = createTestNode({ nodeId: 'node-1' });
      nodeRegistry.registerNode(testNode);

      const request = createWSMessage('node.describe', { nodeId: 'node-1' });
      const response = await handler.handleDescribe('conn-1', request, handlerContext);

      expect(response.type).toBe('node.describe');
      if (response.type === 'node.describe') {
        expect(response.payload.node.nodeId).toBe('node-1');
        expect(response.payload.node.name).toBe('Test Node');
        expect(response.payload.node.capabilities).toEqual(['camera', 'microphone']);
      }
    });

    it('should return error for non-existent nodeId', async () => {
      const request = createWSMessage('node.describe', { nodeId: 'non-existent' });
      const response = await handler.handleDescribe('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
        expect(response.payload.error.message).toContain('Node not found');
      }
    });

    it('should log describe operation', async () => {
      const testNode = createTestNode({ nodeId: 'node-1' });
      nodeRegistry.registerNode(testNode);

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
        params: {},
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      }
    });

    it('should return error when node is offline', async () => {
      const testNode = createTestNode({ nodeId: 'node-1', status: 'offline' });
      nodeRegistry.registerNode(testNode);

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
        params: {},
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
        expect(response.payload.error.message).toContain('not online');
      }
    });

    it('should return error when node lacks capability', async () => {
      const testNode = createTestNode({
        nodeId: 'node-1',
        capabilities: ['screen'], // No 'camera'
      });
      nodeRegistry.registerNode(testNode);

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
        params: {},
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INSUFFICIENT_CAPABILITY);
        expect(response.payload.error.message).toContain('does not have capability');
      }
    });

    it('should return error when node has no connection', async () => {
      const testNode = createTestNode({
        nodeId: 'node-1',
        connectionId: undefined, // No connection
      });
      nodeRegistry.registerNode(testNode);

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
        params: {},
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.SERVICE_UNAVAILABLE);
        expect(response.payload.error.message).toContain('not connected');
      }
    });

    it('should return placeholder response for valid invocation', async () => {
      const testNode = createTestNode({
        nodeId: 'node-1',
        connectionId: 'conn-node-1',
      });
      nodeRegistry.registerNode(testNode);

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
        params: { action: 'snap' },
      });
      const response = await handler.handleInvoke('conn-1', request, handlerContext);

      // Current implementation returns placeholder
      expect(response.type).toBe('node.invoke');
      if (response.type === 'node.invoke') {
        expect(response.payload.result).toBeDefined();
        expect(response.payload.duration).toBeDefined();
      }
    });

    it('should log invoke operation', async () => {
      const testNode = createTestNode({
        nodeId: 'node-1',
        connectionId: 'conn-node-1',
      });
      nodeRegistry.registerNode(testNode);

      const request = createWSMessage('node.invoke', {
        nodeId: 'node-1',
        capability: 'camera',
        params: {},
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
        type: 'desktop',
        capabilities: ['screen', 'keyboard'],
        metadata: { version: '1.0' },
      });
      const response = await handler.handleRegister('conn-1', request, handlerContext);

      expect(response.type).toBe('node.registered');
      if (response.type === 'node.registered') {
        expect(response.payload.node.name).toBe('New Node');
        expect(response.payload.node.type).toBe('desktop');
        expect(response.payload.node.capabilities).toEqual(['screen', 'keyboard']);
        expect(response.payload.node.metadata).toEqual({ version: '1.0' });
        expect(response.payload.node.status).toBe('online');
      }
    });

    it('should use connectionId from request or default to caller', async () => {
      const requestWithConn = createWSMessage('node.register', {
        name: 'Node 1',
        type: 'mobile',
        capabilities: ['camera'],
        connectionId: 'custom-conn',
      });
      const response1 = await handler.handleRegister('conn-default', requestWithConn, handlerContext);

      expect(response1.type).toBe('node.registered');
      if (response1.type === 'node.registered') {
        expect(response1.payload.node.connectionId).toBe('custom-conn');
      }

      // Without connectionId
      const requestWithoutConn = createWSMessage('node.register', {
        name: 'Node 2',
        type: 'mobile',
        capabilities: ['microphone'],
      });
      const response2 = await handler.handleRegister('conn-default', requestWithoutConn, handlerContext);

      expect(response2.type).toBe('node.registered');
      if (response2.type === 'node.registered') {
        expect(response2.payload.node.connectionId).toBe('conn-default');
      }
    });

    it('should register node with optional fields', async () => {
      const request = createWSMessage('node.register', {
        name: 'Secure Node',
        type: 'service',
        capabilities: ['admin'],
        tokenHash: 'hash123',
        scopes: ['read', 'write'],
      });
      const response = await handler.handleRegister('conn-1', request, handlerContext);

      expect(response.type).toBe('node.registered');
      if (response.type === 'node.registered') {
        expect(response.payload.node.tokenHash).toBe('hash123');
        expect(response.payload.node.scopes).toEqual(['read', 'write']);
      }
    });

    it('should add node to registry', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'mobile',
        capabilities: ['camera'],
      });
      await handler.handleRegister('conn-1', request, handlerContext);

      expect(nodeRegistry.size).toBe(1);
    });

    it('should log register operation', async () => {
      const request = createWSMessage('node.register', {
        name: 'New Node',
        type: 'mobile',
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
      const testNode = createTestNode({ nodeId: 'node-1' });
      nodeRegistry.registerNode(testNode);

      const request = createWSMessage('node.unregister', { nodeId: 'node-1' });
      const response = await handler.handleUnregister('conn-1', request, handlerContext);

      expect(response.type).toBe('node.unregistered');
      if (response.type === 'node.unregistered') {
        expect(response.payload.nodeId).toBe('node-1');
      }
    });

    it('should remove node from registry', async () => {
      const testNode = createTestNode({ nodeId: 'node-1' });
      nodeRegistry.registerNode(testNode);
      expect(nodeRegistry.size).toBe(1);

      const request = createWSMessage('node.unregister', { nodeId: 'node-1' });
      await handler.handleUnregister('conn-1', request, handlerContext);

      expect(nodeRegistry.size).toBe(0);
    });

    it('should return error for non-existent node', async () => {
      const request = createWSMessage('node.unregister', { nodeId: 'non-existent' });
      const response = await handler.handleUnregister('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      }
    });

    it('should log unregister operation', async () => {
      const testNode = createTestNode({ nodeId: 'node-1' });
      nodeRegistry.registerNode(testNode);

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
    it('should return internal error on unexpected exception in handleList', async () => {
      // Create a handler with a broken registry
      const brokenRegistry = null as unknown as NodeRegistry;
      const brokenHandler = new NodeHandler(brokenRegistry, connectionManager, mockLogger);

      const request = createWSMessage('node.list', {});
      const response = await brokenHandler.handleList('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if (response.type === 'error') {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
      }
    });

    it('should log errors with error method', async () => {
      // Create a handler with a broken registry
      const brokenRegistry = null as unknown as NodeRegistry;
      const brokenHandler = new NodeHandler(brokenRegistry, connectionManager, mockLogger);

      const request = createWSMessage('node.list', {});
      await brokenHandler.handleList('conn-1', request, handlerContext);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('integration', () => {
    it('should support full node lifecycle', async () => {
      // Register
      const registerRequest = createWSMessage('node.register', {
        name: 'Lifecycle Node',
        type: 'browser',
        capabilities: ['screen', 'clipboard'],
      });
      const registerResponse = await handler.handleRegister('conn-1', registerRequest, handlerContext);

      expect(registerResponse.type).toBe('node.registered');
      if (registerResponse.type !== 'node.registered') return;
      const nodeId = registerResponse.payload.node.nodeId;

      // List
      const listResponse = await handler.handleList(
        'conn-1',
        createWSMessage('node.list', {}),
        handlerContext
      );
      expect(listResponse.type).toBe('node.list');
      if (listResponse.type === 'node.list') {
        expect(listResponse.payload.nodes).toHaveLength(1);
      }

      // Describe
      const describeResponse = await handler.handleDescribe(
        'conn-1',
        createWSMessage('node.describe', { nodeId }),
        handlerContext
      );
      expect(describeResponse.type).toBe('node.describe');

      // Unregister
      const unregisterResponse = await handler.handleUnregister(
        'conn-1',
        createWSMessage('node.unregister', { nodeId }),
        handlerContext
      );
      expect(unregisterResponse.type).toBe('node.unregistered');

      // Verify removed
      const listAfterResponse = await handler.handleList(
        'conn-1',
        createWSMessage('node.list', {}),
        handlerContext
      );
      expect(listAfterResponse.type).toBe('node.list');
      if (listAfterResponse.type === 'node.list') {
        expect(listAfterResponse.payload.nodes).toHaveLength(0);
      }
    });
  });
});

// ============================================================================
// registerNodeHandlers Tests
// ============================================================================

describe('registerNodeHandlers', () => {
  it('should register all handlers', () => {
    const mockRouter = {
      registerHandler: vi.fn(),
    };
    const mockLogger = createMockLogger();
    const nodeRegistry = new NodeRegistry({}, mockLogger);
    const connectionManager = new ConnectionManager();
    const handler = new NodeHandler(nodeRegistry, connectionManager, mockLogger);

    registerNodeHandlers(mockRouter, handler);

    expect(mockRouter.registerHandler).toHaveBeenCalledTimes(5);
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.list', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.describe', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.invoke', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.register', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('node.unregister', expect.any(Function));
  });
});

// ============================================================================
// createNodeHandler Tests
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
