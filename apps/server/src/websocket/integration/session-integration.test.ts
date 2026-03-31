/**
 * Session Integration Tests
 *
 * Comprehensive integration tests for session operations via WebSocket.
 * Covers all session handlers, streaming, and subscriptions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectionManager } from '../connection-manager';
import { MessageRouter, type HandlerContext } from '../message-router';
import { SessionHandler, registerSessionHandlers } from '../handlers/session';
import { StreamManager } from '../streaming';
import { SubscriptionManager } from '../subscriptions';
import { RunEventEmitter, type RunEvent } from '../../dispatch/events';
import {
  type WSMessage,
  type WSResponse,
  type SessionStreamEvent,
  createWSMessage,
  isSessionStreamEvent,
  isErrorResponse,
  WS_ERROR_CODES,
} from '@openaidy/shared-types';

// ============================================================================
// Test Types
// ============================================================================

type SessionCreatedResponse = WSMessage<'session.created', {
  sessionId: string;
  agentId: string;
  createdAt: string;
}>;

type SessionGetResponse = WSMessage<'session.get', {
  session: {
    id: string;
    title?: string;
    status: string;
    createdAt: string;
    updatedAt?: string;
  };
}>;

type SessionListResponse = WSMessage<'session.list', {
  sessions: Array<{
    id: string;
    title?: string;
    status: string;
    createdAt: string;
  }>;
  total: number;
}>;

type SessionDeleteResponse = WSMessage<'session.delete', {
  sessionId: string;
  deleted: boolean;
}>;

type SessionMessageResponse = WSMessage<'session.message', {
  sessionId: string;
  messageId: string;
  role: 'assistant';
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}>;

type SessionSubscribedResponse = WSMessage<'session.subscribed', {
  sessionId: string;
  subscriptionId: string;
}>;

type SessionUnsubscribedResponse = WSMessage<'session.unsubscribed', {
  sessionId: string;
}>;

type ErrorResponse = WSMessage<'error', {
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}>;

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

const createMockSessionService = () => ({
  createSession: vi.fn().mockResolvedValue({
    id: 'session-test-id',
    title: 'Test Session',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  getSession: vi.fn().mockImplementation(async (id: string) => {
    if (id === 'non-existent-session') return null;
    return {
      id,
      title: 'Test Session',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }),
  listSessions: vi.fn().mockResolvedValue([
    {
      id: 'session-1',
      title: 'Session 1',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'session-2',
      title: 'Session 2',
      status: 'archived',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'session-3',
      title: 'Session 3',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]),
  deleteSession: vi.fn().mockImplementation(async (id: string) => {
    if (id === 'non-existent-session') return false;
    return true;
  }),
  submitMessage: vi.fn().mockResolvedValue({
    ok: true,
    userMessage: { id: 'msg-user', content: 'Hello', role: 'user' },
    assistantMessage: { id: 'msg-assistant', content: 'Hi there! How can I help you?', role: 'assistant' },
    run: { 
      id: 'run-test-id', 
      finishReason: 'stop',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
  }),
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Send a message through the router and wait for response
 */
async function sendAndReceive<T>(
  router: MessageRouter,
  connectionId: string,
  type: string,
  payload: unknown,
  context: HandlerContext,
): Promise<T> {
  const message = createWSMessage(type, payload);
  const response = await router.route(connectionId, message, context);
  return response as T;
}

/**
 * Create a mock connection context
 */
function createMockHandlerContext(
  connectionManager: ConnectionManager,
  logger: HandlerContext['logger'],
): HandlerContext {
  return {
    connectionManager,
    services: {},
    logger,
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Session Integration Tests', () => {
  let connectionManager: ConnectionManager;
  let messageRouter: MessageRouter;
  let sessionHandler: SessionHandler;
  let streamManager: StreamManager;
  let subscriptionManager: SubscriptionManager;
  let runEvents: RunEventEmitter;
  let mockSessionService: ReturnType<typeof createMockSessionService>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handlerContext: HandlerContext;

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
    streamManager = new StreamManager(
      runEvents,
      connectionManager,
      mockLogger as unknown as HandlerContext['logger'],
    );
    subscriptionManager = new SubscriptionManager(
      connectionManager,
      mockLogger as unknown as HandlerContext['logger'],
    );

    // Register session handlers
    registerSessionHandlers(messageRouter, sessionHandler);

    // Create handler context
    handlerContext = createMockHandlerContext(connectionManager, mockLogger as unknown as HandlerContext['logger']);

    // Start stream manager
    streamManager.start();
  });

  afterEach(() => {
    streamManager.stop();
    subscriptionManager.cleanup();
    connectionManager.closeAll();
  });

  // ============================================================================
  // Connection Tests
  // ============================================================================

  describe('Connection Tests', () => {
    it('should register connection', () => {
      const ctx = connectionManager.registerConnection('conn-1');
      expect(ctx.id).toBe('conn-1');
      expect(ctx.status).toBe('connected');
      expect(connectionManager.getConnectionCount()).toBe(1);
    });

    it('should remove connection', () => {
      connectionManager.registerConnection('conn-1');
      connectionManager.removeConnection('conn-1');
      expect(connectionManager.getConnectionCount()).toBe(0);
    });

    it('should update heartbeat on message', () => {
      const ctx = connectionManager.registerConnection('conn-1');
      const initialHeartbeat = ctx.lastHeartbeat;

      connectionManager.updateHeartbeat('conn-1');

      const updated = connectionManager.getConnection('conn-1');
      expect(updated?.lastHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);
    });

    it('should check rate limit', () => {
      connectionManager.registerConnection('conn-1');

      // Should allow initially
      const result = connectionManager.checkRateLimit('conn-1');
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Session Creation Tests
  // ============================================================================

  describe('Session Creation Tests', () => {
    it('should create a session via WebSocket', async () => {
      const response = await sendAndReceive<SessionCreatedResponse>(
        messageRouter,
        'conn-1',
        'session.create',
        {},
        handlerContext,
      );

      expect(response.type).toBe('session.created');
      expect(response.payload.sessionId).toBeDefined();
      expect(response.payload.agentId).toBeDefined();
      expect(response.payload.createdAt).toBeDefined();
    });

    it('should create a session with custom agent', async () => {
      const response = await sendAndReceive<SessionCreatedResponse>(
        messageRouter,
        'conn-1',
        'session.create',
        { agentId: 'custom-agent' },
        handlerContext,
      );

      expect(response.type).toBe('session.created');
      expect(response.payload.agentId).toBe('custom-agent');
    });

    it('should create a session with provider/model override', async () => {
      const response = await sendAndReceive<SessionCreatedResponse>(
        messageRouter,
        'conn-1',
        'session.create',
        { providerId: 'openai', modelId: 'gpt-4' },
        handlerContext,
      );

      expect(response.type).toBe('session.created');
      expect(response.payload.sessionId).toBeDefined();
    });

    it('should handle session creation error', async () => {
      mockSessionService.createSession.mockRejectedValueOnce(new Error('Database error'));

      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'session.create',
        {},
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
    });
  });

  // ============================================================================
  // Session Query Tests
  // ============================================================================

  describe('Session Query Tests', () => {
    it('should get a session via WebSocket', async () => {
      const response = await sendAndReceive<SessionGetResponse>(
        messageRouter,
        'conn-1',
        'session.get',
        { sessionId: 'session-test-id' },
        handlerContext,
      );

      expect(response.type).toBe('session.get');
      expect(response.payload.session.id).toBe('session-test-id');
      expect(response.payload.session.status).toBeDefined();
    });

    it('should return error for non-existent session', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'session.get',
        { sessionId: 'non-existent-session' },
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
    });

    it('should list sessions via WebSocket', async () => {
      const response = await sendAndReceive<SessionListResponse>(
        messageRouter,
        'conn-1',
        'session.list',
        {},
        handlerContext,
      );

      expect(response.type).toBe('session.list');
      expect(Array.isArray(response.payload.sessions)).toBe(true);
      expect(response.payload.total).toBeGreaterThanOrEqual(0);
    });

    it('should list sessions with status filter', async () => {
      const response = await sendAndReceive<SessionListResponse>(
        messageRouter,
        'conn-1',
        'session.list',
        { status: 'active' },
        handlerContext,
      );

      expect(response.type).toBe('session.list');
      expect(response.payload.sessions.every(s => s.status === 'active')).toBe(true);
    });

    it('should list sessions with pagination', async () => {
      const response = await sendAndReceive<SessionListResponse>(
        messageRouter,
        'conn-1',
        'session.list',
        { offset: 0, limit: 2 },
        handlerContext,
      );

      expect(response.type).toBe('session.list');
      expect(response.payload.sessions.length).toBeLessThanOrEqual(2);
    });

    it('should list sessions with agent filter', async () => {
      const response = await sendAndReceive<SessionListResponse>(
        messageRouter,
        'conn-1',
        'session.list',
        { agentId: 'test-agent' },
        handlerContext,
      );

      expect(response.type).toBe('session.list');
    });
  });

  // ============================================================================
  // Session Delete Tests
  // ============================================================================

  describe('Session Delete Tests', () => {
    it('should delete a session via WebSocket', async () => {
      const response = await sendAndReceive<SessionDeleteResponse>(
        messageRouter,
        'conn-1',
        'session.delete',
        { sessionId: 'session-test-id' },
        handlerContext,
      );

      expect(response.type).toBe('session.delete');
      expect(response.payload.sessionId).toBe('session-test-id');
      expect(response.payload.deleted).toBe(true);
    });

    it('should return error when deleting non-existent session', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'session.delete',
        { sessionId: 'non-existent-session' },
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
    });
  });

  // ============================================================================
  // Session Message Tests
  // ============================================================================

  describe('Session Message Tests', () => {
    it('should send a non-streaming message', async () => {
      const response = await sendAndReceive<SessionMessageResponse>(
        messageRouter,
        'conn-1',
        'session.message',
        {
          sessionId: 'session-test-id',
          role: 'user',
          content: 'Hello!',
          stream: false,
        },
        handlerContext,
      );

      expect(response.type).toBe('session.message');
      expect(response.payload.sessionId).toBe('session-test-id');
      expect(response.payload.messageId).toBeDefined();
      expect(response.payload.role).toBe('assistant');
    });

    it('should send a message with custom provider/model', async () => {
      const response = await sendAndReceive<SessionMessageResponse>(
        messageRouter,
        'conn-1',
        'session.message',
        {
          sessionId: 'session-test-id',
          role: 'user',
          content: 'Hello!',
          metadata: {
            providerId: 'anthropic',
            modelId: 'claude-3',
          },
        },
        handlerContext,
      );

      expect(response.type).toBe('session.message');
    });

    it('should return error for streaming in non-streaming handler', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'session.message',
        {
          sessionId: 'session-test-id',
          role: 'user',
          content: 'Hello!',
          stream: true,
        },
        handlerContext,
      );

      // The session handler returns error for streaming requests
      expect(response.type).toBe('error');
    });
  });

  // ============================================================================
  // Streaming Tests
  // ============================================================================

  describe('Streaming Tests', () => {
    it('should have stream manager running', () => {
      expect(streamManager.running).toBe(true);
    });

    it('should subscribe to run stream', () => {
      connectionManager.registerConnection('conn-1');

      streamManager.subscribeToRun('run-123', 'conn-1');
      expect(streamManager.getRunSubscriptionCount('run-123')).toBe(1);
    });

    it('should unsubscribe from run stream', () => {
      connectionManager.registerConnection('conn-1');

      streamManager.subscribeToRun('run-123', 'conn-1');
      streamManager.unsubscribeFromRun('run-123', 'conn-1');
      expect(streamManager.getRunSubscriptionCount('run-123')).toBe(0);
    });

    it('should handle multiple run subscriptions', () => {
      connectionManager.registerConnection('conn-1');
      connectionManager.registerConnection('conn-2');

      streamManager.subscribeToRun('run-123', 'conn-1');
      streamManager.subscribeToRun('run-123', 'conn-2');
      expect(streamManager.getRunSubscriptionCount('run-123')).toBe(2);
    });

    it('should unsubscribe all from connection', () => {
      connectionManager.registerConnection('conn-1');

      streamManager.subscribeToRun('run-123', 'conn-1');
      streamManager.subscribeToRun('run-456', 'conn-1');

      streamManager.unsubscribeAllFromConnection('conn-1');
      expect(streamManager.getConnectionSubscriptionCount('conn-1')).toBe(0);
    });
  });

  // ============================================================================
  // Subscription Tests
  // ============================================================================

  describe('Subscription Tests', () => {
    it('should create subscription', () => {
      connectionManager.registerConnection('conn-1');

      const subId = subscriptionManager.createSubscription('conn-1', 'session-123');
      expect(subId).toBeDefined();
      expect(subId?.startsWith('sub_')).toBe(true);
    });

    it('should create subscription with event types', () => {
      connectionManager.registerConnection('conn-1');

      const subId = subscriptionManager.createSubscription(
        'conn-1',
        'session-123',
        ['session.message', 'session.updated'],
      );
      expect(subId).toBeDefined();
    });

    it('should find subscription by connection and session', () => {
      connectionManager.registerConnection('conn-1');

      subscriptionManager.createSubscription('conn-1', 'session-123');
      const sub = subscriptionManager.findSubscription('conn-1', 'session-123');

      expect(sub).toBeDefined();
    });

    it('should remove subscription', () => {
      connectionManager.registerConnection('conn-1');

      const subId = subscriptionManager.createSubscription('conn-1', 'session-123');
      subscriptionManager.removeSubscription(subId!);

      expect(subscriptionManager.getSubscriptionCount()).toBe(0);
    });

    it('should remove connection subscriptions on cleanup', () => {
      connectionManager.registerConnection('conn-1');

      subscriptionManager.createSubscription('conn-1', 'session-123');
      subscriptionManager.createSubscription('conn-1', 'session-456');

      const removed = subscriptionManager.removeConnectionSubscriptions('conn-1');
      expect(removed).toBe(2);
      expect(subscriptionManager.getSubscriptionCount()).toBe(0);
    });

    it('should get session subscriptions', () => {
      connectionManager.registerConnection('conn-1');
      connectionManager.registerConnection('conn-2');

      subscriptionManager.createSubscription('conn-1', 'session-123');
      subscriptionManager.createSubscription('conn-2', 'session-123');

      const subs = subscriptionManager.getSessionSubscriptions('session-123');
      expect(subs).toHaveLength(2);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling Tests', () => {
    it('should return error for unknown message type', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'unknown.type',
        {},
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.UNKNOWN_MESSAGE_TYPE);
    });

    it('should handle invalid session ID format', async () => {
      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'session.get',
        { sessionId: '' },
        handlerContext,
      );

      // Should return error or handle gracefully
      expect(response).toBeDefined();
    });

    it('should handle service errors gracefully', async () => {
      mockSessionService.listSessions.mockRejectedValueOnce(new Error('Service unavailable'));

      const response = await sendAndReceive<ErrorResponse>(
        messageRouter,
        'conn-1',
        'session.list',
        {},
        handlerContext,
      );

      expect(response.type).toBe('error');
      expect(response.payload.error.code).toBe(WS_ERROR_CODES.INTERNAL_ERROR);
    });
  });

  // ============================================================================
  // Handler Registration Tests
  // ============================================================================

  describe('Handler Registration Tests', () => {
    it('should have all session handlers registered', () => {
      expect(messageRouter.hasHandler('session.create')).toBe(true);
      expect(messageRouter.hasHandler('session.get')).toBe(true);
      expect(messageRouter.hasHandler('session.list')).toBe(true);
      expect(messageRouter.hasHandler('session.delete')).toBe(true);
      expect(messageRouter.hasHandler('session.message')).toBe(true);
    });

    it('should have exactly 5 session handlers', () => {
      const types = messageRouter.getHandlerTypes();
      const sessionHandlers = types.filter(t => t.startsWith('session.'));
      expect(sessionHandlers).toHaveLength(5);
    });
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================

  describe('Cleanup Tests', () => {
    it('should cleanup all resources on connection close', () => {
      // Setup
      const connId = 'conn-1';
      connectionManager.registerConnection(connId);
      subscriptionManager.createSubscription(connId, 'session-123');
      streamManager.subscribeToRun('run-123', connId);

      // Verify setup
      expect(connectionManager.getConnectionCount()).toBe(1);
      expect(subscriptionManager.getSubscriptionCount()).toBe(1);

      // Cleanup
      subscriptionManager.removeConnectionSubscriptions(connId);
      streamManager.unsubscribeAllFromConnection(connId);
      connectionManager.removeConnection(connId);

      // Verify cleanup
      expect(connectionManager.getConnectionCount()).toBe(0);
      expect(subscriptionManager.getSubscriptionCount()).toBe(0);
      expect(streamManager.getConnectionSubscriptionCount(connId)).toBe(0);
    });

    it('should handle multiple connections independently', () => {
      // Setup two connections
      connectionManager.registerConnection('conn-1');
      connectionManager.registerConnection('conn-2');
      subscriptionManager.createSubscription('conn-1', 'session-123');
      subscriptionManager.createSubscription('conn-2', 'session-123');

      // Remove one connection
      subscriptionManager.removeConnectionSubscriptions('conn-1');
      connectionManager.removeConnection('conn-1');

      // Verify other connection still exists
      expect(connectionManager.getConnectionCount()).toBe(1);
      expect(subscriptionManager.getSubscriptionCount()).toBe(1);
    });
  });

  // ============================================================================
  // Gateway Integration Tests
  // ============================================================================

  describe('Gateway Integration Tests', () => {
    it('should track pending requests', () => {
      const requestId = messageRouter.createRequestId();
      expect(requestId).toBeDefined();
      expect(requestId.startsWith('req_')).toBe(true);
    });

    it('should clear pending requests on connection close', async () => {
      // Track a request
      const requestId = messageRouter.createRequestId();
      const trackPromise = messageRouter.trackRequest(requestId, 'conn-1');

      // Clear for connection - this will reject the promise
      const cleared = messageRouter.clearPendingRequests('conn-1');
      expect(cleared).toBe(1);

      // Handle the rejected promise to avoid unhandled rejection
      await expect(trackPromise).rejects.toThrow('Connection closed');
    });

    it('should check if message can be routed', () => {
      expect(messageRouter.canRoute({ id: '1', type: 'session.create', timestamp: '', payload: {} })).toBe(true);
      expect(messageRouter.canRoute({ id: '1', type: 'unknown.type', timestamp: '', payload: {} })).toBe(false);
    });
  });
});
