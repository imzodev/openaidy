/**
 * Presence Handler Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { PresenceHandler, registerPresenceHandlers } from './presence';
import { PresenceManager } from '../presence-manager';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import {
  createWSMessage,
  WS_ERROR_CODES,
} from '@openaidy/shared-types';

// ============================================================================
// Mocks
// ============================================================================

const createMockLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as FastifyBaseLogger);

const createMockConnectionManager = (): ConnectionManager =>
  ({
    registerConnection: vi.fn(),
    removeConnection: vi.fn(),
    getConnection: vi.fn().mockReturnValue({
      id: 'conn-1',
      socket: { readyState: 1, send: vi.fn() },
      authenticated: true,
      capabilities: ['presence.read', 'presence.write'],
      clientId: 'client-abc',
    }),
    getConnectionCount: vi.fn().mockReturnValue(0),
    getAllConnections: vi.fn().mockReturnValue([]),
    closeAll: vi.fn(),
  } as unknown as ConnectionManager);

// ============================================================================
// Tests
// ============================================================================

describe('PresenceHandler', () => {
  let handler: PresenceHandler;
  let presenceManager: PresenceManager;
  let mockConnectionManager: ConnectionManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let handlerContext: HandlerContext;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConnectionManager = createMockConnectionManager();
    presenceManager = new PresenceManager({}, mockLogger);

    handler = new PresenceHandler(
      presenceManager,
      mockConnectionManager,
      mockLogger,
    );

    handlerContext = {
      connectionManager: mockConnectionManager,
      services: {} as any,
      logger: mockLogger,
    };
  });

  // ============================================================================
  // handleUpdate Tests
  // ============================================================================

  describe('handleUpdate', () => {
    it('should update presence to online', async () => {
      const request = createWSMessage('presence.update', {
        status: 'online',
      }) as any;

      const response = await handler.handleUpdate('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.update');
      if ('success' in response.payload) {
        expect(response.payload.success).toBe(true);
        expect(response.payload.presence.status).toBe('online');
      }
    });

    it('should update presence to away', async () => {
      const request = createWSMessage('presence.update', {
        status: 'away',
      }) as any;

      const response = await handler.handleUpdate('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.update');
      if ('success' in response.payload) {
        expect(response.payload.presence.status).toBe('away');
      }
    });

    it('should update presence to busy', async () => {
      const request = createWSMessage('presence.update', {
        status: 'busy',
      }) as any;

      const response = await handler.handleUpdate('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.update');
      if ('success' in response.payload) {
        expect(response.payload.presence.status).toBe('busy');
      }
    });

    it('should update presence to offline', async () => {
      const request = createWSMessage('presence.update', {
        status: 'offline',
      }) as any;

      const response = await handler.handleUpdate('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.update');
      if ('success' in response.payload) {
        expect(response.payload.presence.status).toBe('offline');
      }
    });

    it('should update presence with metadata', async () => {
      const request = createWSMessage('presence.update', {
        status: 'online',
        metadata: { device: 'iPhone', location: 'US' },
      }) as any;

      const response = await handler.handleUpdate('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.update');
      if ('success' in response.payload) {
        expect(response.payload.presence.metadata).toEqual({
          device: 'iPhone',
          location: 'US',
        });
      }
    });

    it('should return error for invalid status', async () => {
      const request = createWSMessage('presence.update', {
        status: 'invalid-status',
      }) as any;

      const response = await handler.handleUpdate('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if ('error' in response.payload) {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it('should log update operation', async () => {
      const request = createWSMessage('presence.update', {
        status: 'online',
      }) as any;

      await handler.handleUpdate('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // handleGet Tests
  // ============================================================================

  describe('handleGet', () => {
    it('should get own presence', async () => {
      // Set up presence first
      presenceManager.updatePresence('conn-1', 'online');

      const request = createWSMessage('presence.get', {}) as any;

      const response = await handler.handleGet('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.get');
      if ('presence' in response.payload) {
        const p = response.payload.presence as any;
        expect(p.status).toBe('online');
      }
    });

    it('should get presence by connectionId', async () => {
      presenceManager.updatePresence('conn-2', 'busy');

      const request = createWSMessage('presence.get', {
        connectionId: 'conn-2',
      }) as any;

      const response = await handler.handleGet('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.get');
      if ('presence' in response.payload) {
        const p = response.payload.presence as any;
        expect(p.connectionId).toBe('conn-2');
        expect(p.status).toBe('busy');
      }
    });

    it('should get presence by clientId', async () => {
      presenceManager.updatePresence('conn-2', 'away', { clientId: 'client-xyz' });

      const request = createWSMessage('presence.get', {
        clientId: 'client-xyz',
      }) as any;

      const response = await handler.handleGet('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.get');
    });

    it('should return error for non-existent presence', async () => {
      const request = createWSMessage('presence.get', {
        connectionId: 'conn-999',
      }) as any;

      const response = await handler.handleGet('conn-1', request, handlerContext);

      expect(response.type).toBe('error');
      if ('error' in response.payload) {
        expect(response.payload.error.code).toBe(WS_ERROR_CODES.NOT_FOUND);
      }
    });
  });

  // ============================================================================
  // handleGetAll Tests
  // ============================================================================

  describe('handleGetAll', () => {
    it('should get all presence entries', async () => {
      presenceManager.updatePresence('conn-1', 'online');
      presenceManager.updatePresence('conn-2', 'away');
      presenceManager.updatePresence('conn-3', 'busy');

      const request = createWSMessage('presence.getAll', {}) as any;

      const response = await handler.handleGetAll('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.getAll');
      if ('presence' in response.payload) {
        expect(response.payload.presence).toHaveLength(3);
        expect(response.payload.total).toBe(3);
      }
    });

    it('should return empty array when no presence', async () => {
      const request = createWSMessage('presence.getAll', {}) as any;

      const response = await handler.handleGetAll('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.getAll');
      if ('presence' in response.payload) {
        expect(response.payload.presence).toEqual([]);
        expect(response.payload.total).toBe(0);
      }
    });
  });

  // ============================================================================
  // handleSubscribe Tests
  // ============================================================================

  describe('handleSubscribe', () => {
    it('should subscribe to presence events', async () => {
      const request = createWSMessage('presence.subscribe', {}) as any;

      const response = await handler.handleSubscribe('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.subscribe');
      if ('subscribed' in response.payload) {
        expect(response.payload.subscribed).toBe(true);
      }
      expect(presenceManager.isSubscribed('conn-1')).toBe(true);
    });

    it('should log subscription', async () => {
      const request = createWSMessage('presence.subscribe', {}) as any;

      await handler.handleSubscribe('conn-1', request, handlerContext);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // handleUnsubscribe Tests
  // ============================================================================

  describe('handleUnsubscribe', () => {
    it('should unsubscribe from presence events', async () => {
      presenceManager.subscribe('conn-1');

      const request = createWSMessage('presence.unsubscribe', {}) as any;

      const response = await handler.handleUnsubscribe('conn-1', request, handlerContext);

      expect(response.type).toBe('presence.unsubscribe');
      if ('subscribed' in response.payload) {
        expect(response.payload.subscribed).toBe(false);
      }
      expect(presenceManager.isSubscribed('conn-1')).toBe(false);
    });

    it('should handle unsubscribing non-existent subscriber', async () => {
      const request = createWSMessage('presence.unsubscribe', {}) as any;

      const response = await handler.handleUnsubscribe('conn-999', request, handlerContext);

      expect(response.type).toBe('presence.unsubscribe');
      if ('subscribed' in response.payload) {
        expect(response.payload.subscribed).toBe(false);
      }
    });
  });

  // ============================================================================
  // removeConnection Tests
  // ============================================================================

  describe('removeConnection', () => {
    it('should remove connection from presence manager', () => {
      presenceManager.updatePresence('conn-1', 'online');
      presenceManager.subscribe('conn-1');

      handler.removeConnection('conn-1');

      expect(presenceManager.getPresence('conn-1')).toBeUndefined();
      expect(presenceManager.isSubscribed('conn-1')).toBe(false);
    });
  });

  // ============================================================================
  // Broadcast Tests
  // ============================================================================

  describe('broadcast', () => {
    it('should broadcast presence change to subscribers', async () => {
      // Set up subscriber with a mock socket
      const mockSend = vi.fn();
      (mockConnectionManager.getConnection as any).mockImplementation((id: string) => {
        if (id === 'conn-2') {
          return {
            id: 'conn-2',
            socket: { readyState: 1, send: mockSend },
            authenticated: true,
          };
        }
        return {
          id: 'conn-1',
          socket: { readyState: 1, send: vi.fn() },
          authenticated: true,
          capabilities: ['presence.read', 'presence.write'],
          clientId: 'client-abc',
        };
      });

      // Subscribe conn-2 to presence events
      presenceManager.subscribe('conn-2');

      // Update presence from conn-1
      const request = createWSMessage('presence.update', {
        status: 'away',
      }) as any;

      await handler.handleUpdate('conn-1', request, handlerContext);

      // conn-2 should receive presence.changed event
      expect(mockSend).toHaveBeenCalled();
      const sentMessage = JSON.parse(mockSend.mock.calls[0]?.[0] ?? '{}');
      expect(sentMessage.type).toBe('presence.changed');
    });

    it('should not broadcast to sender', async () => {
      const mockSend = vi.fn();
      (mockConnectionManager.getConnection as any).mockReturnValue({
        id: 'conn-1',
        socket: { readyState: 1, send: mockSend },
        authenticated: true,
        capabilities: ['presence.read', 'presence.write'],
        clientId: 'client-abc',
      });

      // Subscribe conn-1 to presence events
      presenceManager.subscribe('conn-1');

      // Update presence from conn-1
      const request = createWSMessage('presence.update', {
        status: 'online',
      }) as any;

      await handler.handleUpdate('conn-1', request, handlerContext);

      // conn-1 should NOT receive its own presence.changed event
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Handler Registration Tests
// ============================================================================

describe('registerPresenceHandlers', () => {
  it('should register all presence handlers', () => {
    const mockRouter = {
      registerHandler: vi.fn(),
    };

    const mockHandler = {
      handleUpdate: vi.fn(),
      handleGet: vi.fn(),
      handleGetAll: vi.fn(),
      handleSubscribe: vi.fn(),
      handleUnsubscribe: vi.fn(),
    } as unknown as PresenceHandler;

    registerPresenceHandlers(mockRouter as any, mockHandler);

    expect(mockRouter.registerHandler).toHaveBeenCalledTimes(5);
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('presence.update', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('presence.get', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('presence.getAll', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('presence.subscribe', expect.any(Function));
    expect(mockRouter.registerHandler).toHaveBeenCalledWith('presence.unsubscribe', expect.any(Function));
  });
});
