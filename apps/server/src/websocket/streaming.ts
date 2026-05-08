/**
 * Streaming Response Handler
 *
 * Maps RunEvents to WebSocket streaming events and manages subscriptions.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { RunEvent, RunEventEmitter } from '../dispatch/events';
import type { ConnectionManager } from './connection-manager';
import {
  type SessionStreamStart,
  type SessionStreamDelta,
  type SessionStreamToolCall,
  type SessionStreamUsage,
  type SessionStreamEnd,
  type SessionStreamError,
  type SessionRunChoicesEvent,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * All session stream event types
 */
export type SessionStreamEvent =
  | SessionStreamStart
  | SessionStreamDelta
  | SessionStreamToolCall
  | SessionStreamUsage
  | SessionStreamEnd
  | SessionStreamError
  | SessionRunChoicesEvent;

/**
 * Tool call structure
 */
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/**
 * Usage structure
 */
export type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

// ============================================================================
// Event Mapping
// ============================================================================

/**
 * Map a RunEvent to a SessionStreamEvent
 */
export function mapRunEventToStreamEvent(
  event: RunEvent,
): SessionStreamEvent | null {
  switch (event.type) {
    case 'run.started': {
      return createWSMessage('session.stream.start', {
        sessionId: event.sessionId,
        runId: event.runId,
        agentId: event.agentId,
        providerId: event.data.providerId as string,
        modelId: event.data.modelId as string,
      }) as SessionStreamStart;
    }

    case 'run.delta': {
      return createWSMessage('session.stream.delta', {
        sessionId: event.sessionId,
        runId: event.runId,
        delta: event.data.delta as string,
        content: event.data.content as string,
      }) as SessionStreamDelta;
    }

    case 'run.completed': {
      return createWSMessage('session.stream.end', {
        sessionId: event.sessionId,
        runId: event.runId,
        finishReason: event.data.finishReason as string,
      }) as SessionStreamEnd;
    }

    case 'run.failed': {
      return createWSMessage('session.stream.error', {
        sessionId: event.sessionId,
        runId: event.runId,
        error: {
          code: (event.data.errorCode as string) ?? 'unknown_error',
          message: (event.data.errorMessage as string) ?? 'Unknown error',
        },
      }) as SessionStreamError;
    }

    case 'session.run.choices': {
      return createWSMessage('session.run.choices', {
        runId: event.runId,
        sessionId: event.sessionId,
        agentId: event.agentId,
        question: event.data.question as string | undefined,
        choices: event.data.choices as string[],
      }) as SessionRunChoicesEvent;
    }

    default:
      return null;
  }
}

// ============================================================================
// Stream Manager
// ============================================================================

/**
 * Stream subscription info
 */
type StreamSubscription = {
  runId: string;
  connectionId: string;
  unsubscribe: () => void;
};

/**
 * Manages streaming subscriptions and forwards RunEvents to WebSocket clients
 */
export class StreamManager {
  private subscriptions: Map<string, StreamSubscription> = new Map();
  // runId -> Set of subscription keys
  private runSubscriptions: Map<string, Set<string>> = new Map();
  // connectionId -> Set of subscription keys
  private connectionSubscriptions: Map<string, Set<string>> = new Map();
  private isRunning = false;

  constructor(
    private runEvents: RunEventEmitter,
    private connectionManager: ConnectionManager,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Subscribe a connection to a run's stream
   */
  subscribeToRun(runId: string, connectionId: string): void {
    const subKey = `${connectionId}:${runId}`;

    // Check if already subscribed
    if (this.subscriptions.has(subKey)) {
      this.logger.debug({ runId, connectionId }, 'Already subscribed to run');
      return;
    }

    // Subscribe to run events
    const unsubscribe = this.runEvents.subscribe(runId, (event) => {
      this.handleRunEvent(event, connectionId);
    });

    // Track subscription
    const subscription: StreamSubscription = {
      runId,
      connectionId,
      unsubscribe,
    };

    this.subscriptions.set(subKey, subscription);

    // Track by runId
    if (!this.runSubscriptions.has(runId)) {
      this.runSubscriptions.set(runId, new Set());
    }
    this.runSubscriptions.get(runId)!.add(subKey);

    // Track by connectionId
    if (!this.connectionSubscriptions.has(connectionId)) {
      this.connectionSubscriptions.set(connectionId, new Set());
    }
    this.connectionSubscriptions.get(connectionId)!.add(subKey);

    this.logger.info({ runId, connectionId }, 'Subscribed to run stream');
  }

  /**
   * Unsubscribe a connection from a run's stream
   */
  unsubscribeFromRun(runId: string, connectionId: string): void {
    const subKey = `${connectionId}:${runId}`;
    const subscription = this.subscriptions.get(subKey);

    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(subKey);

      // Remove from runId index
      const runSubs = this.runSubscriptions.get(runId);
      if (runSubs) {
        runSubs.delete(subKey);
        if (runSubs.size === 0) {
          this.runSubscriptions.delete(runId);
        }
      }

      // Remove from connectionId index
      const connSubs = this.connectionSubscriptions.get(connectionId);
      if (connSubs) {
        connSubs.delete(subKey);
        if (connSubs.size === 0) {
          this.connectionSubscriptions.delete(connectionId);
        }
      }

      this.logger.info({ runId, connectionId }, 'Unsubscribed from run stream');
    }
  }

  /**
   * Unsubscribe a connection from all runs
   */
  unsubscribeAllFromConnection(connectionId: string): void {
    const subKeys = this.connectionSubscriptions.get(connectionId);
    if (!subKeys) return;

    // Copy to avoid modification during iteration
    const keys = Array.from(subKeys);
    for (const subKey of keys) {
      const subscription = this.subscriptions.get(subKey);
      if (subscription) {
        subscription.unsubscribe();
        this.subscriptions.delete(subKey);

        // Remove from runId index
        const runSubs = this.runSubscriptions.get(subscription.runId);
        if (runSubs) {
          runSubs.delete(subKey);
          if (runSubs.size === 0) {
            this.runSubscriptions.delete(subscription.runId);
          }
        }
      }
    }

    this.connectionSubscriptions.delete(connectionId);

    this.logger.info(
      { connectionId, count: keys.length },
      'Unsubscribed connection from all runs',
    );
  }

  /**
   * Get subscription count for a run
   */
  getRunSubscriptionCount(runId: string): number {
    const subs = this.runSubscriptions.get(runId);
    return subs ? subs.size : 0;
  }

  /**
   * Get subscription count for a connection
   */
  getConnectionSubscriptionCount(connectionId: string): number {
    const subs = this.connectionSubscriptions.get(connectionId);
    return subs ? subs.size : 0;
  }

  /**
   * Get total subscription count
   */
  getTotalSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Handle a RunEvent and forward to subscribed connection
   */
  private handleRunEvent(event: RunEvent, connectionId: string): void {
    const streamEvent = mapRunEventToStreamEvent(event);
    if (!streamEvent) {
      return;
    }

    // Send to the connection
    const sent = this.connectionManager.send(connectionId, streamEvent);

    if (!sent) {
      this.logger.warn(
        { runId: event.runId, connectionId },
        'Failed to send stream event, connection may be closed',
      );
      // Clean up subscription
      this.unsubscribeFromRun(event.runId, connectionId);
    }

    // If run completed, failed, or emitted choices (suspended), auto-unsubscribe
    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'session.run.choices'
    ) {
      this.unsubscribeFromRun(event.runId, connectionId);
    }
  }

  /**
   * Start the stream manager (no-op, subscriptions are on-demand)
   */
  start(): void {
    this.isRunning = true;
    this.logger.info('Stream manager started');
  }

  /**
   * Stop the stream manager and clean up all subscriptions
   */
  stop(): void {
    // Unsubscribe all
    for (const subscription of this.subscriptions.values()) {
      subscription.unsubscribe();
    }

    this.subscriptions.clear();
    this.runSubscriptions.clear();
    this.connectionSubscriptions.clear();

    this.isRunning = false;
    this.logger.info('Stream manager stopped');
  }

  /**
   * Check if the manager is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a StreamManager instance
 */
export function createStreamManager(
  runEvents: RunEventEmitter,
  connectionManager: ConnectionManager,
  logger: FastifyBaseLogger,
): StreamManager {
  return new StreamManager(runEvents, connectionManager, logger);
}

export default StreamManager;
