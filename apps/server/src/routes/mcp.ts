/**
 * MCP Server Routes
 *
 * REST API endpoints for MCP server operations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { McpClientService } from '../mcp/client';

/**
 * Schema for POST /mcp/call request body
 */
const mcpCallSchema = z.object({
  serverId: z.string().min(1, 'serverId is required'),
  tool: z.string().min(1, 'tool is required'),
  arguments: z.record(z.unknown()).optional().default({}),
});

/**
 * Schema for POST /mcp/connect request body
 */
const mcpConnectSchema = z.object({
  config: z.object({
    id: z.string().min(1, 'config.id is required'),
    transport: z.enum(['stdio', 'http']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
  }),
});

/**
 * Schema for POST /mcp/disconnect request body
 */
const mcpDisconnectSchema = z.object({
  serverId: z.string().min(1, 'serverId is required'),
});

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
          arguments?: Record<string, unknown>;
        };
      }>,
      reply: FastifyReply,
    ) => {
      // Validate request body with Zod
      let body;
      try {
        body = mcpCallSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'INVALID_PAYLOAD',
          message: error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      const { serverId, tool, arguments: args } = body;

      if (!mcpService.isConnected(serverId)) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server ${serverId} not connected`,
        });
      }

      try {
        const startTime = Date.now();
        const result = await mcpService.callTool(serverId, tool, args);
        const duration = Date.now() - startTime;

        fastify.log.info(
          { serverId, tool, duration, success: true },
          'MCP tool call completed',
        );

        return { result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error(
          { serverId, tool, error: message },
          'MCP tool call failed',
        );
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
      // Validate request body with Zod
      let body;
      try {
        body = mcpConnectSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'INVALID_PAYLOAD',
          message: error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      const { config } = body;

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
      // Validate request body with Zod
      let body;
      try {
        body = mcpDisconnectSchema.parse(request.body);
      } catch (error) {
        return reply.status(400).send({
          error: 'INVALID_PAYLOAD',
          message: error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      const { serverId } = body;

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
