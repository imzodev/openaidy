/**
 * MCP Server Routes
 *
 * REST API endpoints for MCP server operations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { McpClientService } from '../mcp/client';
import type { McpServerConfig } from '@openaidy/config';

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
  fastify.get(
    '/mcp/servers',
    async (_request: FastifyRequest, _reply: FastifyReply) => {
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
    },
  );

  /**
   * POST /mcp/call
   *
   * Execute an MCP tool call
   */
  fastify.post<{
    Body: {
      serverId: string;
      tool: string;
      arguments?: Record<string, unknown>;
    };
  }>(
    '/mcp/call',
    {
      schema: {
        body: {
          type: 'object',
          required: ['serverId', 'tool'],
          properties: {
            serverId: { type: 'string', minLength: 1 },
            tool: { type: 'string', minLength: 1 },
            arguments: { type: 'object', default: {} },
          },
        },
      },
    },
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
      // Fastify now validates the body with the schema above, so we can use request.body directly
      const {
        serverId,
        tool,
        arguments: args,
      } = request.body as {
        serverId: string;
        tool: string;
        arguments?: Record<string, unknown>;
      };
      const toolArgs = args ?? {};

      if (!mcpService.isConnected(serverId)) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server ${serverId} not connected`,
        });
      }

      try {
        const startTime = Date.now();
        const result = await mcpService.callTool(serverId, tool, toolArgs);
        const duration = Date.now() - startTime;

        fastify.log.info(
          { serverId, tool, duration, success: true },
          'MCP tool call completed',
        );

        return { result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
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
  fastify.post<{
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
  }>(
    '/mcp/connect',
    {
      schema: {
        body: {
          type: 'object',
          required: ['config'],
          properties: {
            config: {
              type: 'object',
              required: ['id', 'transport'],
              properties: {
                id: { type: 'string', minLength: 1 },
                transport: { type: 'string', enum: ['stdio', 'http'] },
                command: { type: 'string' },
                args: { type: 'array', items: { type: 'string' } },
                env: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
                url: { type: 'string' },
                headers: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
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
      _reply: FastifyReply,
    ) => {
      const { config } = request.body as {
        config: McpServerConfig;
      };

      // Check if already connected
      if (mcpService.isConnected(config.id)) {
        return { serverId: config.id, connected: true };
      }

      try {
        await mcpService.connect(config);
        return { serverId: config.id, connected: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return _reply.status(500).send({
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
  fastify.post<{
    Body: { serverId: string };
  }>(
    '/mcp/disconnect',
    {
      schema: {
        body: {
          type: 'object',
          required: ['serverId'],
          properties: {
            serverId: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { serverId: string };
      }>,
      _reply: FastifyReply,
    ) => {
      const { serverId } = request.body as { serverId: string };

      try {
        await mcpService.disconnect(serverId);
        return { serverId, disconnected: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return _reply.status(500).send({
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
