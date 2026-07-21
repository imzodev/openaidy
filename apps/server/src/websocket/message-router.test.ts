import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  MessageRouter,
  type MessageHandler,
  type HandlerContext,
} from './message-router';
import { createWSMessage, type WSResponse } from '@openaidy/shared-types';
import { ConnectionManager } from './connection-manager';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Mock services
const mockServices = {};

// Mock connection manager
const mockConnectionManager = {
  getConnection: () => undefined,
  getAllConnections: () => [],
  subscribe: () => true,
  unsubscribe: () => true,
  getSubscribers: () => [],
  send: () => true,
  broadcast: () => 0,
  checkRateLimit: () => ({
    allowed: true,
    info: { remaining: 100, reset: 0, limit: 100 },
  }),
  recordRequest: () => {},
} as unknown as ConnectionManager;

// Handler context
const handlerContext: HandlerContext = {
  connectionManager: mockConnectionManager,
  services: mockServices,
  logger: mockLogger as unknown as FastifyBaseLogger,
};

describe('MessageRouter', () => {
  let router: MessageRouter;

  beforeEach(() => {
    router = new MessageRouter(mockLogger as unknown as FastifyBaseLogger);
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clear handlers only - don't clear pending requests in afterEach
    // to avoid unhandled rejections
    router.clearHandlers();
  });

  // ============================================================================
  // Handler Registration
  // ============================================================================

  describe('registerHandler', () => {
    it('should register a handler', () => {
      const handler: MessageHandler = async () => undefined;
      router.registerHandler('test.message', handler);

      expect(router.hasHandler('test.message')).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Registered handler for message type: test.message',
      );
    });

    it('should allow multiple handlers', () => {
      router.registerHandler('test.one', async () => undefined);
      router.registerHandler('test.two', async () => undefined);
      router.registerHandler('test.three', async () => undefined);

      expect(router.getHandlerCount()).toBe(3);
    });

    it('should overwrite existing handler', () => {
      const handler1: MessageHandler = async () => undefined;
      const handler2: MessageHandler = async () => undefined;

      router.registerHandler('test.message', handler1);
      router.registerHandler('test.message', handler2);

      expect(router.getHandlerCount()).toBe(1);
    });
  });

  describe('unregisterHandler', () => {
    it('should unregister a handler', () => {
      router.registerHandler('test.message', async () => undefined);
      router.unregisterHandler('test.message');

      expect(router.hasHandler('test.message')).toBe(false);
    });

    it('should not throw for unknown handler', () => {
      expect(() => router.unregisterHandler('unknown')).not.toThrow();
    });

    it('should log when unregistering', () => {
      router.registerHandler('test.message', async () => undefined);
      router.unregisterHandler('test.message');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Unregistered handler for message type: test.message',
      );
    });
  });

  describe('hasHandler', () => {
    it('should return true for registered handler', () => {
      router.registerHandler('test.message', async () => undefined);
      expect(router.hasHandler('test.message')).toBe(true);
    });

    it('should return false for unknown handler', () => {
      expect(router.hasHandler('unknown')).toBe(false);
    });
  });

  describe('getHandlerTypes', () => {
    it('should return all registered types', () => {
      router.registerHandler('test.one', async () => undefined);
      router.registerHandler('test.two', async () => undefined);

      const types = router.getHandlerTypes();
      expect(types).toContain('test.one');
      expect(types).toContain('test.two');
    });

    it('should return empty array when no handlers', () => {
      expect(router.getHandlerTypes()).toEqual([]);
    });
  });

  describe('getHandlerCount', () => {
    it('should return correct count', () => {
      expect(router.getHandlerCount()).toBe(0);

      router.registerHandler('test.one', async () => undefined);
      expect(router.getHandlerCount()).toBe(1);

      router.registerHandler('test.two', async () => undefined);
      expect(router.getHandlerCount()).toBe(2);
    });
  });

  // ============================================================================
  // Message Routing
  // ============================================================================

  describe('route', () => {
    it('should route message to correct handler', async () => {
      let received: { connId: string; msg: unknown } | undefined;

      const handler: MessageHandler = async (connId, msg) => {
        received = { connId, msg };
        return createWSMessage('test.response', {
          echo: msg.payload,
        }) as unknown as WSResponse;
      };

      router.registerHandler('test.message', handler);

      const message = createWSMessage('test.message', { data: 'hello' });
      const result = await router.route('conn-1', message, handlerContext);

      expect(received).toBeDefined();
      expect(received?.connId).toBe('conn-1');
      expect(result?.type).toBe('test.response');
    });

    it('should return error for unknown message type', async () => {
      const message = createWSMessage('unknown.type', {});
      const result = await router.route('conn-1', message, handlerContext);

      expect(result?.type).toBe('error');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No handler registered for message type: unknown.type',
      );
    });

    it('should handle handler errors', async () => {
      const handler: MessageHandler = async () => {
        throw new Error('Handler failed');
      };

      router.registerHandler('test.error', handler);

      const message = createWSMessage('test.error', { data: 'test' });
      const result = await router.route('conn-1', message, handlerContext);

      expect(result?.type).toBe('error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return void for handler that returns nothing', async () => {
      const handler: MessageHandler = async () => undefined;
      router.registerHandler('test.void', handler);

      const message = createWSMessage('test.void', {});
      const result = await router.route('conn-1', message, handlerContext);

      expect(result).toBeUndefined();
    });

    it('should pass correct context to handler', async () => {
      let receivedContext: HandlerContext | undefined;

      const handler: MessageHandler = async (_, __, ctx) => {
        receivedContext = ctx;
        return undefined;
      };

      router.registerHandler('test.context', handler);

      const message = createWSMessage('test.context', {});
      await router.route('conn-1', message, handlerContext);

      expect(receivedContext).toBe(handlerContext);
    });
  });

  describe('canRoute', () => {
    it('should return true for routable message', () => {
      router.registerHandler('test.message', async () => undefined);

      const message = createWSMessage('test.message', {});
      expect(router.canRoute(message)).toBe(true);
    });

    it('should return false for unknown type', () => {
      const message = createWSMessage('unknown.type', {});
      expect(router.canRoute(message)).toBe(false);
    });

    it('should return false for invalid message', () => {
      expect(router.canRoute(null)).toBe(false);
      expect(router.canRoute({})).toBe(false);
      expect(router.canRoute({ type: 123 })).toBe(false);
    });
  });

  // ============================================================================
  // Request-Response Correlation
  // ============================================================================

  describe('createRequestId', () => {
    it('should create unique request IDs', () => {
      const id1 = router.createRequestId();
      const id2 = router.createRequestId();
      const id3 = router.createRequestId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
    });
  });

  describe('trackRequest', () => {
    it('should track pending request', async () => {
      const requestId = router.createRequestId();
      const promise = router.trackRequest(requestId, 'conn-1');
      // Complete it to avoid hanging promise
      router.completeRequest(
        requestId,
        createWSMessage('response', {}) as unknown as WSResponse,
      );

      expect(router.getPendingCount()).toBe(0);
      await promise;
    });

    it('should return a promise', async () => {
      const requestId = router.createRequestId();
      const promise = router.trackRequest(requestId, 'conn-1');

      expect(promise).toBeInstanceOf(Promise);
      // Complete to avoid hanging
      router.completeRequest(
        requestId,
        createWSMessage('response', {}) as unknown as WSResponse,
      );
      await promise;
    });

    it('should timeout after configured time', async () => {
      const fastRouter = new MessageRouter(
        mockLogger as unknown as FastifyBaseLogger,
        10,
      ); // 10ms
      const requestId = fastRouter.createRequestId();

      await expect(
        fastRouter.trackRequest(requestId, 'conn-1'),
      ).rejects.toThrow('Request timeout');
    });
  });

  describe('completeRequest', () => {
    it('should resolve pending request', async () => {
      const requestId = router.createRequestId();
      const promise = router.trackRequest(requestId, 'conn-1');

      const response = createWSMessage('response', { data: 'result' });
      const completed = router.completeRequest(
        requestId,
        response as unknown as WSResponse,
      );

      expect(completed).toBe(true);
      await expect(promise).resolves.toBe(response);
    });

    it('should remove pending request after completion', async () => {
      const requestId = router.createRequestId();
      const promise = router.trackRequest(requestId, 'conn-1');

      const response = createWSMessage('response', {});
      router.completeRequest(requestId, response as unknown as WSResponse);

      expect(router.getPendingCount()).toBe(0);
      await promise;
    });

    it('should return false for unknown request', () => {
      const response = createWSMessage('response', {});
      expect(
        router.completeRequest('unknown', response as unknown as WSResponse),
      ).toBe(false);
    });
  });

  describe('failRequest', () => {
    it('should reject pending request', async () => {
      const requestId = router.createRequestId();
      const promise = router.trackRequest(requestId, 'conn-1');

      const error = { code: 'TEST_ERROR', message: 'Test error' };
      const failed = router.failRequest(requestId, error);

      expect(failed).toBe(true);
      await expect(promise).rejects.toThrow('Test error');
    });

    it('should remove pending request after failure', async () => {
      const requestId = router.createRequestId();
      const promise = router.trackRequest(requestId, 'conn-1');

      router.failRequest(requestId, { code: 'ERROR', message: 'Error' });

      expect(router.getPendingCount()).toBe(0);
      await expect(promise).rejects.toThrow('Error');
    });

    it('should return false for unknown request', () => {
      expect(
        router.failRequest('unknown', { code: 'ERROR', message: 'Error' }),
      ).toBe(false);
    });
  });

  describe('getPendingCount', () => {
    it('should return correct count', async () => {
      expect(router.getPendingCount()).toBe(0);

      const id1 = router.createRequestId();
      const p1 = router.trackRequest(id1, 'conn-1');
      expect(router.getPendingCount()).toBe(1);

      const id2 = router.createRequestId();
      const p2 = router.trackRequest(id2, 'conn-2');
      expect(router.getPendingCount()).toBe(2);

      // Clean up
      router.completeRequest(id1, {} as unknown as WSResponse);
      router.completeRequest(id2, {} as unknown as WSResponse);
      await Promise.all([p1, p2]);
    });
  });

  describe('getPendingForConnection', () => {
    it('should return pending request IDs for connection', async () => {
      const id1 = router.createRequestId();
      const id2 = router.createRequestId();
      const id3 = router.createRequestId();

      const p1 = router.trackRequest(id1, 'conn-1');
      const p2 = router.trackRequest(id2, 'conn-1');
      const p3 = router.trackRequest(id3, 'conn-2');

      const pending = router.getPendingForConnection('conn-1');

      expect(pending.length).toBe(2);
      expect(pending).toContain(id1);
      expect(pending).toContain(id2);
      expect(pending).not.toContain(id3);

      // Clean up
      router.completeRequest(id1, {} as unknown as WSResponse);
      router.completeRequest(id2, {} as unknown as WSResponse);
      router.completeRequest(id3, {} as unknown as WSResponse);
      await Promise.all([p1, p2, p3]);
    });

    it('should return empty array for connection with no pending', () => {
      expect(router.getPendingForConnection('unknown')).toEqual([]);
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe('clearPendingRequests', () => {
    it('should clear pending requests for connection', async () => {
      const id1 = router.createRequestId();
      const id2 = router.createRequestId();

      const promise1 = router.trackRequest(id1, 'conn-1');
      const promise2 = router.trackRequest(id2, 'conn-1');

      const cleared = router.clearPendingRequests('conn-1');

      expect(cleared).toBe(2);
      expect(router.getPendingCount()).toBe(0);
      await expect(promise1).rejects.toThrow('Connection closed');
      await expect(promise2).rejects.toThrow('Connection closed');
    });

    it('should only clear requests for specified connection', async () => {
      const id1 = router.createRequestId();
      const id2 = router.createRequestId();

      const p1 = router.trackRequest(id1, 'conn-1');
      const p2 = router.trackRequest(id2, 'conn-2');

      const cleared = router.clearPendingRequests('conn-1');

      expect(cleared).toBe(1);
      expect(router.getPendingCount()).toBe(1);

      // Clean up remaining - p1 gets rejected, p2 gets completed
      router.completeRequest(id2, {} as unknown as WSResponse);
      await expect(p1).rejects.toThrow('Connection closed');
      await p2;
    });

    it('should return 0 for connection with no pending', () => {
      expect(router.clearPendingRequests('unknown')).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('should clear all pending requests', async () => {
      const id1 = router.createRequestId();
      const id2 = router.createRequestId();

      const promise1 = router.trackRequest(id1, 'conn-1');
      const promise2 = router.trackRequest(id2, 'conn-2');

      router.clearAll();

      expect(router.getPendingCount()).toBe(0);
      await expect(promise1).rejects.toThrow('Router shutdown');
      await expect(promise2).rejects.toThrow('Router shutdown');
    });
  });

  describe('clearHandlers', () => {
    it('should clear all handlers', () => {
      router.registerHandler('test.one', async () => undefined);
      router.registerHandler('test.two', async () => undefined);

      router.clearHandlers();

      expect(router.getHandlerCount()).toBe(0);
    });
  });
});
