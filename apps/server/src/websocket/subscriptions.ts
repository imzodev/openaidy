/**
 * Subscription Manager
 *
 * Manages client subscriptions to sessions and events.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ConnectionManager } from './connection-manager';
import type { WSMessage } from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Subscription record
 */
export type Subscription = {
  /** Unique subscription ID */
  id: string;
  /** Connection that owns this subscription */
  connectionId: string;
  /** Session being subscribed to */
  sessionId: string;
  /** Event types to receive (empty = all events) */
  eventTypes: string[];
  /** Creation timestamp */
  createdAt: number;
};

/**
 * Filter for querying subscriptions
 */
export type SubscriptionFilter = {
  sessionId?: string;
  connectionId?: string;
  eventTypes?: string[];
};

/**
 * Subscription manager options
 */
export type SubscriptionManagerOptions = {
  /** Maximum subscriptions per connection */
  maxSubscriptionsPerConnection?: number;
  /** Maximum subscriptions per session */
  maxSubscriptionsPerSession?: number;
};

// ============================================================================
// Subscription Manager
// ============================================================================

/**
 * Manages subscriptions to sessions and events
 */
export class SubscriptionManager {
  private subscriptions: Map<string, Subscription> = new Map();
  // sessionId -> Set of subscription IDs
  private sessionSubscriptions: Map<string, Set<string>> = new Map();
  // connectionId -> Set of subscription IDs
  private connectionSubscriptions: Map<string, Set<string>> = new Map();

  constructor(
    private connectionManager: ConnectionManager,
    private logger: FastifyBaseLogger,
    private options: SubscriptionManagerOptions = {},
  ) {}

  // ============================================================================
  // Subscription Management
  // ============================================================================

  /**
   * Create a new subscription
   */
  createSubscription(
    connectionId: string,
    sessionId: string,
    eventTypes: string[] = [],
  ): string | null {
    // Check limits
    const maxPerConnection = this.options.maxSubscriptionsPerConnection ?? 50;
    const maxPerSession = this.options.maxSubscriptionsPerSession ?? 100;

    const connSubs = this.connectionSubscriptions.get(connectionId);
    if (connSubs && connSubs.size >= maxPerConnection) {
      this.logger.warn(
        { connectionId, count: connSubs.size, max: maxPerConnection },
        'Subscription limit reached for connection',
      );
      return null;
    }

    const sessSubs = this.sessionSubscriptions.get(sessionId);
    if (sessSubs && sessSubs.size >= maxPerSession) {
      this.logger.warn(
        { sessionId, count: sessSubs.size, max: maxPerSession },
        'Subscription limit reached for session',
      );
      return null;
    }

    // Check for duplicate subscription
    const existingSub = this.findSubscription(connectionId, sessionId);
    if (existingSub) {
      this.logger.debug(
        { connectionId, sessionId, subscriptionId: existingSub.id },
        'Subscription already exists, returning existing',
      );
      return existingSub.id;
    }

    // Create subscription
    const subscriptionId = this.generateSubscriptionId();
    const subscription: Subscription = {
      id: subscriptionId,
      connectionId,
      sessionId,
      eventTypes,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Index by session
    if (!this.sessionSubscriptions.has(sessionId)) {
      this.sessionSubscriptions.set(sessionId, new Set());
    }
    this.sessionSubscriptions.get(sessionId)!.add(subscriptionId);

    // Index by connection
    if (!this.connectionSubscriptions.has(connectionId)) {
      this.connectionSubscriptions.set(connectionId, new Set());
    }
    this.connectionSubscriptions.get(connectionId)!.add(subscriptionId);

    this.logger.info(
      { subscriptionId, connectionId, sessionId, eventTypes },
      'Subscription created',
    );

    return subscriptionId;
  }

  /**
   * Remove a subscription by ID
   */
  removeSubscription(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    // Remove from main map
    this.subscriptions.delete(subscriptionId);

    // Remove from session index
    const sessSubs = this.sessionSubscriptions.get(subscription.sessionId);
    if (sessSubs) {
      sessSubs.delete(subscriptionId);
      if (sessSubs.size === 0) {
        this.sessionSubscriptions.delete(subscription.sessionId);
      }
    }

    // Remove from connection index
    const connSubs = this.connectionSubscriptions.get(
      subscription.connectionId,
    );
    if (connSubs) {
      connSubs.delete(subscriptionId);
      if (connSubs.size === 0) {
        this.connectionSubscriptions.delete(subscription.connectionId);
      }
    }

    this.logger.info(
      {
        subscriptionId,
        connectionId: subscription.connectionId,
        sessionId: subscription.sessionId,
      },
      'Subscription removed',
    );

    return true;
  }

  /**
   * Remove all subscriptions for a connection
   */
  removeConnectionSubscriptions(connectionId: string): number {
    const subIds = this.connectionSubscriptions.get(connectionId);
    if (!subIds) return 0;

    const count = subIds.size;
    for (const subId of subIds) {
      const sub = this.subscriptions.get(subId);
      if (sub) {
        this.subscriptions.delete(subId);

        // Remove from session index
        const sessSubs = this.sessionSubscriptions.get(sub.sessionId);
        if (sessSubs) {
          sessSubs.delete(subId);
          if (sessSubs.size === 0) {
            this.sessionSubscriptions.delete(sub.sessionId);
          }
        }
      }
    }

    this.connectionSubscriptions.delete(connectionId);

    this.logger.info(
      { connectionId, count },
      'Removed all connection subscriptions',
    );

    return count;
  }

  /**
   * Remove all subscriptions for a session
   */
  removeSessionSubscriptions(sessionId: string): number {
    const subIds = this.sessionSubscriptions.get(sessionId);
    if (!subIds) return 0;

    const count = subIds.size;
    for (const subId of subIds) {
      const sub = this.subscriptions.get(subId);
      if (sub) {
        this.subscriptions.delete(subId);

        // Remove from connection index
        const connSubs = this.connectionSubscriptions.get(sub.connectionId);
        if (connSubs) {
          connSubs.delete(subId);
          if (connSubs.size === 0) {
            this.connectionSubscriptions.delete(sub.connectionId);
          }
        }
      }
    }

    this.sessionSubscriptions.delete(sessionId);

    this.logger.info({ sessionId, count }, 'Removed all session subscriptions');

    return count;
  }

  // ============================================================================
  // Query
  // ============================================================================

  /**
   * Get a subscription by ID
   */
  getSubscription(subscriptionId: string): Subscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  /**
   * Get all subscriptions for a connection
   */
  getConnectionSubscriptions(connectionId: string): Subscription[] {
    const subIds = this.connectionSubscriptions.get(connectionId);
    if (!subIds) return [];

    return Array.from(subIds)
      .map((id) => this.subscriptions.get(id))
      .filter((sub): sub is Subscription => sub !== undefined);
  }

  /**
   * Get all subscriptions for a session
   */
  getSessionSubscriptions(sessionId: string): Subscription[] {
    const subIds = this.sessionSubscriptions.get(sessionId);
    if (!subIds) return [];

    return Array.from(subIds)
      .map((id) => this.subscriptions.get(id))
      .filter((sub): sub is Subscription => sub !== undefined);
  }

  /**
   * Find an existing subscription by connection and session
   */
  findSubscription(
    connectionId: string,
    sessionId: string,
  ): Subscription | undefined {
    const connSubs = this.connectionSubscriptions.get(connectionId);
    if (!connSubs) return undefined;

    for (const subId of connSubs) {
      const sub = this.subscriptions.get(subId);
      if (sub && sub.sessionId === sessionId) {
        return sub;
      }
    }

    return undefined;
  }

  /**
   * Get total subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get count of subscriptions for a session
   */
  getSessionSubscriptionCount(sessionId: string): number {
    const subs = this.sessionSubscriptions.get(sessionId);
    return subs ? subs.size : 0;
  }

  /**
   * Get count of subscriptions for a connection
   */
  getConnectionSubscriptionCount(connectionId: string): number {
    const subs = this.connectionSubscriptions.get(connectionId);
    return subs ? subs.size : 0;
  }

  // ============================================================================
  // Reconnection Support
  // ============================================================================

  /**
   * Get all session IDs a connection is subscribed to
   * Used for reconnect-safe resubscription
   */
  getConnectionSessionIds(connectionId: string): string[] {
    const subs = this.getConnectionSubscriptions(connectionId);
    return [...new Set(subs.map((sub) => sub.sessionId))];
  }

  /**
   * Export all subscriptions for a connection (for cache sync)
   * Returns serialized subscription data that can be used to restore subscriptions
   */
  exportConnectionSubscriptions(connectionId: string): {
    sessionId: string;
    eventTypes: string[];
  }[] {
    const subs = this.getConnectionSubscriptions(connectionId);
    return subs.map((sub) => ({
      sessionId: sub.sessionId,
      eventTypes: sub.eventTypes,
    }));
  }

  /**
   * Import subscriptions for a connection (for cache sync after reconnect)
   * Restores subscriptions from exported data
   */
  importConnectionSubscriptions(
    connectionId: string,
    subscriptions: { sessionId: string; eventTypes: string[] }[],
  ): number {
    let imported = 0;
    for (const sub of subscriptions) {
      // Check if subscription already exists
      const existing = this.findSubscription(connectionId, sub.sessionId);
      if (!existing) {
        this.createSubscription(connectionId, sub.sessionId, sub.eventTypes);
        imported++;
      }
    }
    return imported;
  }

  /**
   * Get all subscription data for a session (for cache sync)
   */
  exportSessionSubscriptions(sessionId: string): {
    connectionId: string;
    eventTypes: string[];
  }[] {
    const subs = this.getSessionSubscriptions(sessionId);
    return subs.map((sub) => ({
      connectionId: sub.connectionId,
      eventTypes: sub.eventTypes,
    }));
  }

  // ============================================================================
  // Broadcasting
  // ============================================================================

  /**
   * Broadcast an event to all subscribers of a session
   */
  broadcastToSession(
    sessionId: string,
    event: WSMessage,
    eventType?: string,
  ): number {
    const subs = this.getSessionSubscriptions(sessionId);
    let sent = 0;

    for (const sub of subs) {
      // Check event type filter
      if (
        eventType &&
        sub.eventTypes.length > 0 &&
        !sub.eventTypes.includes(eventType)
      ) {
        continue;
      }

      const success = this.connectionManager.send(sub.connectionId, event);
      if (success) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Broadcast an event to all connections
   */
  broadcastToAll(event: WSMessage): number {
    return this.connectionManager.broadcast(event);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Clear all subscriptions
   */
  cleanup(): void {
    this.subscriptions.clear();
    this.sessionSubscriptions.clear();
    this.connectionSubscriptions.clear();

    this.logger.info('All subscriptions cleared');
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Generate a unique subscription ID
   */
  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a SubscriptionManager instance
 */
export function createSubscriptionManager(
  connectionManager: ConnectionManager,
  logger: FastifyBaseLogger,
  options?: SubscriptionManagerOptions,
): SubscriptionManager {
  return new SubscriptionManager(connectionManager, logger, options);
}

export default SubscriptionManager;
