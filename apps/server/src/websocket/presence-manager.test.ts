/**
 * Presence Manager Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  PresenceManager,
  type PresenceInfo,
  type PresenceStatus,
} from './presence-manager';

// ============================================================================
// Mock Logger
// ============================================================================

const createMockLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as FastifyBaseLogger);

// ============================================================================
// Tests
// ============================================================================

describe('PresenceManager', () => {
  let manager: PresenceManager;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    manager = new PresenceManager({}, mockLogger);
  });

  // ============================================================================
  // Presence Update Tests
  // ============================================================================

  describe('updatePresence', () => {
    it('should create presence for new connection', () => {
      const info = manager.updatePresence('conn-1', 'online');

      expect(info.connectionId).toBe('conn-1');
      expect(info.status).toBe('online');
      expect(info.lastSeen).toBeGreaterThan(0);
      expect(manager.size).toBe(1);
    });

    it('should update presence for existing connection', () => {
      manager.updatePresence('conn-1', 'online');
      const info = manager.updatePresence('conn-1', 'away');

      expect(info.status).toBe('away');
      expect(manager.size).toBe(1);
    });

    it('should store clientId', () => {
      const info = manager.updatePresence('conn-1', 'online', {
        clientId: 'client-abc',
      });

      expect(info.clientId).toBe('client-abc');
    });

    it('should store metadata', () => {
      const info = manager.updatePresence('conn-1', 'online', {
        metadata: { device: 'iPhone', location: 'US' },
      });

      expect(info.metadata).toEqual({ device: 'iPhone', location: 'US' });
    });

    it('should preserve clientId on status update', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-abc' });
      const info = manager.updatePresence('conn-1', 'away');

      expect(info.clientId).toBe('client-abc');
    });

    it('should update clientId if changed', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-abc' });
      const info = manager.updatePresence('conn-1', 'online', { clientId: 'client-xyz' });

      expect(info.clientId).toBe('client-xyz');
    });
  });

  // ============================================================================
  // Presence Query Tests
  // ============================================================================

  describe('getPresence', () => {
    it('should return presence for existing connection', () => {
      manager.updatePresence('conn-1', 'online');
      const info = manager.getPresence('conn-1');

      expect(info).toBeDefined();
      expect(info?.status).toBe('online');
    });

    it('should return undefined for non-existent connection', () => {
      const info = manager.getPresence('conn-999');

      expect(info).toBeUndefined();
    });
  });

  describe('getClientPresence', () => {
    it('should return all presence for a client', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-abc' });
      manager.updatePresence('conn-2', 'away', { clientId: 'client-abc' });

      const presence = manager.getClientPresence('client-abc');

      expect(presence).toHaveLength(2);
    });

    it('should return empty array for unknown client', () => {
      const presence = manager.getClientPresence('unknown');

      expect(presence).toEqual([]);
    });
  });

  describe('getAllPresence', () => {
    it('should return all presence entries', () => {
      manager.updatePresence('conn-1', 'online');
      manager.updatePresence('conn-2', 'away');
      manager.updatePresence('conn-3', 'busy');

      const presence = manager.getAllPresence();

      expect(presence).toHaveLength(3);
    });

    it('should return empty array when no presence', () => {
      const presence = manager.getAllPresence();

      expect(presence).toEqual([]);
    });
  });

  describe('getPresenceByStatus', () => {
    beforeEach(() => {
      manager.updatePresence('conn-1', 'online');
      manager.updatePresence('conn-2', 'online');
      manager.updatePresence('conn-3', 'away');
      manager.updatePresence('conn-4', 'busy');
      manager.updatePresence('conn-5', 'offline');
    });

    it('should return online presence entries', () => {
      const online = manager.getPresenceByStatus('online');
      expect(online).toHaveLength(2);
    });

    it('should return away presence entries', () => {
      const away = manager.getPresenceByStatus('away');
      expect(away).toHaveLength(1);
    });

    it('should return busy presence entries', () => {
      const busy = manager.getPresenceByStatus('busy');
      expect(busy).toHaveLength(1);
    });

    it('should return offline presence entries', () => {
      const offline = manager.getPresenceByStatus('offline');
      expect(offline).toHaveLength(1);
    });
  });

  // ============================================================================
  // Subscription Tests
  // ============================================================================

  describe('subscribe', () => {
    it('should add subscriber', () => {
      manager.subscribe('conn-1');

      expect(manager.isSubscribed('conn-1')).toBe(true);
    });

    it('should track multiple subscribers', () => {
      manager.subscribe('conn-1');
      manager.subscribe('conn-2');
      manager.subscribe('conn-3');

      expect(manager.subscriberCount).toBe(3);
    });

    it('should not add duplicate subscriber', () => {
      manager.subscribe('conn-1');
      manager.subscribe('conn-1');

      expect(manager.subscriberCount).toBe(1);
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscriber', () => {
      manager.subscribe('conn-1');
      manager.unsubscribe('conn-1');

      expect(manager.isSubscribed('conn-1')).toBe(false);
    });

    it('should handle unsubscribing non-existent subscriber', () => {
      manager.unsubscribe('conn-999');
      expect(manager.subscriberCount).toBe(0);
    });
  });

  describe('getSubscribers', () => {
    it('should return all subscriber connection IDs', () => {
      manager.subscribe('conn-1');
      manager.subscribe('conn-2');

      const subscribers = manager.getSubscribers();

      expect(subscribers).toContain('conn-1');
      expect(subscribers).toContain('conn-2');
    });
  });

  // ============================================================================
  // Query Methods Tests
  // ============================================================================

  describe('findOnlineClients', () => {
    it('should return unique online client IDs', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-a' });
      manager.updatePresence('conn-2', 'online', { clientId: 'client-b' });
      manager.updatePresence('conn-3', 'away', { clientId: 'client-c' });

      const clients = manager.findOnlineClients();

      expect(clients).toContain('client-a');
      expect(clients).toContain('client-b');
      expect(clients).not.toContain('client-c');
    });

    it('should deduplicate client IDs', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-a' });
      manager.updatePresence('conn-2', 'online', { clientId: 'client-a' });

      const clients = manager.findOnlineClients();

      expect(clients).toEqual(['client-a']);
    });

    it('should return empty array when no online clients', () => {
      manager.updatePresence('conn-1', 'offline');

      const clients = manager.findOnlineClients();

      expect(clients).toEqual([]);
    });
  });

  describe('findClientsByStatus', () => {
    it('should return clients with specific status', () => {
      manager.updatePresence('conn-1', 'away', { clientId: 'client-a' });
      manager.updatePresence('conn-2', 'away', { clientId: 'client-b' });
      manager.updatePresence('conn-3', 'online', { clientId: 'client-c' });

      const clients = manager.findClientsByStatus('away');

      expect(clients).toContain('client-a');
      expect(clients).toContain('client-b');
      expect(clients).not.toContain('client-c');
    });
  });

  describe('findConnectionsByClient', () => {
    it('should return all connections for a client', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-a' });
      manager.updatePresence('conn-2', 'away', { clientId: 'client-a' });

      const connections = manager.findConnectionsByClient('client-a');

      expect(connections).toContain('conn-1');
      expect(connections).toContain('conn-2');
    });

    it('should return empty array for unknown client', () => {
      const connections = manager.findConnectionsByClient('unknown');

      expect(connections).toEqual([]);
    });
  });

  // ============================================================================
  // Cleanup Tests
  // ============================================================================

  describe('removeConnection', () => {
    it('should remove presence for connection', () => {
      manager.updatePresence('conn-1', 'online');
      manager.removeConnection('conn-1');

      expect(manager.getPresence('conn-1')).toBeUndefined();
    });

    it('should remove from client index', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-a' });
      manager.removeConnection('conn-1');

      const clientPresence = manager.getClientPresence('client-a');
      expect(clientPresence).toEqual([]);
    });

    it('should remove from status index', () => {
      manager.updatePresence('conn-1', 'online');
      manager.removeConnection('conn-1');

      const online = manager.getPresenceByStatus('online');
      expect(online).toEqual([]);
    });

    it('should remove from subscribers', () => {
      manager.subscribe('conn-1');
      manager.updatePresence('conn-1', 'online');
      manager.removeConnection('conn-1');

      expect(manager.isSubscribed('conn-1')).toBe(false);
    });

    it('should return true when removed', () => {
      manager.updatePresence('conn-1', 'online');
      const result = manager.removeConnection('conn-1');

      expect(result).toBe(true);
    });

    it('should return false when not found', () => {
      const result = manager.removeConnection('conn-999');

      expect(result).toBe(false);
    });
  });

  describe('cleanupStalePresence', () => {
    it('should mark stale entries as offline', async () => {
      manager.updatePresence('conn-1', 'online');

      // Wait a bit so conn-1 becomes stale
      await new Promise(resolve => setTimeout(resolve, 50));

      // conn-2 is created after the wait, so it's fresh
      manager.updatePresence('conn-2', 'online');

      // conn-1 is stale (timeout = 25ms), conn-2 is fresh
      const staleCount = manager.cleanupStalePresence(25);

      expect(staleCount).toBe(1);
      expect(manager.getPresence('conn-1')?.status).toBe('offline');
      expect(manager.getPresence('conn-2')?.status).toBe('online');
    });

    it('should return 0 when no stale entries', () => {
      manager.updatePresence('conn-1', 'online');

      const staleCount = manager.cleanupStalePresence(100000);

      expect(staleCount).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all presence data', () => {
      manager.updatePresence('conn-1', 'online');
      manager.updatePresence('conn-2', 'away');
      manager.subscribe('conn-3');

      manager.clear();

      expect(manager.size).toBe(0);
      expect(manager.subscriberCount).toBe(0);
    });
  });

  // ============================================================================
  // Count Properties Tests
  // ============================================================================

  describe('size', () => {
    it('should return number of tracked connections', () => {
      manager.updatePresence('conn-1', 'online');
      manager.updatePresence('conn-2', 'away');

      expect(manager.size).toBe(2);
    });
  });

  describe('clientCount', () => {
    it('should return number of unique clients', () => {
      manager.updatePresence('conn-1', 'online', { clientId: 'client-a' });
      manager.updatePresence('conn-2', 'away', { clientId: 'client-b' });
      manager.updatePresence('conn-3', 'online', { clientId: 'client-a' });

      expect(manager.clientCount).toBe(2);
    });
  });

  describe('subscriberCount', () => {
    it('should return number of subscribers', () => {
      manager.subscribe('conn-1');
      manager.subscribe('conn-2');

      expect(manager.subscriberCount).toBe(2);
    });
  });

  // ============================================================================
  // Status Index Tests
  // ============================================================================

  describe('status indexing', () => {
    it('should update status index on status change', () => {
      manager.updatePresence('conn-1', 'online');
      manager.updatePresence('conn-1', 'away');

      const online = manager.getPresenceByStatus('online');
      const away = manager.getPresenceByStatus('away');

      expect(online).toHaveLength(0);
      expect(away).toHaveLength(1);
    });

    it('should handle multiple status changes', () => {
      manager.updatePresence('conn-1', 'online');
      manager.updatePresence('conn-1', 'away');
      manager.updatePresence('conn-1', 'busy');
      manager.updatePresence('conn-1', 'offline');

      expect(manager.getPresenceByStatus('online')).toHaveLength(0);
      expect(manager.getPresenceByStatus('away')).toHaveLength(0);
      expect(manager.getPresenceByStatus('busy')).toHaveLength(0);
      expect(manager.getPresenceByStatus('offline')).toHaveLength(1);
    });
  });

  // ============================================================================
  // Initial Presence Tests
  // ============================================================================

  describe('initial presence', () => {
    it('should initialize with provided presence entries', () => {
      const initialPresence: PresenceInfo[] = [
        {
          connectionId: 'conn-1',
          status: 'online',
          clientId: 'client-a',
          lastSeen: Date.now(),
          updatedAt: Date.now(),
        },
        {
          connectionId: 'conn-2',
          status: 'away',
          clientId: 'client-b',
          lastSeen: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      const managerWithInit = new PresenceManager({ initialPresence }, mockLogger);

      expect(managerWithInit.size).toBe(2);
      expect(managerWithInit.getClientPresence('client-a')).toHaveLength(1);
    });
  });
});
