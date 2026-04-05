/**
 * MCP Server Routes
 *
 * REST API endpoints for MCP server operations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { McpClientService } from '../mcp/client';

/**
 * MCP routes options
 */
export type McpRoutesOptions = {
  mcpService: McpClientService;
};

/**
 * Register MCP routes
 */
export async function registerMcpRoutes(
  fastify: FastifyInstance,
  options: McpRoutesOptions,
): Promise<void> {
  const { mcpService } = options;

  /**
   * GET /mcp/servers
   *
   * List all configured MCP servers and their status
   */
  fastify.get('/mcp/servers', async (_request: FastifyRequest, reply: FastifyReply) => {
    const connectedServers = mcpService.getConnectedServers();

    const servers = connectedServers.map((id) => ({
      id,
      connected: true,
      tools: mcpService.getTools(id).map((t) => ({
        name: t.name,
        description: t.description,
      })),
    }));

    return { servers };
  });

  /**
   * POST /mcp/call
   *
   * Execute an MCP tool call
   */
  fastify.post(
    '/mcp/call',
    async (
      request: FastifyRequest<{
        Body: {
          serverId: string;
          tool: string;
          arguments: Record<string, unknown>;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { serverId, tool, arguments: args } = request.body;

      if (!serverId || !tool) {
        return reply.status(400).send({
          error: 'INVALID_PAYLOAD',
          message: 'serverId and tool are required',
        });
      }

      if (!mcpService.isConnected(serverId)) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server ${serverId} not connected`,
        });
      }

      try {
        const result = await mcpService.callTool(serverId, tool, args ?? {});
        return { result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: `Failed to call MCP tool: ${message}`,
        });
      }
    },
  );

  /**
   * POST /mcp/connect
   *
   * Connect to an MCP server
   */
  fastify.post(
    '/mcp/connect',
    async (
      request: FastifyRequest<{
        Body: {
          config: {
            id: string;
            transport: 'stdio' | 'http';
            command?: string;
            args?: string[];
            env?: Record<string, string>;
            url?: string;
            headers?: Record<string, string>;
          };
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { config } = request.body;

      if (!config?.id) {
        return reply.status(400).send({
          error: 'INVALID_PAYLOAD',
          message: 'config with id is required',
        });
      }

      // Check if already connected
      if (mcpService.isConnected(config.id)) {
        return { serverId: config.id, connected: true };
      }

      try {
        await mcpService.connect(config as any);
        return { serverId: config.id, connected: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: `Failed to connect to MCP server: ${message}`,
        });
      }
    },
  );

  /**
   * POST /mcp/disconnect
   *
   * Disconnect from an MCP server
   */
  fastify.post(
    '/mcp/disconnect',
    async (
      request: FastifyRequest<{
        Body: { serverId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { serverId } = request.body;

      if (!serverId) {
        return reply.status(400).send({
          error: 'INVALID_PAYLOAD',
          message: 'serverId is required',
        });
      }

      try {
        await mcpService.disconnect(serverId);
        return { serverId, disconnected: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: `Failed to disconnect from MCP server: ${message}`,
        });
      }
    },
  );
}

/**
 * Create MCP routes plugin
 */
export function createMcpRoutesPlugin(options: McpRoutesOptions) {
  return async (fastify: FastifyInstance) => {
    await registerMcpRoutes(fastify, options);
  };
}
