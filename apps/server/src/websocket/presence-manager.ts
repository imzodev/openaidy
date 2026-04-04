/**
 * Presence Manager
 *
 * Tracks client presence status and manages presence subscriptions.
 */

import type { FastifyBaseLogger } from 'fastify';

// ============================================================================
// Types
// ============================================================================

/**
 * Presence status values
 */
export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

/**
 * Presence information for a connection
 */
export type PresenceInfo = {
  connectionId: string;
  clientId?: string;
  status: PresenceStatus;
  metadata?: Record<string, unknown>;
  lastSeen: number;
  updatedAt: number;
};

/**
 * Presence manager options
 */
export type PresenceManagerOptions = {
  /** Initial presence entries */
  initialPresence?: PresenceInfo[];
};

// ============================================================================
// Presence Manager
// ============================================================================

/**
 * Presence manager service
 *
 * Tracks client presence status with efficient indexing for queries.
 */
export class PresenceManager {
  private readonly presence: Map<string, PresenceInfo> = new Map();
  private readonly clientIndex: Map<string, Set<string>> = new Map();
  private readonly statusIndex: Map<PresenceStatus, Set<string>> = new Map();
  private readonly subscribers: Set<string> = new Set();
  private readonly logger: FastifyBaseLogger;

  constructor(options: PresenceManagerOptions = {}, logger: FastifyBaseLogger) {
    this.logger = logger;

    // Initialize status index sets
    const statuses: PresenceStatus[] = ['online', 'away', 'busy', 'offline'];
    for (const status of statuses) {
      this.statusIndex.set(status, new Set());
    }

    if (options.initialPresence) {
      for (const info of options.initialPresence) {
        this.updatePresence(info.connectionId, info.status, {
          clientId: info.clientId,
          metadata: info.metadata,
        });
      }
    }
  }

  // ============================================================================
  // Presence Management
  // ============================================================================

  /**
   * Update presence for a connection
   */
  updatePresence(
    connectionId: string,
    status: PresenceStatus,
    options?: {
      clientId?: string;
      metadata?: Record<string, unknown>;
    },
  ): PresenceInfo {
    const now = Date.now();
    const existing = this.presence.get(connectionId);
    const oldStatus = existing?.status;
    const oldClientId = existing?.clientId;

    // Create or update presence entry
    const info: PresenceInfo = {
      connectionId,
      clientId: options?.clientId ?? existing?.clientId,
      status,
      metadata: options?.metadata ?? existing?.metadata,
      lastSeen: now,
      updatedAt: now,
    };

    // Store presence
    this.presence.set(connectionId, info);

    // Update status index
    this.updateStatusIndex(connectionId, oldStatus, status);

    // Update client index if clientId changed
    if (info.clientId) {
      // Remove from old client index if changed
      if (oldClientId && oldClientId !== info.clientId) {
        const oldSet = this.clientIndex.get(oldClientId);
        if (oldSet) {
          oldSet.delete(connectionId);
        }
      }
      // Add to new client index
      if (!this.clientIndex.has(info.clientId)) {
        this.clientIndex.set(info.clientId, new Set());
      }
      this.clientIndex.get(info.clientId)!.add(connectionId);
    }

    this.logger.debug(
      { connectionId, status, clientId: info.clientId },
      'Presence updated',
    );

    return info;
  }

  /**
   * Get presence for a connection
   */
  getPresence(connectionId: string): PresenceInfo | undefined {
    return this.presence.get(connectionId);
  }

  /**
   * Get all presence entries for a client (may have multiple connections)
   */
  getClientPresence(clientId: string): PresenceInfo[] {
    const connectionIds = this.clientIndex.get(clientId);
    if (!connectionIds) {
      return [];
    }
    return Array.from(connectionIds)
      .map(id => this.presence.get(id))
      .filter((info): info is PresenceInfo => info !== undefined);
  }

  /**
   * Get all presence entries
   */
  getAllPresence(): PresenceInfo[] {
    return Array.from(this.presence.values());
  }

  /**
   * Get presence entries by status
   */
  getPresenceByStatus(status: PresenceStatus): PresenceInfo[] {
    const connectionIds = this.statusIndex.get(status);
    if (!connectionIds) {
      return [];
    }
    return Array.from(connectionIds)
      .map(id => this.presence.get(id))
      .filter((info): info is PresenceInfo => info !== undefined);
  }

  // ============================================================================
  // Subscription Management
  // ============================================================================

  /**
   * Subscribe a connection to presence events
   */
  subscribe(connectionId: string): void {
    this.subscribers.add(connectionId);
    this.logger.debug({ connectionId }, 'Subscribed to presence events');
  }

  /**
   * Unsubscribe a connection from presence events
   */
  unsubscribe(connectionId: string): void {
    this.subscribers.delete(connectionId);
    this.logger.debug({ connectionId }, 'Unsubscribed from presence events');
  }

  /**
   * Check if a connection is subscribed to presence events
   */
  isSubscribed(connectionId: string): boolean {
    return this.subscribers.has(connectionId);
  }

  /**
   * Get all subscriber connection IDs
   */
  getSubscribers(): string[] {
    return Array.from(this.subscribers);
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Find all online clients (unique client IDs)
   */
  findOnlineClients(): string[] {
    const onlineConnections = this.statusIndex.get('online');
    if (!onlineConnections) {
      return [];
    }

    const clientIds = new Set<string>();
    for (const connId of onlineConnections) {
      const info = this.presence.get(connId);
      if (info?.clientId) {
        clientIds.add(info.clientId);
      }
    }
    return Array.from(clientIds);
  }

  /**
   * Find all clients with a specific status
   */
  findClientsByStatus(status: PresenceStatus): string[] {
    const connections = this.statusIndex.get(status);
    if (!connections) {
      return [];
    }

    const clientIds = new Set<string>();
    for (const connId of connections) {
      const info = this.presence.get(connId);
      if (info?.clientId) {
        clientIds.add(info.clientId);
      }
    }
    return Array.from(clientIds);
  }

  /**
   * Find connections for a specific client
   */
  findConnectionsByClient(clientId: string): string[] {
    const connectionIds = this.clientIndex.get(clientId);
    return connectionIds ? Array.from(connectionIds) : [];
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Remove presence for a connection
   */
  removeConnection(connectionId: string): boolean {
    const info = this.presence.get(connectionId);
    if (!info) {
      return false;
    }

    // Remove from status index
    const statusSet = this.statusIndex.get(info.status);
    if (statusSet) {
      statusSet.delete(connectionId);
    }

    // Remove from client index
    if (info.clientId) {
      const clientSet = this.clientIndex.get(info.clientId);
      if (clientSet) {
        clientSet.delete(connectionId);
        if (clientSet.size === 0) {
          this.clientIndex.delete(info.clientId);
        }
      }
    }

    // Remove presence entry
    this.presence.delete(connectionId);

    // Remove from subscribers
    this.subscribers.delete(connectionId);

    this.logger.debug({ connectionId }, 'Presence removed');
    return true;
  }

  /**
   * Cleanup stale presence entries (not seen for timeoutMs)
   */
  cleanupStalePresence(timeoutMs: number): number {
    const now = Date.now();
    const staleConnectionIds: string[] = [];

    for (const [connectionId, info] of this.presence) {
      if (now - info.lastSeen > timeoutMs) {
        staleConnectionIds.push(connectionId);
      }
    }

    // Mark stale entries as offline
    for (const connectionId of staleConnectionIds) {
      this.updatePresence(connectionId, 'offline');
    }

    if (staleConnectionIds.length > 0) {
      this.logger.info(
        { count: staleConnectionIds.length },
        'Marked stale presence as offline',
      );
    }

    return staleConnectionIds.length;
  }

  /**
   * Clear all presence data
   */
  clear(): void {
    this.presence.clear();
    this.clientIndex.clear();
    this.subscribers.clear();

    // Re-initialize status index
    for (const set of this.statusIndex.values()) {
      set.clear();
    }

    this.logger.info('Presence manager cleared');
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Update status index
   */
  private updateStatusIndex(
    connectionId: string,
    oldStatus: PresenceStatus | undefined,
    newStatus: PresenceStatus,
  ): void {
    // Remove from old status set
    if (oldStatus) {
      const oldSet = this.statusIndex.get(oldStatus);
      if (oldSet) {
        oldSet.delete(connectionId);
      }
    }

    // Add to new status set
    const newSet = this.statusIndex.get(newStatus);
    if (newSet) {
      newSet.add(connectionId);
    }
  }

  /**
   * Get the number of tracked connections
   */
  get size(): number {
    return this.presence.size;
  }

  /**
   * Get the number of unique clients
   */
  get clientCount(): number {
    return this.clientIndex.size;
  }

  /**
   * Get the number of subscribers
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
