/**
 * MCP Handler
 *
 * WebSocket message handlers for MCP server operations.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { McpClientService } from '../../mcp/client';
import type { McpServerConfig } from '@openaidy/config';
import type { HandlerContext } from '../index';
import {
  type WSMessage,
  type WSResponse,
  type WSError,
  type ErrorResponse,
  WS_ERROR_CODES,
  createWSMessage,
} from '@openaidy/shared-types';

// ============================================================================
// MCP Response Types
// ============================================================================

export type McpListResponse = WSMessage<
  'mcp.list',
  {
    servers: Array<{
      id: string;
      connected: boolean;
      tools: string[];
    }>;
  }
>;

export type McpCallResponse = WSMessage<
  'mcp.call',
  {
    serverId: string;
    tool: string;
    result: unknown;
  }
>;

export type McpConnectResponse = WSMessage<
  'mcp.connect',
  {
    serverId: string;
    connected: boolean;
  }
>;

export type McpDisconnectResponse = WSMessage<
  'mcp.disconnect',
  {
    serverId: string;
    disconnected: boolean;
  }
>;

// ============================================================================
// MCP Handler Class
// ============================================================================

/**
 * Handles MCP-related WebSocket messages
 */
export class McpHandler {
  constructor(
    private mcpService: McpClientService,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Handle mcp.list request - list connected servers and their tools
   */
  async handleList(
    connectionId: string,
    request: WSMessage<'mcp.list', { serverId?: string }>,
    _context: HandlerContext,
  ): Promise<McpListResponse | ErrorResponse> {
    try {
      const serverId = request.payload.serverId;

      if (serverId) {
        // List specific server
        const connected = this.mcpService.isConnected(serverId);
        const tools = connected
          ? this.mcpService.getTools(serverId).map((t) => t.name)
          : [];

        return createWSMessage('mcp.list', {
          servers: [{ id: serverId, connected, tools }],
        }) as McpListResponse;
      }

      // List all connected servers
      const connectedServers = this.mcpService.getConnectedServers();
      const servers = connectedServers.map((id) => ({
        id,
        connected: true,
        tools: this.mcpService.getTools(id).map((t) => t.name),
      }));

      this.logger.debug(
        { count: servers.length, connectionId },
        'Listing MCP servers via WebSocket',
      );

      return createWSMessage('mcp.list', { servers }) as McpListResponse;
    } catch (error) {
      this.logger.error({ error, connectionId }, 'Failed to list MCP servers');
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        'Failed to list MCP servers',
      );
    }
  }

  /**
   * Handle mcp.call request - execute a tool call
   */
  async handleCall(
    connectionId: string,
    request: WSMessage<
      'mcp.call',
      { serverId: string; tool: string; arguments: Record<string, unknown> }
    >,
    _context: HandlerContext,
  ): Promise<McpCallResponse | ErrorResponse> {
    try {
      const { serverId, tool, arguments: args } = request.payload;

      if (!serverId || !tool) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.INVALID_PAYLOAD,
          'serverId and tool are required',
        );
      }

      if (!this.mcpService.isConnected(serverId)) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.NOT_FOUND,
          `MCP server ${serverId} not connected`,
        );
      }

      this.logger.info(
        { serverId, tool, connectionId },
        'Calling MCP tool via WebSocket',
      );

      const result = await this.mcpService.callTool(serverId, tool, args ?? {});

      return createWSMessage('mcp.call', {
        serverId,
        tool,
        result,
      }) as McpCallResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        { error: errorMessage, connectionId },
        'Failed to call MCP tool',
      );
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        `Failed to call MCP tool: ${errorMessage}`,
      );
    }
  }

  /**
   * Handle mcp.connect request - connect to an MCP server
   */
  async handleConnect(
    connectionId: string,
    request: WSMessage<'mcp.connect', { config: McpServerConfig }>,
    _context: HandlerContext,
  ): Promise<McpConnectResponse | ErrorResponse> {
    try {
      const { config } = request.payload;

      if (!config?.id) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.INVALID_PAYLOAD,
          'config with id is required',
        );
      }

      // Check if already connected
      if (this.mcpService.isConnected(config.id)) {
        return createWSMessage('mcp.connect', {
          serverId: config.id,
          connected: true,
        }) as McpConnectResponse;
      }

      this.logger.info(
        { serverId: config.id, transport: config.transport, connectionId },
        'Connecting to MCP server via WebSocket',
      );

      await this.mcpService.connect(config);

      return createWSMessage('mcp.connect', {
        serverId: config.id,
        connected: true,
      }) as McpConnectResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        { error: errorMessage, connectionId },
        'Failed to connect to MCP server',
      );
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        `Failed to connect to MCP server: ${errorMessage}`,
      );
    }
  }

  /**
   * Handle mcp.disconnect request - disconnect from an MCP server
   */
  async handleDisconnect(
    connectionId: string,
    request: WSMessage<'mcp.disconnect', { serverId: string }>,
    _context: HandlerContext,
  ): Promise<McpDisconnectResponse | ErrorResponse> {
    try {
      const { serverId } = request.payload;

      if (!serverId) {
        return this.createErrorResponse(
          request.id,
          WS_ERROR_CODES.INVALID_PAYLOAD,
          'serverId is required',
        );
      }

      this.logger.info(
        { serverId, connectionId },
        'Disconnecting from MCP server via WebSocket',
      );

      await this.mcpService.disconnect(serverId);

      return createWSMessage('mcp.disconnect', {
        serverId,
        disconnected: true,
      }) as McpDisconnectResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        { error: errorMessage, connectionId },
        'Failed to disconnect from MCP server',
      );
      return this.createErrorResponse(
        request.id,
        WS_ERROR_CODES.INTERNAL_ERROR,
        `Failed to disconnect from MCP server: ${errorMessage}`,
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
 * Create MCP handler instance
 */
export function createMcpHandler(
  mcpService: McpClientService,
  logger: FastifyBaseLogger,
): McpHandler {
  return new McpHandler(mcpService, logger);
}

// ============================================================================
// Handler Registration
// ============================================================================

/**
 * Register MCP handlers with message router
 */
export function registerMcpHandlers(
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
  handler: McpHandler,
): void {
  router.registerHandler(
    'mcp.list',
    (connId, msg, ctx) =>
      handler.handleList(
        connId,
        msg as WSMessage<'mcp.list', { serverId?: string }>,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'mcp.call',
    (connId, msg, ctx) =>
      handler.handleCall(
        connId,
        msg as WSMessage<
          'mcp.call',
          { serverId: string; tool: string; arguments: Record<string, unknown> }
        >,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'mcp.connect',
    (connId, msg, ctx) =>
      handler.handleConnect(
        connId,
        msg as WSMessage<'mcp.connect', { config: McpServerConfig }>,
        ctx,
      ) as Promise<WSResponse>,
  );

  router.registerHandler(
    'mcp.disconnect',
    (connId, msg, ctx) =>
      handler.handleDisconnect(
        connId,
        msg as WSMessage<'mcp.disconnect', { serverId: string }>,
        ctx,
      ) as Promise<WSResponse>,
  );
}

export default McpHandler;
