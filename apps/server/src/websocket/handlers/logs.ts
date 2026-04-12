/**
 * Logs Handler
 *
 * WebSocket message handlers for log operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  type LogFilter,
  type LogEntry,
  type LogStats,
  type LogLevel,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';
import { getLogBuffer } from '../../lib/log-buffer';

// ============================================================================
// Log Message Types
// ============================================================================

export interface LogSubscribeRequest extends WSMessage {
  type: 'log.subscribe';
  payload: {
    levels?: LogLevel[];
    contexts?: string[];
    search?: string;
  };
}

export interface LogUnsubscribeRequest extends WSMessage {
  type: 'log.unsubscribe';
}

export interface LogQueryRequest extends WSMessage {
  type: 'log.query';
  payload: LogFilter;
}

export interface LogQueryResponse extends WSMessage {
  type: 'log.query';
  payload: {
    items: LogEntry[];
    total: number;
    hasMore: boolean;
  };
}

export interface LogStatsResponse extends WSMessage {
  type: 'log.stats';
  payload: LogStats;
}

export interface LogEntryNotification extends WSMessage {
  type: 'log.entry';
  payload: LogEntry;
}

// ============================================================================
// Subscription Manager (for real-time log streaming)
// ============================================================================

class LogSubscriptionManager {
  private subscriptions: Map<
    string,
    { levels?: LogLevel[]; contexts?: string[]; search?: string }
  > = new Map();

  subscribe(
    connectionId: string,
    filter?: { levels?: LogLevel[]; contexts?: string[]; search?: string },
  ): void {
    this.subscriptions.set(connectionId, filter ?? {});
  }

  unsubscribe(connectionId: string): void {
    this.subscriptions.delete(connectionId);
  }

  isSubscribed(connectionId: string): boolean {
    return this.subscriptions.has(connectionId);
  }

  getFilter(
    connectionId: string,
  ): { levels?: LogLevel[]; contexts?: string[]; search?: string } | undefined {
    return this.subscriptions.get(connectionId);
  }

  getAllSubscribed(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  shouldReceive(connectionId: string, entry: LogEntry): boolean {
    const filter = this.subscriptions.get(connectionId);
    if (!filter) return false;

    if (filter.levels && filter.levels.length > 0) {
      if (!filter.levels.includes(entry.level)) return false;
    }

    if (filter.contexts && filter.contexts.length > 0) {
      if (!filter.contexts.includes(entry.context)) return false;
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      if (!entry.message.toLowerCase().includes(searchLower)) return false;
    }

    return true;
  }
}

// Global subscription manager
const subscriptionManager = new LogSubscriptionManager();

// ============================================================================
// Logs Handler Class
// ============================================================================

/**
 * Handles log-related WebSocket messages
 */
export class LogsHandler {
  constructor(private logger: FastifyBaseLogger) {}

  /**
   * Handle log.subscribe request
   */
  async handleSubscribe(
    connectionId: string,
    request: LogSubscribeRequest,
    _context: HandlerContext,
  ): Promise<WSResponse | void> {
    try {
      const { levels, contexts, search } = request.payload;

      const filter: {
        levels?: LogLevel[];
        contexts?: string[];
        search?: string;
      } = {};
      if (levels) filter.levels = levels;
      if (contexts) filter.contexts = contexts;
      if (search) filter.search = search;
      subscriptionManager.subscribe(connectionId, filter);

      this.logger.info(
        { connectionId, levels, contexts, hasSearch: !!search },
        'Client subscribed to log stream',
      );

      return createWSMessage('log.subscribe', {
        success: true,
        message: 'Subscribed to log stream',
      }) as unknown as WSResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to subscribe to logs');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to subscribe to logs',
      );
    }
  }

  /**
   * Handle log.unsubscribe request
   */
  async handleUnsubscribe(
    connectionId: string,
    request: LogUnsubscribeRequest,
    _context: HandlerContext,
  ): Promise<WSResponse | void> {
    try {
      subscriptionManager.unsubscribe(connectionId);
      this.logger.info({ connectionId }, 'Client unsubscribed from log stream');
      return createWSMessage('log.unsubscribe', {
        success: true,
        message: 'Unsubscribed from log stream',
      }) as unknown as WSResponse;
    } catch (error) {
      this.logger.error(
        { error, connectionId },
        'Failed to unsubscribe from logs',
      );
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to unsubscribe from logs',
      );
    }
  }

  /**
   * Handle log.query request
   */
  async handleQuery(
    connectionId: string,
    request: LogQueryRequest,
    _context: HandlerContext,
  ): Promise<LogQueryResponse | ErrorResponse> {
    try {
      const buffer = getLogBuffer();
      const filter: LogFilter = request.payload;

      const result = buffer.query(filter);
      this.logger.info(
        {
          connectionId,
          resultCount: result.items.length,
          total: result.total,
        },
        'Querying logs via WebSocket',
      );
      return createWSMessage('log.query', {
        items: result.items,
        total: result.total,
        hasMore: result.hasMore,
      }) as LogQueryResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to query logs');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to query logs',
      );
    }
  }

  /**
   * Handle log.stats request
   */
  async handleStats(
    connectionId: string,
    request: WSMessage,
    _context: HandlerContext,
  ): Promise<LogStatsResponse | ErrorResponse> {
    try {
      const buffer = getLogBuffer();
      const stats = buffer.getStats();
      this.logger.info(
        { connectionId, total: stats.total },
        'Getting log stats via WebSocket',
      );
      return createWSMessage('log.stats', stats) as LogStatsResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to get log stats');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to get log stats',
      );
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Create an error response
   */
  private createErrorResponse(
    requestId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): ErrorResponse {
    const error: WSError = {
      code,
      message,
      ...(details !== undefined && { details }),
    };

    return createWSMessage('error', {
      requestId,
      error,
    }) as ErrorResponse;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create logs handler instance
 */
export function createLogsHandler(logger: FastifyBaseLogger): LogsHandler {
  return new LogsHandler(logger);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register logs handlers with message router
 */
export function registerLogsHandlers(
  router: {
    registerHandler: (
      type: string,
      handler: (
        connId: string,
        msg: WSMessage,
        ctx: HandlerContext,
      ) => Promise<WSResponse | void>,
    ) => void;
  },
  handler: LogsHandler,
): void {
  router.registerHandler('log.subscribe', (connId, msg, ctx) =>
    handler.handleSubscribe(connId, msg as LogSubscribeRequest, ctx),
  );

  router.registerHandler('log.unsubscribe', (connId, msg, ctx) =>
    handler.handleUnsubscribe(connId, msg as LogUnsubscribeRequest, ctx),
  );
  router.registerHandler(
    'log.query',
    (connId, msg, ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler.handleQuery(connId, msg as LogQueryRequest, ctx) as any,
  );
  router.registerHandler(
    'log.stats',
    (connId, msg, ctx) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler.handleStats(connId, msg, ctx) as any,
  );
}

/**
 * Get the subscription manager for external use (e.g., broadcasting new logs)
 */
export function getLogSubscriptionManager(): LogSubscriptionManager {
  return subscriptionManager;
}

export default LogsHandler;
