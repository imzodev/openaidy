/**
 * MCP Server Routes
 *
 * REST API endpoints for MCP server lifecycle management:
 * - Config CRUD (stored in config/openaidy.json)
 * - Runtime connect/disconnect
 * - Tool discovery
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { McpClientService } from '../mcp/client';
import type { AppConfigService } from '../config/service';
import type { McpServerConfig } from '@openaidy/config';
import {
  type McpServerRecord,
  type McpToolWithSchema,
  type CreateMcpServerRequest,
  type UpdateMcpServerRequest,
} from '@openaidy/shared-types';

/**
 * MCP routes options
 */
export type McpRoutesOptions = {
  mcpService: McpClientService;
  configService: AppConfigService;
};

/**
 * Register MCP routes
 */
export async function registerMcpRoutes(
  fastify: FastifyInstance,
  options: McpRoutesOptions,
): Promise<void> {
  const { mcpService, configService } = options;

  /**
   * GET /mcp/servers
   *
   * List all configured MCP servers (from config) with their live runtime status.
   * Shows both persisted config and current connection state.
   */
  fastify.get(
    '/mcp/servers',
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const configuredServers = configService.getMcpServers();

      const servers: McpServerRecord[] = configuredServers.map(
        (serverConfig) => {
          const connected = mcpService.isConnected(serverConfig.id);
          const tools = connected
            ? mcpService.getTools(serverConfig.id).map((t) => ({
                name: t.name,
                description: t.description,
              }))
            : [];

          return {
            id: serverConfig.id,
            name: serverConfig.name,
            transport: serverConfig.transport,
            command: serverConfig.command,
            args: serverConfig.args,
            env: serverConfig.env,
            url: serverConfig.url,
            headers: serverConfig.headers,
            connected,
            toolCount: tools.length,
            tools,
          };
        },
      );

      return { servers };
    },
  );

  /**
   * GET /mcp/servers/:id
   *
   * Get a single MCP server config + runtime status by ID.
   */
  fastify.get(
    '/mcp/servers/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const serverConfig = configService.getMcpServer(id);
      if (!serverConfig) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server "${id}" not found in config`,
        });
      }

      const connected = mcpService.isConnected(id);
      const tools = connected
        ? mcpService.getTools(id).map((t) => ({
            name: t.name,
            description: t.description,
          }))
        : [];

      const record: McpServerRecord = {
        id: serverConfig.id,
        name: serverConfig.name,
        transport: serverConfig.transport,
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
        url: serverConfig.url,
        headers: serverConfig.headers,
        connected,
        toolCount: tools.length,
        tools,
      };

      return { server: record };
    },
  );

  /**
   * GET /mcp/servers/:id/tools
   *
   * Get full tool definitions with input schemas from a connected server.
   */
  fastify.get(
    '/mcp/servers/:id/tools',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      if (!mcpService.isConnected(id)) {
        return reply.status(409).send({
          error: 'NOT_CONNECTED',
          message: `MCP server "${id}" is not connected`,
        });
      }

      const tools: McpToolWithSchema[] = mcpService.getTools(id).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      return { tools };
    },
  );

  /**
   * POST /mcp/servers
   *
   * Add a new MCP server config and connect to it.
   * The config is persisted to config/openaidy.json.
   */
  fastify.post<{
    Body: { config: CreateMcpServerRequest };
  }>(
    '/mcp/servers',
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
                name: { type: 'string' },
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
      request: FastifyRequest<{ Body: { config: CreateMcpServerRequest } }>,
      reply: FastifyReply,
    ) => {
      const { config } = request.body;

      const existing = configService.getMcpServer(config.id);
      if (existing) {
        return reply.status(409).send({
          error: 'CONFLICT',
          message: `MCP server "${config.id}" already exists in config`,
        });
      }

      // Persist to config
      const fullConfig = configService.getConfig();
      const newServers = [
        ...(fullConfig.mcpServers ?? []),
        config as McpServerConfig,
      ];
      await configService.save({ ...fullConfig, mcpServers: newServers });

      // Attempt connection (non-fatal if it fails)
      let connected = false;
      try {
        await mcpService.connect(config as McpServerConfig);
        connected = true;
      } catch (error) {
        fastify.log.warn(
          {
            serverId: config.id,
            err: error instanceof Error ? error.message : String(error),
          },
          'MCP server saved but initial connection failed',
        );
      }

      const tools = connected
        ? mcpService.getTools(config.id).map((t) => ({
            name: t.name,
            description: t.description,
          }))
        : [];

      return reply.status(201).send({
        server: {
          id: config.id,
          name: config.name,
          transport: config.transport,
          command: config.command,
          args: config.args,
          env: config.env,
          url: config.url,
          headers: config.headers,
          connected,
          toolCount: tools.length,
          tools,
        },
      });
    },
  );

  /**
   * PATCH /mcp/servers/:id
   *
   * Update an existing MCP server config.
   * If the server is connected, changes take effect on next restart.
   */
  fastify.patch<{
    Params: { id: string };
    Body: UpdateMcpServerRequest;
  }>(
    '/mcp/servers/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1 } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            transport: { type: 'string', enum: ['stdio', 'http'] },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            env: { type: 'object', additionalProperties: { type: 'string' } },
            url: { type: 'string' },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: UpdateMcpServerRequest;
      }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;
      const patch = request.body;

      const existing = configService.getMcpServer(id);
      if (!existing) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server "${id}" not found in config`,
        });
      }

      // Build updated config (merge patch into existing)
      const updated: McpServerConfig = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.transport !== undefined
          ? { transport: patch.transport }
          : {}),
        ...(patch.command !== undefined ? { command: patch.command } : {}),
        ...(patch.args !== undefined ? { args: patch.args } : {}),
        ...(patch.env !== undefined ? { env: patch.env } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.headers !== undefined ? { headers: patch.headers } : {}),
      };

      // Persist to config
      const fullConfig = configService.getConfig();
      const newServers = (fullConfig.mcpServers ?? []).map((s) =>
        s.id === id ? updated : s,
      );
      await configService.save({ ...fullConfig, mcpServers: newServers });

      const connected = mcpService.isConnected(id);
      const tools = connected
        ? mcpService.getTools(id).map((t) => ({
            name: t.name,
            description: t.description,
          }))
        : [];

      return {
        server: {
          id: updated.id,
          name: updated.name,
          transport: updated.transport,
          command: updated.command,
          args: updated.args,
          env: updated.env,
          url: updated.url,
          headers: updated.headers,
          connected,
          toolCount: tools.length,
          tools,
        },
      };
    },
  );

  /**
   * DELETE /mcp/servers/:id
   *
   * Remove an MCP server config and disconnect if connected.
   */
  fastify.delete(
    '/mcp/servers/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const existing = configService.getMcpServer(id);
      if (!existing) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server "${id}" not found in config`,
        });
      }

      // Disconnect if connected (ignore errors)
      if (mcpService.isConnected(id)) {
        try {
          await mcpService.disconnect(id);
        } catch (error) {
          fastify.log.warn(
            {
              serverId: id,
              err: error instanceof Error ? error.message : String(error),
            },
            'Error disconnecting MCP server during delete',
          );
        }
      }

      // Remove from config
      const fullConfig = configService.getConfig();
      const newServers = (fullConfig.mcpServers ?? []).filter(
        (s) => s.id !== id,
      );
      await configService.save({ ...fullConfig, mcpServers: newServers });

      return reply.status(204).send();
    },
  );

  /**
   * POST /mcp/servers/:id/connect
   *
   * Manually connect to an MCP server (starts from saved config).
   */
  fastify.post(
    '/mcp/servers/:id/connect',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      const serverConfig = configService.getMcpServer(id);
      if (!serverConfig) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server "${id}" not found in config`,
        });
      }

      if (mcpService.isConnected(id)) {
        return { serverId: id, connected: true };
      }

      try {
        await mcpService.connect(serverConfig);
        return { serverId: id, connected: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: 'CONNECTION_FAILED',
          message: `Failed to connect to MCP server "${id}": ${message}`,
        });
      }
    },
  );

  /**
   * POST /mcp/servers/:id/disconnect
   *
   * Manually disconnect from an MCP server.
   */
  fastify.post(
    '/mcp/servers/:id/disconnect',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      try {
        await mcpService.disconnect(id);
        return { serverId: id, disconnected: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: `Failed to disconnect MCP server "${id}": ${message}`,
        });
      }
    },
  );

  /**
   * POST /mcp/call
   *
   * Execute an MCP tool call (legacy — prefer /mcp/servers/:id/call)
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
      const { serverId, tool, arguments: args } = request.body;
      const toolArgs = args ?? {};

      if (!mcpService.isConnected(serverId)) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `MCP server ${serverId} not connected`,
        });
      }

      try {
        const result = await mcpService.callTool(serverId, tool, toolArgs);
        return { result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: `Failed to call MCP tool: ${message}`,
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
