/**
 * MCP Server Routes
 *
 * REST API endpoints for MCP server lifecycle management:
 * - Config CRUD (stored in config/openaidy.json)
 * - Runtime connect/disconnect
 * - Tool discovery
 * - One-shot inline-secret migration (issue #401)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { McpClientService } from '../mcp/client';
import type { AppConfigService } from '../config/service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { McpServerConfig, McpSecretValue } from '@openaidy/config';
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
import {
  encryptSecret,
  ensureEncryptionKey,
  isEncryptedSecret,
} from '../mcp/secret-crypto';
import { migrateAllInlineSecrets } from '../mcp/migrate-secrets';

/**
 * Managing MCP servers means running arbitrary local processes (stdio) or
 * dialling out with stored credentials (http), so all write/lifecycle
 * operations require the admin scope — matching access-token and addon
 * management.
 */
const ADMIN_SCOPE = '*';

/**
 * JSON schema for a single `env`/`headers` value: a legacy plain string
 * (backward-compatible with existing configs and import formats), or the
 * structured `{ kind, value }` shape the MCP form UI sends — `kind: 'env'`
 * for a `${VAR}` reference, `kind: 'inline'` for a secret encrypted at rest.
 */
const secretValueSchema = {
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      required: ['kind', 'value'],
      properties: {
        kind: { type: 'string', enum: ['env', 'inline'] },
        value: { type: 'string' },
      },
    },
  ],
};

/**
 * Result of validating that any newly-supplied inline secret in a request
 * can actually be encrypted by the current process. {@link ensureEncryptionKey}
 * surfaces most failures (no master key, unwritable key file) at startup;
 * this probe catches anything that slipped past — and doubles as a smoke
 * test of the full encrypt path so a misconfigured `CREDENTIALS_MASTER_KEY`
 * override fails the request cleanly rather than on the way to disk.
 */
type InlineEncryptionCheck =
  | {
      ok: true;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
      message: string;
    };

/**
 * Verify the at-rest encryption pipeline can encrypt a fresh inline secret.
 * Only call this for payloads that *introduce* new inline values (so a
 * pure-placeholder patch is never blocked by a transient crypto outage).
 */
function ensureInlineEncryptionAvailable(): InlineEncryptionCheck {
  try {
    ensureEncryptionKey();
    // Round-trip a probe value — catches cases where the master key exists
    // but AES-256-GCM is unavailable (e.g. a stripped Node build).
    const probe = encryptSecret('__openaidy_probe__');
    if (!isEncryptedSecret(probe)) {
      return {
        ok: false,
        statusCode: 500,
        error: 'ENCRYPTION_UNAVAILABLE',
        message:
          'Inline-secret encryption is misconfigured: encrypt() did not produce the expected prefix',
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      statusCode: 503,
      error: 'ENCRYPTION_UNAVAILABLE',
      message: `Could not initialise at-rest encryption for inline MCP secrets: ${
        error instanceof Error ? error.message : String(error)
      }. Set CREDENTIALS_MASTER_KEY or ensure OPENAIDY_HOME is writable.`,
    };
  }
}

/**
 * Whether a patch actually introduces a *new* inline secret (one that
 * needs encrypting). An incoming `{ kind: 'inline', value: MASKED_VALUE }`
 * is not new — it's the client echoing back the redacted display — and
 * a legacy plain string that passes the `isSafeToShow` heuristic is
 * stored as a plain env reference. Only "needs encrypt" patches require
 * the encryption service to be live.
 */
function patchIntroducesNewInlineSecret(
  record: Record<string, McpSecretValue> | undefined,
): boolean {
  if (!record) return false;
  for (const value of Object.values(record)) {
    if (typeof value === 'string') {
      // Legacy plain string that would be normalized to inline. Skip if
      // the string is purely a ${VAR} reference — those stay plaintext.
      if (/\$\{[^}]+\}/.test(value.trim())) {
        const literal = value.trim().replace(/\$\{[^}]+\}/g, ' ');
        if (/^[A-Za-z \t-]*$/.test(literal)) continue;
      }
      return true;
    }
    if (value.kind === 'inline' && value.value !== '••••••') {
      return true;
    }
  }
  return false;
}

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
   * into an API record. Also reports any `${VAR}` secrets the server still
   * needs (so the UI can flag it as "awaiting configuration" rather than a
   * plain disconnected server).
   */
  const runtimeStatus = (config: McpServerConfig): McpRuntimeStatus => {
    const connected = mcpService.isConnected(config.id);
    const tools = connected
      ? mcpService.getTools(config.id).map((t) => ({
          name: t.name,
          description: t.description,
        }))
      : [];
    return {
      connected,
      tools,
      missingSecrets: mcpService.missingSecrets(config),
    };
  };

  /**
   * Connect a freshly saved/imported server unless it's still awaiting its
   * secrets. A server with unresolved `${VAR}` placeholders (e.g. a
   * preinstalled GitHub server before the user pastes a token) is left
   * disconnected without a warning — that's an awaiting-configuration state,
   * not a failure. `failureContext` is the log message used only when a
   * genuinely-configured server fails to connect.
   */
  const connectIfReady = async (
    serverConfig: McpServerConfig,
    failureContext: string,
  ): Promise<void> => {
    if (mcpService.missingSecrets(serverConfig).length > 0) {
      return;
    }
    try {
      await mcpService.connect(serverConfig);
    } catch (error) {
      fastify.log.warn(
        {
          serverId: serverConfig.id,
          err: error instanceof Error ? error.message : String(error),
        },
        failureContext,
      );
    }
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
          toMcpServerRecord(serverConfig, runtimeStatus(serverConfig)),
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

      return {
        server: toMcpServerRecord(serverConfig, runtimeStatus(serverConfig)),
      };
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
                    additionalProperties: secretValueSchema,
                  },
                  url: { type: 'string' },
                  headers: {
                    type: 'object',
                    additionalProperties: secretValueSchema,
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

        // Fail fast (with a clean 503) if this request introduces inline
        // secrets but encryption is unavailable — better than crashing in
        // encryptSecret() halfway through the save.
        if (
          patchIntroducesNewInlineSecret(config.env) ||
          patchIntroducesNewInlineSecret(config.headers)
        ) {
          const check = ensureInlineEncryptionAvailable();
          if (!check.ok) {
            return reply.status(check.statusCode).send({
              error: check.error,
              message: check.message,
            });
          }
        }

        // Route env/headers through unmaskRecord (no existing record to
        // merge against) so any inline secrets are encrypted before they
        // ever reach disk.
        const newConfig: McpServerConfig = {
          ...(config as McpServerConfig),
          env: unmaskRecord(config.env, undefined),
          headers: unmaskRecord(config.headers, undefined),
        };

        // Persist to config
        const fullConfig = configService.getConfig();
        const newServers = [...(fullConfig.mcpServers ?? []), newConfig];
        await configService.save({ ...fullConfig, mcpServers: newServers });

        // Connect now unless the server is still awaiting its secrets (a
        // server with unset ${VAR} placeholders isn't broken, just
        // unconfigured — so no connection is attempted and no warning logged).
        await connectIfReady(
          newConfig,
          'MCP server saved but initial connection failed',
        );

        return reply.status(201).send({
          server: toMcpServerRecord(newConfig, runtimeStatus(newConfig)),
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
                      additionalProperties: secretValueSchema,
                    },
                    url: { type: 'string' },
                    headers: {
                      type: 'object',
                      additionalProperties: secretValueSchema,
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
        let normalized;
        try {
          normalized = normalizeMcpServerMap(request.body.mcpServers);
        } catch (error) {
          if (error instanceof McpConfigImportError) {
            return reply
              .status(400)
              .send({ error: 'INVALID_CONFIG', message: error.message });
          }
          throw error;
        }

        // Same fast-fail guard as POST/PATCH: if any imported server
        // introduces an inline secret but encryption is unavailable, return
        // a clean 503 instead of letting encryptSecret() crash mid-import.
        const anyNewInlineSecret = normalized.some(
          (s) =>
            patchIntroducesNewInlineSecret(s.env) ||
            patchIntroducesNewInlineSecret(s.headers),
        );
        if (anyNewInlineSecret) {
          const check = ensureInlineEncryptionAvailable();
          if (!check.ok) {
            return reply.status(check.statusCode).send({
              error: check.error,
              message: check.message,
            });
          }
        }

        // Imported configs use the plain-string wire format (Claude Desktop
        // / VS Code / Cursor). Route env/headers through unmaskRecord so an
        // inlined credential pasted straight into the import JSON — the
        // exact scenario from issue #401 — is encrypted before it ever
        // reaches disk, same as the structured form UI.
        const servers: McpServerConfig[] = normalized.map((server) => ({
          ...server,
          env: unmaskRecord(server.env, undefined),
          headers: unmaskRecord(server.headers, undefined),
        }));

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

        // Connect each (non-fatal), skipping any still awaiting secrets, then
        // build redacted records. An imported server that references an unset
        // ${VAR} (e.g. a token the user hasn't pasted yet) is saved and
        // reported as awaiting configuration rather than a failed connection.
        const records = [];
        for (const serverConfig of servers) {
          await connectIfReady(
            serverConfig,
            'MCP server imported but initial connection failed',
          );
          records.push(
            toMcpServerRecord(serverConfig, runtimeStatus(serverConfig)),
          );
        }

        return reply.status(201).send({ servers: records });
      },
    );

    /**
     * POST /mcp/servers/migrate-secrets
     *
     * One-shot migration: walk every persisted MCP server's env/headers
     * and encrypt plaintext inline secrets in-place (issue #401). Idempotent
     * — re-running on an already-migrated config is a no-op. With
     * `dryRun: true` returns the plan without writing.
     *
     * Wired to the `openaidy mcp migrate-secrets` CLI command and also
     * callable by any admin tool. Returns the per-server plan so the CLI
     * can show what changed.
     */
    authRequired.post<{
      Body: { dryRun?: boolean };
    }>(
      '/mcp/servers/migrate-secrets',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              dryRun: { type: 'boolean', default: false },
            },
          },
        },
      },
      async (
        request: FastifyRequest<{ Body: { dryRun?: boolean } }>,
        reply: FastifyReply,
      ) => {
        const dryRun = request.body?.dryRun === true;
        try {
          const report = await migrateAllInlineSecrets({
            configService,
            dryRun,
          });
          return reply.send({ ...report, dryRun });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          return reply.status(500).send({
            error: 'MIGRATION_FAILED',
            message: `Failed to migrate inline secrets: ${message}`,
          });
        }
      },
    );

    /**
     * PUT /mcp/secrets/:name
     *
     * Paste-a-key entry point: stores a single named secret (e.g.
     * `NOTION_TOKEN`) encrypted at rest, resolved into any server's `${VAR}`
     * placeholder that references it (see `mcp/placeholder-resolver.ts`).
     * Deliberately decoupled from any one server's `env`/`headers` config —
     * a preinstalled server's template string never needs editing, and the
     * user never chooses a storage mechanism, they just paste the key.
     * Attempts to connect any server that becomes fully configured as a
     * result.
     */
    authRequired.put<{
      Params: { name: string };
      Body: { value: string };
    }>(
      '/mcp/secrets/:name',
      {
        schema: {
          params: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string', minLength: 1 } },
          },
          body: {
            type: 'object',
            required: ['value'],
            properties: { value: { type: 'string', minLength: 1 } },
          },
        },
      },
      async (
        request: FastifyRequest<{
          Params: { name: string };
          Body: { value: string };
        }>,
        reply: FastifyReply,
      ) => {
        const check = ensureInlineEncryptionAvailable();
        if (!check.ok) {
          return reply.status(check.statusCode).send({
            error: check.error,
            message: check.message,
          });
        }

        const { name } = request.params;
        await configService.setMcpSecret(name, request.body.value);

        for (const server of configService.getMcpServers()) {
          await connectIfReady(
            server,
            `Failed to connect MCP server "${server.id}" after setting secret "${name}"`,
          );
        }

        return reply.send({ name });
      },
    );

    /**
     * DELETE /mcp/secrets/:name
     *
     * Clears a named secret. Any server relying solely on it (no matching
     * process environment variable) reverts to "awaiting configuration" on
     * its next connection attempt.
     */
    authRequired.delete<{ Params: { name: string } }>(
      '/mcp/secrets/:name',
      {
        schema: {
          params: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string', minLength: 1 } },
          },
        },
      },
      async (
        request: FastifyRequest<{ Params: { name: string } }>,
        reply: FastifyReply,
      ) => {
        await configService.deleteMcpSecret(request.params.name);
        return reply.status(204).send();
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
              env: { type: 'object', additionalProperties: secretValueSchema },
              url: { type: 'string' },
              headers: {
                type: 'object',
                additionalProperties: secretValueSchema,
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

        // Same fast-fail guard as POST: only when the patch actually
        // introduces a new inline secret (so a pure-${VAR} patch or a
        // MASKED_VALUE echo isn't blocked by a transient crypto outage).
        if (
          patchIntroducesNewInlineSecret(patch.env) ||
          patchIntroducesNewInlineSecret(patch.headers)
        ) {
          const check = ensureInlineEncryptionAvailable();
          if (!check.ok) {
            return reply.status(check.statusCode).send({
              error: check.error,
              message: check.message,
            });
          }
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

        return { server: toMcpServerRecord(updated, runtimeStatus(updated)) };
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
