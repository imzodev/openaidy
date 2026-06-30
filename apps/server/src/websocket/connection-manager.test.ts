import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from '@fastify/websocket';
import { ConnectionManager, RateLimiter } from './connection-manager';
import { defaultWebSocketConfig } from './types';

/**
 * Minimal subset of the WebSocket surface the ConnectionManager uses.
 * Mock sockets implement this and are cast through `unknown` to `WebSocket`.
 */
interface MockSocket {
  send: (data?: string) => void;
  close: () => void;
  readyState: number;
}

/** Cast a mock socket to the WebSocket type expected by ConnectionManager. */
const asWebSocket = (socket: MockSocket): WebSocket =>
  socket as unknown as WebSocket;

// Mock WebSocket
const createMockSocket = (): MockSocket => ({
  send: (_data?: string) => {
    // no-op
  },
  close: () => {
    // no-op
  },
  readyState: 1, // OPEN
});

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(5, 60000); // 5 requests per minute
  });

  describe('check', () => {
    it('should allow requests under limit', () => {
      const result = limiter.check();
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(5);
      expect(result.info.limit).toBe(5);
    });

    it('should track remaining requests', () => {
      limiter.recordRequest();
      limiter.recordRequest();

      const result = limiter.check();
      expect(result.info.remaining).toBe(3);
    });

    it('should deny requests over limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest();
      }

      const result = limiter.check();
      expect(result.allowed).toBe(false);
      expect(result.info.remaining).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset the rate limiter', () => {
      for (let i = 0; i < 5; i++) {
        limiter.recordRequest();
      }

      limiter.reset();

      const result = limiter.check();
      expect(result.allowed).toBe(true);
      expect(result.info.remaining).toBe(5);
    });
  });

  describe('window expiration', () => {
    it('should reset when window expires', () => {
      // Use a very short window for testing
      const shortLimiter = new RateLimiter(2, 10); // 10ms window

      shortLimiter.recordRequest();
      shortLimiter.recordRequest();

      // At limit
      expect(shortLimiter.check().allowed).toBe(false);

      // Wait for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = shortLimiter.check();
          expect(result.allowed).toBe(true);
          resolve();
        }, 15);
      });
    });
  });
});

describe('ConnectionManager', () => {
  let manager: ConnectionManager;
  let mockSocket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    manager = new ConnectionManager(defaultWebSocketConfig);
    mockSocket = createMockSocket();
  });

  afterEach(() => {
    manager.closeAll();
  });

  // ============================================================================
  // Connection Lifecycle
  // ============================================================================

  describe('registerConnection', () => {
    it('should register a new connection', () => {
      const ctx = manager.registerConnection('conn-1', asWebSocket(mockSocket));

      expect(ctx.id).toBe('conn-1');
      expect(ctx.status).toBe('connected');
      expect(ctx.authenticated).toBe(false);
      expect(ctx.subscriptions.size).toBe(0);
      expect(ctx.createdAt).toBeDefined();
      expect(ctx.lastHeartbeat).toBeDefined();
    });

    it('should track connection count', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      expect(manager.getConnectionCount()).toBe(1);

      manager.registerConnection('conn-2', asWebSocket(mockSocket));
      expect(manager.getConnectionCount()).toBe(2);
    });

    it('should create rate limiter for connection', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));

      const result = manager.checkRateLimit('conn-1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('removeConnection', () => {
    it('should remove a connection', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.removeConnection('conn-1');

      expect(manager.getConnection('conn-1')).toBeUndefined();
      expect(manager.getConnectionCount()).toBe(0);
    });

    it('should clean up rate limiter', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.removeConnection('conn-1');

      const result = manager.checkRateLimit('conn-1');
      expect(result.allowed).toBe(false);
    });

    it('should clean up subscriptions', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.subscribe('conn-1', 'topic-1');
      manager.removeConnection('conn-1');

      const subscribers = manager.getSubscribers('topic-1');
      expect(subscribers.length).toBe(0);
    });
  });

  describe('getConnection', () => {
    it('should return connection context', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      const ctx = manager.getConnection('conn-1');

      expect(ctx).toBeDefined();
      expect(ctx?.id).toBe('conn-1');
    });

    it('should return undefined for unknown connection', () => {
      expect(manager.getConnection('unknown')).toBeUndefined();
    });
  });

  describe('getAllConnections', () => {
    it('should return all connections', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.registerConnection('conn-2', asWebSocket(mockSocket));

      const connections = manager.getAllConnections();
      expect(connections.length).toBe(2);
      expect(connections.map((c) => c.id)).toContain('conn-1');
      expect(connections.map((c) => c.id)).toContain('conn-2');
    });

    it('should return empty array when no connections', () => {
      expect(manager.getAllConnections()).toEqual([]);
    });
  });

  describe('hasConnection', () => {
    it('should return true for existing connection', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      expect(manager.hasConnection('conn-1')).toBe(true);
    });

    it('should return false for unknown connection', () => {
      expect(manager.hasConnection('unknown')).toBe(false);
    });
  });

  // ============================================================================
  // Authentication
  // ============================================================================

  describe('authenticate', () => {
    it('should mark connection as authenticated', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      const result = manager.authenticate('conn-1', 'client-123', [
        'read',
        'write',
      ]);

      expect(result).toBe(true);
      expect(manager.isAuthenticated('conn-1')).toBe(true);
    });

    it('should set client identity', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.authenticate('conn-1', 'client-123', ['read', 'write']);

      const ctx = manager.getConnection('conn-1');
      expect(ctx?.clientId).toBe('client-123');
      expect(ctx?.capabilities).toEqual(['read', 'write']);
    });

    it('should return false for unknown connection', () => {
      expect(manager.authenticate('unknown', 'client-123', [])).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('should return false for unauthenticated connection', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      expect(manager.isAuthenticated('conn-1')).toBe(false);
    });

    it('should return true after authentication', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.authenticate('conn-1', 'client-123', []);
      expect(manager.isAuthenticated('conn-1')).toBe(true);
    });
  });

  describe('getCapabilities', () => {
    it('should return capabilities for authenticated connection', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.authenticate('conn-1', 'client-123', ['read', 'write', 'admin']);

      expect(manager.getCapabilities('conn-1')).toEqual([
        'read',
        'write',
        'admin',
      ]);
    });

    it('should return empty array for unknown connection', () => {
      expect(manager.getCapabilities('unknown')).toEqual([]);
    });
  });

  describe('hasCapability', () => {
    it('should return true if connection has capability', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.authenticate('conn-1', 'client-123', ['read', 'write']);

      expect(manager.hasCapability('conn-1', 'read')).toBe(true);
      expect(manager.hasCapability('conn-1', 'write')).toBe(true);
    });

    it('should return false if connection lacks capability', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.authenticate('conn-1', 'client-123', ['read']);

      expect(manager.hasCapability('conn-1', 'admin')).toBe(false);
    });

    it('should return true for wildcard capability', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.authenticate('conn-1', 'client-123', ['*']);

      expect(manager.hasCapability('conn-1', 'any-capability')).toBe(true);
    });

    it('should return false for unknown connection', () => {
      expect(manager.hasCapability('unknown', 'read')).toBe(false);
    });
  });

  // ============================================================================
  // Subscriptions
  // ============================================================================

  describe('subscribe', () => {
    it('should subscribe connection to topic', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      const result = manager.subscribe('conn-1', 'session-123');

      expect(result).toBe(true);
      expect(manager.getSubscriptions('conn-1')).toContain('session-123');
    });

    it('should return false for unknown connection', () => {
      expect(manager.subscribe('unknown', 'topic')).toBe(false);
    });

    it('should allow multiple subscriptions', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.subscribe('conn-1', 'topic-1');
      manager.subscribe('conn-1', 'topic-2');
      manager.subscribe('conn-1', 'topic-3');

      const subs = manager.getSubscriptions('conn-1');
      expect(subs.length).toBe(3);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe connection from topic', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.subscribe('conn-1', 'topic-1');
      const result = manager.unsubscribe('conn-1', 'topic-1');

      expect(result).toBe(true);
      expect(manager.getSubscriptions('conn-1')).not.toContain('topic-1');
    });

    it('should return false for unknown connection', () => {
      expect(manager.unsubscribe('unknown', 'topic')).toBe(false);
    });
  });

  describe('unsubscribeAll', () => {
    it('should unsubscribe from all topics', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.subscribe('conn-1', 'topic-1');
      manager.subscribe('conn-1', 'topic-2');
      manager.subscribe('conn-1', 'topic-3');

      manager.unsubscribeAll('conn-1');

      expect(manager.getSubscriptions('conn-1').length).toBe(0);
    });
  });

  describe('getSubscribers', () => {
    it('should return subscribers for topic', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.registerConnection('conn-2', asWebSocket(mockSocket));
      manager.registerConnection('conn-3', asWebSocket(mockSocket));

      manager.subscribe('conn-1', 'topic-1');
      manager.subscribe('conn-2', 'topic-1');
      manager.subscribe('conn-3', 'topic-2');

      const subscribers = manager.getSubscribers('topic-1');
      expect(subscribers.length).toBe(2);
    });

    it('should return empty array for topic with no subscribers', () => {
      expect(manager.getSubscribers('no-such-topic')).toEqual([]);
    });
  });

  // ============================================================================
  // Messaging
  // ============================================================================

  describe('send', () => {
    it('should send message to connection', () => {
      const socket: MockSocket = createMockSocket();
      let sentData: string | undefined;
      socket.send = (data?: string) => {
        sentData = data;
      };

      manager.registerConnection('conn-1', asWebSocket(socket));
      const result = manager.send('conn-1', { type: 'test', data: 'hello' });

      expect(result).toBe(true);
      expect(sentData).toBeDefined();
      expect(JSON.parse(sentData!)).toEqual({ type: 'test', data: 'hello' });
    });

    it('should return false for unknown connection', () => {
      expect(manager.send('unknown', { type: 'test' })).toBe(false);
    });

    it('should handle string messages', () => {
      const socket: MockSocket = createMockSocket();
      let sentData: string | undefined;
      socket.send = (data?: string) => {
        sentData = data;
      };

      manager.registerConnection('conn-1', asWebSocket(socket));
      manager.send('conn-1', 'plain text');

      expect(sentData).toBe('plain text');
    });
  });

  describe('broadcast', () => {
    it('should send to all connections', () => {
      const received: string[] = [];

      for (let i = 1; i <= 3; i++) {
        const socket: MockSocket = {
          send: (data?: string) => received.push(data ?? ''),
          close: () => {},
          readyState: 1,
        };
        manager.registerConnection(`conn-${i}`, asWebSocket(socket));
      }

      const sent = manager.broadcast({ type: 'broadcast' });

      expect(sent).toBe(3);
      expect(received.length).toBe(3);
    });

    it('should exclude specified connections', () => {
      const received: string[] = [];

      for (let i = 1; i <= 3; i++) {
        const socket: MockSocket = {
          send: (_data?: string) => received.push(`conn-${i}`),
          close: () => {},
          readyState: 1,
        };
        manager.registerConnection(`conn-${i}`, asWebSocket(socket));
      }

      const sent = manager.broadcast({ type: 'broadcast' }, ['conn-1']);

      expect(sent).toBe(2);
    });
  });

  describe('sendToTopic', () => {
    it('should send to topic subscribers only', () => {
      const received: string[] = [];

      for (let i = 1; i <= 3; i++) {
        const socket: MockSocket = {
          send: (_data?: string) => received.push(`conn-${i}`),
          close: () => {},
          readyState: 1,
        };
        manager.registerConnection(`conn-${i}`, asWebSocket(socket));
      }

      manager.subscribe('conn-1', 'topic-1');
      manager.subscribe('conn-2', 'topic-1');
      // conn-3 not subscribed

      const sent = manager.sendToTopic('topic-1', { type: 'update' });

      expect(sent).toBe(2);
      expect(received).toContain('conn-1');
      expect(received).toContain('conn-2');
      expect(received).not.toContain('conn-3');
    });
  });

  // ============================================================================
  // Heartbeat
  // ============================================================================

  describe('updateHeartbeat', () => {
    it('should update heartbeat timestamp', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      const before = manager.getLastHeartbeat('conn-1')!;

      // Small delay
      const start = Date.now();
      while (Date.now() === start) {
        // Busy-wait until the clock advances at least 1ms
      }

      manager.updateHeartbeat('conn-1');
      const after = manager.getLastHeartbeat('conn-1');

      expect(after).toBeGreaterThan(before);
    });
  });

  describe('checkStaleConnections', () => {
    it('should identify stale connections', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.registerConnection('conn-2', asWebSocket(mockSocket));

      // Make conn-1 stale
      const ctx = manager.getConnection('conn-1')!;
      ctx.lastHeartbeat = Date.now() - 120000; // 2 minutes ago

      const stale = manager.checkStaleConnections(60000); // 1 minute timeout

      expect(stale.length).toBe(1);
      expect(stale[0]).toBe('conn-1');
    });

    it('should return empty array when no stale connections', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.registerConnection('conn-2', asWebSocket(mockSocket));

      const stale = manager.checkStaleConnections(60000);

      expect(stale.length).toBe(0);
    });
  });

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  describe('checkRateLimit', () => {
    it('should allow requests under limit', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));

      const result = manager.checkRateLimit('conn-1');
      expect(result.allowed).toBe(true);
    });

    it('should deny requests over limit', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));

      // Exhaust limit
      for (let i = 0; i < 100; i++) {
        manager.recordRequest('conn-1');
      }

      const result = manager.checkRateLimit('conn-1');
      expect(result.allowed).toBe(false);
    });

    it('should return false for unknown connection', () => {
      const result = manager.checkRateLimit('unknown');
      expect(result.allowed).toBe(false);
    });
  });

  describe('recordRequest', () => {
    it('should record request for rate limiting', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));

      manager.recordRequest('conn-1');
      manager.recordRequest('conn-1');

      const result = manager.checkRateLimit('conn-1');
      expect(result.info.remaining).toBeLessThan(100);
    });
  });

  describe('resetRateLimit', () => {
    it('should reset rate limiter', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));

      for (let i = 0; i < 50; i++) {
        manager.recordRequest('conn-1');
      }

      manager.resetRateLimit('conn-1');

      const result = manager.checkRateLimit('conn-1');
      expect(result.info.remaining).toBe(100);
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe('closeAll', () => {
    it('should close all connections', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.registerConnection('conn-2', asWebSocket(mockSocket));

      manager.closeAll();

      expect(manager.getConnectionCount()).toBe(0);
    });

    it('should clear topic index', () => {
      manager.registerConnection('conn-1', asWebSocket(mockSocket));
      manager.subscribe('conn-1', 'topic-1');

      manager.closeAll();

      const subscribers = manager.getSubscribers('topic-1');
      expect(subscribers.length).toBe(0);
    });
  });
});
