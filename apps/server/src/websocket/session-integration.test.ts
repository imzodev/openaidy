/**
 * Session Integration Tests
 *
 * Integration tests for session handler registration and gateway wiring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionManager } from './connection-manager';
import { MessageRouter, type HandlerContext } from './message-router';
import { SessionHandler, registerSessionHandlers } from './handlers/session';
import { StreamManager } from './streaming';
import { SubscriptionManager } from './subscriptions';
import { RunEventEmitter } from '../dispatch/events';
import {
  type WSMessage,
  type WSRequest,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Mock Logger
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

// ============================================================================
// Mock Services
// ============================================================================

const createMockSessionService = () => ({
  createSession: vi.fn().mockResolvedValue({
    id: 'session-123',
    title: 'Test Session',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  getSession: vi.fn().mockResolvedValue({
    id: 'session-123',
    title: 'Test Session',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  listSessions: vi.fn().mockResolvedValue([
    {
      id: 'session-123',
      title: 'Test Session',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]),
  submitMessage: vi.fn().mockResolvedValue({
    ok: true,
    userMessage: { id: 'msg-1', content: 'Hello' },
    assistantMessage: { id: 'msg-2', content: 'Hi there!' },
    run: { id: 'run-1', finishReason: 'stop' },
  }),
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Session Integration', () => {
  let connectionManager: ConnectionManager;
  let messageRouter: MessageRouter;
  let sessionHandler: SessionHandler;
  let streamManager: StreamManager;
  let subscriptionManager: SubscriptionManager;
  let runEvents: RunEventEmitter;
  let mockSessionService: ReturnType<typeof createMockSessionService>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockSessionService = createMockSessionService();

    // Create managers
    connectionManager = new ConnectionManager();
    runEvents = new RunEventEmitter();
    messageRouter = new MessageRouter(mockLogger as unknown as HandlerContext['logger']);
    sessionHandler = new SessionHandler(
      mockSessionService as unknown as Parameters<typeof SessionHandler>[0],
      mockLogger as unknown as HandlerContext['logger'],
    );
    streamManager = new StreamManager(runEvents, connectionManager, mockLogger as unknown as HandlerContext['logger']);
    subscriptionManager = new SubscriptionManager(connectionManager, mockLogger as unknown as HandlerContext['logger']);

    // Register session handlers
    registerSessionHandlers(messageRouter, sessionHandler);

    // Start stream manager
    streamManager.start();
  });

  afterEach(() => {
    streamManager.stop();
    subscriptionManager.cleanup();
    connectionManager.closeAll();
  });

  // ============================================================================
  // Handler Registration Tests
  // ============================================================================

  describe('Handler Registration', () => {
    it('should register session.create handler', () => {
      expect(messageRouter.hasHandler('session.create')).toBe(true);
    });

    it('should register session.get handler', () => {
      expect(messageRouter.hasHandler('session.get')).toBe(true);
    });

    it('should register session.list handler', () => {
      expect(messageRouter.hasHandler('session.list')).toBe(true);
    });

    it('should register session.delete handler', () => {
      expect(messageRouter.hasHandler('session.delete')).toBe(true);
    });

    it('should register session.message handler', () => {
      expect(messageRouter.hasHandler('session.message')).toBe(true);
    });

    it('should have all 5 session handlers registered', () => {
      const types = messageRouter.getHandlerTypes();
      const sessionHandlers = types.filter(t => t.startsWith('session.'));
      expect(sessionHandlers).toHaveLength(5);
      expect(sessionHandlers).toContain('session.create');
      expect(sessionHandlers).toContain('session.get');
      expect(sessionHandlers).toContain('session.list');
      expect(sessionHandlers).toContain('session.delete');
      expect(sessionHandlers).toContain('session.message');
    });
  });

  // ============================================================================
  // Manager Integration Tests
  // ============================================================================

  describe('Manager Integration', () => {
    it('should have stream manager running', () => {
      expect(streamManager.running).toBe(true);
    });

    it('should allow registering subscribe handler', () => {
      messageRouter.registerHandler('session.subscribe', async () => undefined);
      expect(messageRouter.hasHandler('session.subscribe')).toBe(true);
    });

    it('should allow registering unsubscribe handler', () => {
      messageRouter.registerHandler('session.unsubscribe', async () => undefined);
      expect(messageRouter.hasHandler('session.unsubscribe')).toBe(true);
    });
  });

  // ============================================================================
  // Message Routing Tests
  // ============================================================================

  describe('Message Routing', () => {
    const handlerContext: HandlerContext = {
      connectionManager,
      services: {},
      logger: mockLogger as unknown as HandlerContext['logger'],
    };

    it('should route session.create message', async () => {
      const message = createWSMessage('session.create', {});
      const response = await messageRouter.route('conn-1', message, handlerContext);

      expect(response).toBeDefined();
      expect(response?.type).toBe('session.created');
      expect(mockSessionService.createSession).toHaveBeenCalled();
    });

    it('should route session.get message', async () => {
      const message = createWSMessage('session.get', { sessionId: 'session-123' });
      const response = await messageRouter.route('conn-1', message, handlerContext);

      expect(response).toBeDefined();
      expect(response?.type).toBe('session.get');
      expect(mockSessionService.getSession).toHaveBeenCalledWith('session-123');
    });

    it('should route session.list message', async () => {
      const message = createWSMessage('session.list', {});
      const response = await messageRouter.route('conn-1', message, handlerContext);

      expect(response).toBeDefined();
      expect(response?.type).toBe('session.list');
      expect(mockSessionService.listSessions).toHaveBeenCalled();
    });

    it('should return error for unknown message type', async () => {
      const message = createWSMessage('unknown.type', {});
      const response = await messageRouter.route('conn-1', message, handlerContext);

      expect(response).toBeDefined();
      expect(response?.type).toBe('error');
    });
  });

  // ============================================================================
  // Subscription Manager Integration
  // ============================================================================

  describe('Subscription Manager Integration', () => {
    it('should create subscription', () => {
      const connId = 'conn-1';
      connectionManager.registerConnection(connId);

      const subId = subscriptionManager.createSubscription(connId, 'session-123');
      expect(subId).toBeDefined();
      expect(subId?.startsWith('sub_')).toBe(true);
    });

    it('should find subscription by connection and session', () => {
      const connId = 'conn-1';
      connectionManager.registerConnection(connId);

      const subId = subscriptionManager.createSubscription(connId, 'session-123');
      const sub = subscriptionManager.findSubscription(connId, 'session-123');

      expect(sub).toBeDefined();
      expect(sub?.id).toBe(subId);
    });

    it('should remove connection subscriptions on cleanup', () => {
      const connId = 'conn-1';
      connectionManager.registerConnection(connId);

      subscriptionManager.createSubscription(connId, 'session-123');
      subscriptionManager.createSubscription(connId, 'session-456');

      expect(subscriptionManager.getSubscriptionCount()).toBe(2);

      const removed = subscriptionManager.removeConnectionSubscriptions(connId);
      expect(removed).toBe(2);
      expect(subscriptionManager.getSubscriptionCount()).toBe(0);
    });
  });

  // ============================================================================
  // Stream Manager Integration
  // ============================================================================

  describe('Stream Manager Integration', () => {
    it('should start and stop correctly', () => {
      expect(streamManager.running).toBe(true);

      streamManager.stop();
      expect(streamManager.running).toBe(false);

      streamManager.start();
      expect(streamManager.running).toBe(true);
    });

    it('should track subscriptions', () => {
      const connId = 'conn-1';
      connectionManager.registerConnection(connId);

      streamManager.subscribeToRun('run-123', connId);
      expect(streamManager.getRunSubscriptionCount('run-123')).toBe(1);

      streamManager.unsubscribeFromRun('run-123', connId);
      expect(streamManager.getRunSubscriptionCount('run-123')).toBe(0);
    });

    it('should unsubscribe all from connection', () => {
      const connId = 'conn-1';
      connectionManager.registerConnection(connId);

      streamManager.subscribeToRun('run-123', connId);
      streamManager.subscribeToRun('run-456', connId);

      expect(streamManager.getConnectionSubscriptionCount(connId)).toBe(2);

      streamManager.unsubscribeAllFromConnection(connId);
      expect(streamManager.getConnectionSubscriptionCount(connId)).toBe(0);
    });
  });

  // ============================================================================
  // Connection Manager Integration
  // ============================================================================

  describe('Connection Manager Integration', () => {
    it('should track connections', () => {
      expect(connectionManager.getConnectionCount()).toBe(0);

      connectionManager.registerConnection('conn-1');
      expect(connectionManager.getConnectionCount()).toBe(1);

      connectionManager.registerConnection('conn-2');
      expect(connectionManager.getConnectionCount()).toBe(2);

      connectionManager.removeConnection('conn-1');
      expect(connectionManager.getConnectionCount()).toBe(1);
    });

    it('should handle heartbeat updates', () => {
      const ctx = connectionManager.registerConnection('conn-1');
      const initialHeartbeat = ctx.lastHeartbeat;

      // Wait a bit
      return new Promise<void>(resolve => {
        setTimeout(() => {
          connectionManager.updateHeartbeat('conn-1');
          const updated = connectionManager.getConnection('conn-1');
          expect(updated?.lastHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);
          resolve();
        }, 10);
      });
    });
  });
});
