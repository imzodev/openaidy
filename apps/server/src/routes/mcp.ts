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
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { McpServerConfig } from '@openaidy/config';
import {
  type McpToolWithSchema,
  type CreateMcpServerRequest,
  type UpdateMcpServerRequest,
} from '@openaidy/shared-types';
import { requireAuth } from '../middleware/require-auth';
import {
  toMcpServerRecord,
  unmaskRecord,
  type McpRuntimeStatus,
} from '../mcp/server-record';
import {
  normalizeMcpServerMap,
  McpConfigImportError,
  type RawMcpServerMap,
} from '../mcp/config-import';

/**
 * Managing MCP servers means running arbitrary local processes (stdio) or
 * dialling out with stored credentials (http), so all write/lifecycle
 * operations require the admin scope — matching access-token and addon
 * management.
 */
const ADMIN_SCOPE = '*';

/**
 * MCP routes options
 */
export type McpRoutesOptions = {
  mcpService: McpClientService;
  configService: AppConfigService;
  authMiddleware: AuthMiddleware;
};

/**
 * Register MCP routes
 */
export async function registerMcpRoutes(
  fastify: FastifyInstance,
  options: McpRoutesOptions,
): Promise<void> {
  const { mcpService, configService, authMiddleware } = options;

  /**
   * Live connection state for a server, used to enrich the persisted config
   * into an API record.
   */
  const runtimeStatus = (id: string): McpRuntimeStatus => {
    const connected = mcpService.isConnected(id);
    const tools = connected
      ? mcpService.getTools(id).map((t) => ({
          name: t.name,
          description: t.description,
        }))
      : [];
    return { connected, tools };
  };

  /**
   * GET /mcp/servers
   *
   * List all configured MCP servers (from config) with their live runtime status.
   * Shows both persisted config and current connection state. Secret values in
   * env/headers are redacted (see toMcpServerRecord).
   */
  fastify.get(
    '/mcp/servers',
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const servers = configService
        .getMcpServers()
        .map((serverConfig) =>
          toMcpServerRecord(serverConfig, runtimeStatus(serverConfig.id)),
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

      return { server: toMcpServerRecord(serverConfig, runtimeStatus(id)) };
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
        return reply.status(503).send({
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

  // -----------------------------------------------------------------------
  // All routes below require authentication.
  // Registered in a nested plugin so the preHandler hook is scoped only
  // to write operations, leaving the GET routes above public.
  // -----------------------------------------------------------------------
  await fastify.register(async (authRequired) => {
    authRequired.addHook(
      'preHandler',
      requireAuth({ authMiddleware, requiredScope: ADMIN_SCOPE }),
    );

    /**
     * POST /mcp/servers
     *
     * Add a new MCP server config and connect to it.
     * The config is persisted to config/openaidy.json.
     */
    authRequired.post<{
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
        try {
          await mcpService.connect(config as McpServerConfig);
        } catch (error) {
          fastify.log.warn(
            {
              serverId: config.id,
              err: error instanceof Error ? error.message : String(error),
            },
            'MCP server saved but initial connection failed',
          );
        }

        return reply.status(201).send({
          server: toMcpServerRecord(
            config as McpServerConfig,
            runtimeStatus(config.id),
          ),
        });
      },
    );

    /**
     * POST /mcp/servers/import
     *
     * Import one or more servers from the standard keyed-map config format
     * (Claude Desktop / VS Code / Cursor), e.g.:
     *
     *   { "mcpServers": { "github": { "type": "http", "url": "…",
     *     "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } } } }
     *
     * Atomic: if any entry is invalid or any id already exists, nothing is
     * imported. Each imported server is then connected (non-fatal on failure).
     */
    authRequired.post<{ Body: { mcpServers: RawMcpServerMap } }>(
      '/mcp/servers/import',
      {
        schema: {
          body: {
            type: 'object',
            required: ['mcpServers'],
            properties: {
              mcpServers: {
                type: 'object',
                minProperties: 1,
                additionalProperties: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    transport: { type: 'string' },
                    name: { type: 'string' },
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
      },
      async (
        request: FastifyRequest<{ Body: { mcpServers: RawMcpServerMap } }>,
        reply: FastifyReply,
      ) => {
        // Normalise the keyed-map format into our flat config shape.
        let servers;
        try {
          servers = normalizeMcpServerMap(request.body.mcpServers);
        } catch (error) {
          if (error instanceof McpConfigImportError) {
            return reply
              .status(400)
              .send({ error: 'INVALID_CONFIG', message: error.message });
          }
          throw error;
        }

        // All-or-nothing: reject the whole import if any id already exists.
        const existingIds = new Set(
          configService.getMcpServers().map((s) => s.id),
        );
        const conflicts = servers
          .map((s) => s.id)
          .filter((id) => existingIds.has(id));
        if (conflicts.length > 0) {
          return reply.status(409).send({
            error: 'CONFLICT',
            message: `MCP server(s) already exist in config: ${conflicts.join(', ')}`,
          });
        }

        // Persist all in a single save.
        const fullConfig = configService.getConfig();
        await configService.save({
          ...fullConfig,
          mcpServers: [...(fullConfig.mcpServers ?? []), ...servers],
        });

        // Connect each (non-fatal) and build redacted records.
        const records = [];
        for (const serverConfig of servers) {
          try {
            await mcpService.connect(serverConfig);
          } catch (error) {
            fastify.log.warn(
              {
                serverId: serverConfig.id,
                err: error instanceof Error ? error.message : String(error),
              },
              'MCP server imported but initial connection failed',
            );
          }
          records.push(
            toMcpServerRecord(serverConfig, runtimeStatus(serverConfig.id)),
          );
        }

        return reply.status(201).send({ servers: records });
      },
    );

    /**
     * PATCH /mcp/servers/:id
     *
     * Update an existing MCP server config.
     * If the server is connected, changes take effect on next restart.
     */
    authRequired.patch<{
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

        // Build updated config (merge patch into existing). env/headers go
        // through unmaskRecord so a client that echoes back redacted values
        // (MASKED_VALUE) keeps the stored secret instead of overwriting it.
        const updated: McpServerConfig = {
          ...existing,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.transport !== undefined
            ? { transport: patch.transport }
            : {}),
          ...(patch.command !== undefined ? { command: patch.command } : {}),
          ...(patch.args !== undefined ? { args: patch.args } : {}),
          ...(patch.env !== undefined
            ? { env: unmaskRecord(patch.env, existing.env) }
            : {}),
          ...(patch.url !== undefined ? { url: patch.url } : {}),
          ...(patch.headers !== undefined
            ? { headers: unmaskRecord(patch.headers, existing.headers) }
            : {}),
        };

        // Persist to config
        const fullConfig = configService.getConfig();
        const newServers = (fullConfig.mcpServers ?? []).map((s) =>
          s.id === id ? updated : s,
        );
        await configService.save({ ...fullConfig, mcpServers: newServers });

        return { server: toMcpServerRecord(updated, runtimeStatus(id)) };
      },
    );

    /**
     * DELETE /mcp/servers/:id
     *
     * Remove an MCP server config and disconnect if connected.
     */
    authRequired.delete(
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
    authRequired.post(
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
    authRequired.post(
      '/mcp/servers/:id/disconnect',
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
    authRequired.post<{
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
  }); // end authRequired plugin
}

/**
 * Create MCP routes plugin
 */
export function createMcpRoutesPlugin(options: McpRoutesOptions) {
  return async (fastify: FastifyInstance) => {
    await registerMcpRoutes(fastify, options);
  };
}
