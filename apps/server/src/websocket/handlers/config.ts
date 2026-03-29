/**
 * Config Handler
 *
 * WebSocket message handlers for configuration operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { AppConfigService } from '../../config/service';
import type { ConnectionManager } from '../connection-manager';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  type ConfigGetRequest,
  type ConfigUpdateRequest,
  type ConfigUpdatedEvent,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Config get response type
 */
export type ConfigGetResponse = WSMessage<
  'config.get',
  {
    config: Record<string, unknown>;
    path?: string;
  }
>;

/**
 * Config update response type
 */
export type ConfigUpdateResponse = WSMessage<
  'config.update',
  {
    success: boolean;
    config: Record<string, unknown>;
  }
>;

/**
 * Config watch request type
 */
export type ConfigWatchRequest = WSMessage<
  'config.watch',
  {
    paths?: string[];
  }
>;

/**
 * Config watch response type
 */
export type ConfigWatchResponse = WSMessage<
  'config.watch',
  {
    watching: boolean;
    paths?: string[];
  }
>;

/**
 * Config unwatch request type
 */
export type ConfigUnwatchRequest = WSMessage<
  'config.unwatch',
  {}
>;

/**
 * Config unwatch response type
 */
export type ConfigUnwatchResponse = WSMessage<
  'config.unwatch',
  {
    watching: boolean;
  }
>;

/**
 * Connection watching config paths
 */
type ConfigWatcher = {
  connectionId: string;
  paths: Set<string>;
};

// ============================================================================
// Config Handler Class
// ============================================================================

/**
 * Handles configuration-related WebSocket messages
 */
export class ConfigHandler {
  private watchers: Map<string, ConfigWatcher> = new Map();

  constructor(
    private configService: AppConfigService,
    private connectionManager: ConnectionManager,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Handle config.get request
   */
  async handleGet(
    connectionId: string,
    request: ConfigGetRequest,
    context: HandlerContext,
  ): Promise<ConfigGetResponse | ErrorResponse> {
    try {
      const config = this.configService.getConfig();
      const configObj = config as unknown as Record<string, unknown>;

      // If path is specified, resolve to that path
      if (request.payload.path) {
        const value = this.resolveConfigPath(configObj, request.payload.path);
        return createWSMessage('config.get', {
          config: value as Record<string, unknown>,
          path: request.payload.path,
        }) as ConfigGetResponse;
      }

      return createWSMessage('config.get', {
        config: configObj,
      }) as ConfigGetResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to get config');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to get configuration',
      );
    }
  }

  /**
   * Handle config.update request
   */
  async handleUpdate(
    connectionId: string,
    request: ConfigUpdateRequest,
    context: HandlerContext,
  ): Promise<ConfigUpdateResponse | ErrorResponse> {
    try {
      // Check permission
      const conn = this.connectionManager.getConnection(connectionId);
      if (!conn) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.AUTH_FAILED,
          'Connection not found',
        );
      }

      // Check if connection has config.write capability
      if (!conn.capabilities.includes('config.write') && !conn.capabilities.includes('*')) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.FORBIDDEN,
          'Permission denied: config.write capability required',
        );
      }

      const updates = request.payload.updates;
      
      // Validate updates
      const validation = this.validateConfigUpdates(updates);
      if (!validation.valid) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.INVALID_REQUEST,
          `Invalid configuration: ${validation.errors?.join(', ')}`,
        );
      }

      // Get current config
      const currentConfig = this.configService.getConfig() as unknown as Record<string, unknown>;
      
      // Apply updates
      const updatedConfig = this.applyUpdates(currentConfig, updates);

      // Save updated config (sync operation)
      this.configService.save(updatedConfig as any);

      this.logger.info(
        { connectionId, updates: Object.keys(updates) },
        'Configuration updated via WebSocket',
      );

      // Broadcast config.updated event to watchers
      this.broadcastConfigUpdate(updates, connectionId);

      return createWSMessage('config.update', {
        success: true,
        config: updatedConfig,
      }) as ConfigUpdateResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to update config');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to update configuration',
      );
    }
  }

  /**
   * Handle config.watch request
   */
  async handleWatch(
    connectionId: string,
    request: ConfigWatchRequest,
    context: HandlerContext,
  ): Promise<ConfigWatchResponse | ErrorResponse> {
    try {
      const paths = request.payload.paths ? new Set(request.payload.paths) : new Set(['*']);

      this.watchers.set(connectionId, {
        connectionId,
        paths,
      });

      this.logger.info(
        { connectionId, paths: Array.from(paths) },
        'Connection watching config',
      );

      return createWSMessage('config.watch', {
        watching: true,
        paths: Array.from(paths),
      }) as ConfigWatchResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to watch config');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to watch configuration',
      );
    }
  }

  /**
   * Handle config.unwatch request
   */
  async handleUnwatch(
    connectionId: string,
    request: ConfigUnwatchRequest,
    context: HandlerContext,
  ): Promise<ConfigUnwatchResponse | ErrorResponse> {
    try {
      const removed = this.watchers.delete(connectionId);

      this.logger.info(
        { connectionId, wasWatching: removed },
        'Connection stopped watching config',
      );

      return createWSMessage('config.unwatch', {
        watching: false,
      }) as ConfigUnwatchResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to unwatch config');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to unwatch configuration',
      );
    }
  }

  /**
   * Remove watcher when connection closes
   */
  removeWatcher(connectionId: string): void {
    this.watchers.delete(connectionId);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Resolve a config path to its value
   */
  private resolveConfigPath(
    config: Record<string, unknown>,
    path: string,
  ): unknown {
    const parts = path.split('.');
    let current: unknown = config;

    for (const part of parts) {
      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Validate config updates
   */
  private validateConfigUpdates(
    updates: Record<string, unknown>,
  ): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    // Check for invalid paths
    for (const path of Object.keys(updates)) {
      // Validate path format (alphanumeric with dots)
      if (!/^[a-zA-Z0-9._]+$/.test(path)) {
        errors.push(`Invalid path format: ${path}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Apply updates to config
   */
  private applyUpdates(
    config: Record<string, unknown>,
    updates: Record<string, unknown>,
  ): Record<string, unknown> {
    const result = { ...config };

    for (const [path, value] of Object.entries(updates)) {
      this.setNestedValue(result, path, value);
    }

    return result;
  }

  /**
   * Set a nested value in an object
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Broadcast config update to watchers
   */
  private broadcastConfigUpdate(
    updates: Record<string, unknown>,
    excludeConnectionId: string,
  ): void {
    const event: ConfigUpdatedEvent = createWSMessage('config.updated', {
      updates,
      updatedAt: new Date().toISOString(),
    }) as ConfigUpdatedEvent;

    for (const [connectionId, watcher] of this.watchers) {
      // Don't send to the connection that made the update
      if (connectionId === excludeConnectionId) {
        continue;
      }

      // Check if watching all paths or specific paths
      if (watcher.paths.has('*')) {
        this.sendToConnection(connectionId, event);
        continue;
      }

      // Check if any updated path matches watched paths
      const hasMatchingPath = Object.keys(updates).some((path) => {
        return watcher.paths.has(path) || 
               Array.from(watcher.paths).some((watched) => path.startsWith(watched + '.'));
      });

      if (hasMatchingPath) {
        this.sendToConnection(connectionId, event);
      }
    }
  }

  /**
   * Send a message to a connection
   */
  private sendToConnection(connectionId: string, message: WSMessage): void {
    const conn = this.connectionManager.getConnection(connectionId);
    if (conn?.socket && conn.socket.readyState === 1) {
      conn.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Create an error response
   */
  private createErrorResponse(
    requestId: string,
    code: keyof typeof WS_ERROR_CODES,
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
 * Create config handler instance
 */
export function createConfigHandler(
  configService: AppConfigService,
  connectionManager: ConnectionManager,
  logger: FastifyBaseLogger,
): ConfigHandler {
  return new ConfigHandler(configService, connectionManager, logger);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register config handlers with message router
 */
export function registerConfigHandlers(
  router: {
    registerHandler: (type: string, handler: (connId: string, msg: WSMessage, ctx: HandlerContext) => Promise<WSResponse | void>) => void;
  },
  handler: ConfigHandler,
): void {
  router.registerHandler('config.get', (connId, msg, ctx) =>
    handler.handleGet(connId, msg as ConfigGetRequest, ctx),
  );

  router.registerHandler('config.update', (connId, msg, ctx) =>
    handler.handleUpdate(connId, msg as ConfigUpdateRequest, ctx),
  );

  router.registerHandler('config.watch', (connId, msg, ctx) =>
    handler.handleWatch(connId, msg as ConfigWatchRequest, ctx),
  );

  router.registerHandler('config.unwatch', (connId, msg, ctx) =>
    handler.handleUnwatch(connId, msg as ConfigUnwatchRequest, ctx),
  );
}

export default ConfigHandler;
