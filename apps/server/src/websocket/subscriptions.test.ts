import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SubscriptionManager,
  createSubscriptionManager,
  type Subscription,
} from './subscriptions';
import type { ConnectionManager } from './connection-manager';
import { createWSMessage } from '@openaidy/shared-types';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mockLogger,
};

// Mock ConnectionManager
const createMockConnectionManager = () => ({
  send: vi.fn().mockReturnValue(true),
  registerConnection: vi.fn(),
  removeConnection: vi.fn(),
  getConnection: vi.fn(),
  getAllConnections: vi.fn().mockReturnValue([]),
  getConnectionCount: vi.fn().mockReturnValue(0),
  hasConnection: vi.fn().mockReturnValue(true),
  authenticate: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(true),
  getCapabilities: vi.fn().mockReturnValue([]),
  hasCapability: vi.fn().mockReturnValue(true),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  unsubscribeAll: vi.fn(),
  getSubscribers: vi.fn().mockReturnValue([]),
  getSubscriptions: vi.fn().mockReturnValue([]),
  updateHeartbeat: vi.fn(),
  checkStaleConnections: vi.fn().mockReturnValue([]),
  getLastHeartbeat: vi.fn(),
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, info: { remaining: 10, reset: Date.now(), limit: 100 } }),
  recordRequest: vi.fn(),
  resetRateLimit: vi.fn(),
  broadcast: vi.fn().mockReturnValue(0),
  closeAll: vi.fn(),
});

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;
  let mockConnectionManager: ReturnType<typeof createMockConnectionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = createMockConnectionManager();
    manager = new SubscriptionManager(
      mockConnectionManager as unknown as ConnectionManager,
      mockLogger as any,
    );
  });

  describe('createSubscription', () => {
    it('should create a subscription', () => {
      const subId = manager.createSubscription('conn-1', 'session-1');

      expect(subId).not.toBeNull();
      expect(manager.getSubscriptionCount()).toBe(1);

      const sub = manager.getSubscription(subId!);
      expect(sub?.connectionId).toBe('conn-1');
      expect(sub?.sessionId).toBe('session-1');
      expect(sub?.eventTypes).toEqual([]);
    });

    it('should create subscription with event types', () => {
      const subId = manager.createSubscription('conn-1', 'session-1', ['message', 'status']);

      const sub = manager.getSubscription(subId!);
      expect(sub?.eventTypes).toEqual(['message', 'status']);
    });

    it('should return existing subscription if duplicate', () => {
      const subId1 = manager.createSubscription('conn-1', 'session-1');
      const subId2 = manager.createSubscription('conn-1', 'session-1');

      expect(subId1).toBe(subId2);
      expect(manager.getSubscriptionCount()).toBe(1);
    });

    it('should allow different connections to subscribe to same session', () => {
      const subId1 = manager.createSubscription('conn-1', 'session-1');
      const subId2 = manager.createSubscription('conn-2', 'session-1');

      expect(subId1).not.toBe(subId2);
      expect(manager.getSubscriptionCount()).toBe(2);
      expect(manager.getSessionSubscriptionCount('session-1')).toBe(2);
    });

    it('should allow same connection to subscribe to different sessions', () => {
      const subId1 = manager.createSubscription('conn-1', 'session-1');
      const subId2 = manager.createSubscription('conn-1', 'session-2');

      expect(subId1).not.toBe(subId2);
      expect(manager.getSubscriptionCount()).toBe(2);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(2);
    });

    it('should enforce max subscriptions per connection', () => {
      const limitedManager = new SubscriptionManager(
        mockConnectionManager as unknown as ConnectionManager,
        mockLogger as any,
        { maxSubscriptionsPerConnection: 2 },
      );

      limitedManager.createSubscription('conn-1', 'session-1');
      limitedManager.createSubscription('conn-1', 'session-2');
      const subId3 = limitedManager.createSubscription('conn-1', 'session-3');

      expect(subId3).toBeNull();
      expect(limitedManager.getSubscriptionCount()).toBe(2);
    });

    it('should enforce max subscriptions per session', () => {
      const limitedManager = new SubscriptionManager(
        mockConnectionManager as unknown as ConnectionManager,
        mockLogger as any,
        { maxSubscriptionsPerSession: 2 },
      );

      limitedManager.createSubscription('conn-1', 'session-1');
      limitedManager.createSubscription('conn-2', 'session-1');
      const subId3 = limitedManager.createSubscription('conn-3', 'session-1');

      expect(subId3).toBeNull();
      expect(limitedManager.getSessionSubscriptionCount('session-1')).toBe(2);
    });
  });

  describe('removeSubscription', () => {
    it('should remove a subscription', () => {
      const subId = manager.createSubscription('conn-1', 'session-1');

      const result = manager.removeSubscription(subId!);

      expect(result).toBe(true);
      expect(manager.getSubscription(subId!)).toBeUndefined();
      expect(manager.getSubscriptionCount()).toBe(0);
    });

    it('should return false for non-existent subscription', () => {
      const result = manager.removeSubscription('nonexistent');

      expect(result).toBe(false);
    });

    it('should clean up indexes', () => {
      const subId = manager.createSubscription('conn-1', 'session-1');
      manager.removeSubscription(subId!);

      expect(manager.getSessionSubscriptionCount('session-1')).toBe(0);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(0);
    });
  });

  describe('removeConnectionSubscriptions', () => {
    it('should remove all subscriptions for a connection', () => {
      manager.createSubscription('conn-1', 'session-1');
      manager.createSubscription('conn-1', 'session-2');
      manager.createSubscription('conn-2', 'session-1');

      const count = manager.removeConnectionSubscriptions('conn-1');

      expect(count).toBe(2);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(0);
      expect(manager.getSessionSubscriptionCount('session-1')).toBe(1);
      expect(manager.getSessionSubscriptionCount('session-2')).toBe(0);
    });

    it('should return 0 for connection with no subscriptions', () => {
      const count = manager.removeConnectionSubscriptions('nonexistent');

      expect(count).toBe(0);
    });
  });

  describe('removeSessionSubscriptions', () => {
    it('should remove all subscriptions for a session', () => {
      manager.createSubscription('conn-1', 'session-1');
      manager.createSubscription('conn-2', 'session-1');
      manager.createSubscription('conn-1', 'session-2');

      const count = manager.removeSessionSubscriptions('session-1');

      expect(count).toBe(2);
      expect(manager.getSessionSubscriptionCount('session-1')).toBe(0);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(1);
      expect(manager.getConnectionSubscriptionCount('conn-2')).toBe(0);
    });
  });

  describe('getSubscription', () => {
    it('should return subscription by ID', () => {
      const subId = manager.createSubscription('conn-1', 'session-1');

      const sub = manager.getSubscription(subId!);

      expect(sub).toBeDefined();
      expect(sub?.id).toBe(subId);
    });

    it('should return undefined for non-existent ID', () => {
      const sub = manager.getSubscription('nonexistent');

      expect(sub).toBeUndefined();
    });
  });

  describe('getConnectionSubscriptions', () => {
    it('should return all subscriptions for a connection', () => {
      manager.createSubscription('conn-1', 'session-1');
      manager.createSubscription('conn-1', 'session-2');
      manager.createSubscription('conn-2', 'session-1');

      const subs = manager.getConnectionSubscriptions('conn-1');

      expect(subs.length).toBe(2);
      expect(subs.map((s) => s.sessionId)).toContain('session-1');
      expect(subs.map((s) => s.sessionId)).toContain('session-2');
    });

    it('should return empty array for connection with no subscriptions', () => {
      const subs = manager.getConnectionSubscriptions('nonexistent');

      expect(subs).toEqual([]);
    });
  });

  describe('getSessionSubscriptions', () => {
    it('should return all subscriptions for a session', () => {
      manager.createSubscription('conn-1', 'session-1');
      manager.createSubscription('conn-2', 'session-1');
      manager.createSubscription('conn-1', 'session-2');

      const subs = manager.getSessionSubscriptions('session-1');

      expect(subs.length).toBe(2);
      expect(subs.map((s) => s.connectionId)).toContain('conn-1');
      expect(subs.map((s) => s.connectionId)).toContain('conn-2');
    });
  });

  describe('findSubscription', () => {
    it('should find existing subscription', () => {
      const subId = manager.createSubscription('conn-1', 'session-1');

      const sub = manager.findSubscription('conn-1', 'session-1');

      expect(sub).toBeDefined();
      expect(sub?.id).toBe(subId);
    });

    it('should return undefined if not found', () => {
      manager.createSubscription('conn-1', 'session-1');

      const sub = manager.findSubscription('conn-1', 'session-2');

      expect(sub).toBeUndefined();
    });
  });

  describe('broadcastToSession', () => {
    it('should broadcast event to all session subscribers', () => {
      manager.createSubscription('conn-1', 'session-1');
      manager.createSubscription('conn-2', 'session-1');
      manager.createSubscription('conn-1', 'session-2');

      const event = createWSMessage('test.event', { data: 'test' });
      const sent = manager.broadcastToSession('session-1', event);

      expect(sent).toBe(2);
      expect(mockConnectionManager.send).toHaveBeenCalledTimes(2);
    });

    it('should filter by event type', () => {
      manager.createSubscription('conn-1', 'session-1', ['message']);
      manager.createSubscription('conn-2', 'session-1', ['status']);

      const messageEvent = createWSMessage('message', { data: 'test' });
      const sent = manager.broadcastToSession('session-1', messageEvent, 'message');

      // Only conn-1 should receive it
      expect(sent).toBe(1);
      expect(mockConnectionManager.send).toHaveBeenCalledWith('conn-1', messageEvent);
    });

    it('should send to all subscribers if no event type filter', () => {
      manager.createSubscription('conn-1', 'session-1', ['message']);
      manager.createSubscription('conn-2', 'session-1', []);

      const messageEvent = createWSMessage('message', { data: 'test' });
      const sent = manager.broadcastToSession('session-1', messageEvent);

      // Both should receive it (no event type filter passed)
      expect(sent).toBe(2);
    });

    it('should handle failed sends', () => {
      mockConnectionManager.send.mockReturnValueOnce(false).mockReturnValue(true);

      manager.createSubscription('conn-1', 'session-1');
      manager.createSubscription('conn-2', 'session-1');

      const event = createWSMessage('test.event', { data: 'test' });
      const sent = manager.broadcastToSession('session-1', event);

      // One failed, one succeeded
      expect(sent).toBe(1);
    });
  });

  describe('broadcastToAll', () => {
    it('should broadcast to all connections via connection manager', () => {
      const event = createWSMessage('test.event', { data: 'test' });
      mockConnectionManager.broadcast.mockReturnValue(10);

      const sent = manager.broadcastToAll(event);

      expect(mockConnectionManager.broadcast).toHaveBeenCalledWith(event);
      expect(sent).toBe(10);
    });
  });

  describe('cleanup', () => {
    it('should clear all subscriptions', () => {
      manager.createSubscription('conn-1', 'session-1');
      manager.createSubscription('conn-2', 'session-1');
      manager.createSubscription('conn-1', 'session-2');

      manager.cleanup();

      expect(manager.getSubscriptionCount()).toBe(0);
      expect(manager.getSessionSubscriptionCount('session-1')).toBe(0);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(0);
    });
  });

  describe('count methods', () => {
    it('should track counts correctly', () => {
      expect(manager.getSubscriptionCount()).toBe(0);

      manager.createSubscription('conn-1', 'session-1');
      expect(manager.getSubscriptionCount()).toBe(1);
      expect(manager.getSessionSubscriptionCount('session-1')).toBe(1);
      expect(manager.getConnectionSubscriptionCount('conn-1')).toBe(1);

      manager.createSubscription('conn-2', 'session-1');
      expect(manager.getSubscriptionCount()).toBe(2);
      expect(manager.getSessionSubscriptionCount('session-1')).toBe(2);
      expect(manager.getConnectionSubscriptionCount('conn-2')).toBe(1);
    });
  });
});

describe('createSubscriptionManager', () => {
  it('should create a SubscriptionManager instance', () => {
    const mockConnectionManager = createMockConnectionManager();
    const manager = createSubscriptionManager(
      mockConnectionManager as unknown as ConnectionManager,
      mockLogger as any,
    );

    expect(manager).toBeInstanceOf(SubscriptionManager);
  });

  it('should pass options to manager', () => {
    const mockConnectionManager = createMockConnectionManager();
    const manager = createSubscriptionManager(
      mockConnectionManager as unknown as ConnectionManager,
      mockLogger as any,
      { maxSubscriptionsPerConnection: 5 },
    );

    // Create 6 subscriptions, only 5 should succeed
    for (let i = 0; i < 6; i++) {
      manager.createSubscription('conn-1', `session-${i}`);
    }

    expect(manager.getSubscriptionCount()).toBe(5);
  });
});
