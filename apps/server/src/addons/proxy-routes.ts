import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Addon, TaskPriority } from '@openaidy/db';
import type { AddonProxyRoutesOptions, InvokeAgentBody } from './types';
import { createAddonProxyService } from '../addons/proxy';
import { AddonProxyAgentService } from './proxy-agent-service';
import { AddonStorageError } from './storage/engine';
import type { StorageParams } from './storage/engine';
import { PulseService } from '../pulses/service.js';
import { triggerPulseNow } from '../scheduler';
import {
  createPulseSchema,
  updatePulseSchema,
  listPulsesSchema,
  listRunsSchema,
  toScheduleInput,
} from '../pulses/schemas.js';
import { toStatusResponse } from '../channels/status.js';
import { WorkspaceError } from '../workspace';
import { AttachmentError, MAX_ATTACHMENT_BYTES } from '../attachments/service';
import { uploadAttachmentSchema } from '../routes/attachments';

/**
 * Cap for a single addon-shared workspace file. Same ceiling as
 * `MAX_ATTACHMENT_BYTES` — there's no principled reason for these to differ,
 * and keeping one number makes both limits easy to reason about together.
 */
const MAX_ADDON_WORKSPACE_FILE_BYTES = MAX_ATTACHMENT_BYTES;

/**
 * Base64 expands bytes by ~4/3; allow the JSON envelope on top of the
 * decoded-size limit enforced below (mirrors `UPLOAD_BODY_LIMIT` in
 * `routes/attachments.ts`).
 */
const ADDON_UPLOAD_BODY_LIMIT =
  Math.ceil(MAX_ADDON_WORKSPACE_FILE_BYTES * 1.4) + 64 * 1024;

// Extend FastifyRequest to include addon context
declare module 'fastify' {
  interface FastifyRequest {
    addonId: string | undefined;
    addonPermissions: string[] | undefined;
  }
}

/**
 * Addon proxy routes plugin
 */
export const addonProxyRoutes: FastifyPluginAsync<
  AddonProxyRoutesOptions
> = async (app, opts) => {
  const proxyService = createAddonProxyService(
    opts.addonService,
    opts.internalApiBaseUrl,
  );

  const addonAgentService = opts.sessionService
    ? new AddonProxyAgentService(opts.sessionService)
    : undefined;

  // Middleware to validate addon token
  const validateAddonToken = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const authHeader = request.headers.authorization ?? '';

    if (!authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
      });
    }

    const token = authHeader.slice(7);
    const tokenResult = await proxyService.validateToken(token);

    if (!tokenResult.valid) {
      return reply.code(401).send({
        error: 'INVALID_TOKEN',
        message: tokenResult.error ?? 'Invalid token',
      });
    }

    request.addonId = tokenResult.addonId;
    request.addonPermissions = tokenResult.permissions;
  };

  // POST /api/addon-proxy/agents/:agentId/invoke
  app.post<{
    Params: { agentId: string };
    Body: InvokeAgentBody;
  }>(
    '/addon-proxy/agents/:agentId/invoke',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const { agentId } = request.params;
      const { input, context: _context } = request.body;

      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'agents.invoke');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      if (!proxyService.hasAgentAccess(addon, agentId)) {
        return reply.code(403).send({
          error: 'AGENT_NOT_ALLOWED',
          message: `Access to agent ${agentId} not allowed`,
        });
      }

      await proxyService.recordUsage(
        request.addonId!,
        `/agents/${agentId}/invoke`,
      );

      if (!addonAgentService) {
        return reply.send({
          success: true,
          agentId,
          input,
          message: 'Agent invocation not available (no session service)',
        });
      }

      try {
        const result = await addonAgentService.invoke(
          request.addonId!,
          agentId,
          input,
        );

        if (!result.ok) {
          return reply.code(502).send({
            error: 'AGENT_ERROR',
            message: result.error.message,
            code: result.error.code,
          });
        }

        return reply.send({
          success: true,
          agentId,
          sessionId: result.sessionId,
          message: result.message,
        });
      } catch (err) {
        return reply.code(502).send({
          error: 'AGENT_INVOCATION_FAILED',
          message:
            err instanceof Error ? err.message : 'Agent invocation failed',
        });
      }
    },
  );

  // GET /api/addon-proxy/agents
  app.get(
    '/addon-proxy/agents',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'agents.list');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      await proxyService.recordUsage(request.addonId!, '/agents');

      if (!opts.agentRegistry) {
        return reply.send({ items: [] });
      }

      return reply.send({ items: opts.agentRegistry.listAgents() });
    },
  );

  // GET /api/addon-proxy/sessions
  app.get(
    '/addon-proxy/sessions',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'sessions.list');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      await proxyService.recordUsage(request.addonId!, '/sessions');

      if (!opts.sessionService) {
        return reply.send({ sessions: [] });
      }

      const sessions = await opts.sessionService.listSessions();
      return reply.send({ sessions });
    },
  );

  // POST /api/addon-proxy/sessions/:sessionId/messages
  app.post<{
    Params: { sessionId: string };
    Body: { content: string; agentId: string; attachmentIds?: string[] };
  }>(
    '/addon-proxy/sessions/:sessionId/messages',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'sessions.write');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      const { sessionId } = request.params;
      const { content, agentId, attachmentIds } = request.body;

      if (!content || !agentId) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'content and agentId are required',
        });
      }

      if (
        attachmentIds !== undefined &&
        (!Array.isArray(attachmentIds) ||
          attachmentIds.length > 10 ||
          attachmentIds.some((id) => typeof id !== 'string'))
      ) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'attachmentIds must be an array of at most 10 strings',
        });
      }

      await proxyService.recordUsage(
        request.addonId!,
        `/sessions/${sessionId}/messages`,
      );

      if (!opts.sessionService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Session service not available',
        });
      }

      const result = await opts.sessionService.submitMessageStreaming({
        sessionId,
        role: 'user',
        content,
        agentId,
        ...(attachmentIds !== undefined ? { attachmentIds } : {}),
        onStreamEvent: () => {},
      });

      if (!result.ok) {
        return reply.code(502).send({
          error: 'INVOKE_FAILED',
          message: result.error.message,
        });
      }

      return reply.code(201).send({
        message: result.assistantMessage.content,
        sessionId,
      });
    },
  );

  // POST /api/addon-proxy/sessions/:sessionId/attachments
  //
  // Upload an image/audio/video file for a pending message, exactly like the
  // human-facing `POST /sessions/:sessionId/attachments` in
  // `routes/attachments.ts` — same schema, same service call. The returned
  // id is unlinked until passed as one of `attachmentIds` on the messages
  // route above.
  app.post(
    '/addon-proxy/sessions/:sessionId/attachments',
    { preHandler: validateAddonToken, bodyLimit: ADDON_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'sessions.write');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      if (!opts.sessionService || !opts.attachmentService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Attachment service not available',
        });
      }

      const { sessionId } = request.params as { sessionId: string };

      const session = await opts.sessionService.getSession(sessionId);
      if (!session) {
        return reply
          .code(404)
          .send({ error: 'SESSION_NOT_FOUND', message: 'Session not found' });
      }

      let body: ReturnType<typeof uploadAttachmentSchema.parse>;
      try {
        body = uploadAttachmentSchema.parse(request.body);
      } catch (error) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      await proxyService.recordUsage(
        request.addonId!,
        `/sessions/${sessionId}/attachments`,
      );

      try {
        const attachment = await opts.attachmentService.saveUpload({
          sessionId,
          mimeType: body.mimeType,
          data: body.data,
          ...(body.name ? { name: body.name } : {}),
        });
        return reply.code(201).send({
          id: attachment.id,
          sessionId: attachment.sessionId,
          kind: attachment.kind,
          source: attachment.source,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          createdAt: attachment.createdAt,
        });
      } catch (error) {
        if (error instanceof AttachmentError) {
          return reply
            .code(
              error.code === 'FILE_TOO_LARGE'
                ? 413
                : error.code === 'UNSUPPORTED_MIME_TYPE'
                  ? 415
                  : 500,
            )
            .send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'ATTACHMENT_ERROR',
          message: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    },
  );

  // POST /api/addon-proxy/workspace/:agentId/files
  //
  // Write an arbitrary file (csv, txt, json, ...) into an agent's workspace
  // on the addon's behalf. The addon never gets a filesystem path — the
  // server resolves and validates it via `WorkspaceService.validatePath`
  // (through `writeBinaryFile`), the same guard used by the agent's own
  // workspace_write tool.
  app.post<{
    Params: { agentId: string };
    Body: { path: string; data: string };
  }>(
    '/addon-proxy/workspace/:agentId/files',
    { preHandler: validateAddonToken, bodyLimit: ADDON_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      const { agentId } = request.params;
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'workspace.write');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      if (!proxyService.hasWorkspaceAccess(addon, agentId)) {
        return reply.code(403).send({
          error: 'AGENT_NOT_ALLOWED',
          message: `Access to agent ${agentId}'s workspace not allowed`,
        });
      }

      if (!opts.workspaceService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Workspace service not available',
        });
      }

      const { path, data } = request.body ?? {};
      if (!path || !data) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'path and data are required',
        });
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(data, 'base64');
      } catch {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'data must be base64-encoded',
        });
      }

      if (
        buffer.length === 0 ||
        buffer.length > MAX_ADDON_WORKSPACE_FILE_BYTES
      ) {
        return reply.code(413).send({
          error: 'FILE_TOO_LARGE',
          message: `File must be between 1 byte and ${MAX_ADDON_WORKSPACE_FILE_BYTES} bytes`,
        });
      }

      await proxyService.recordUsage(
        request.addonId!,
        `/workspace/${agentId}/files`,
      );

      try {
        await opts.workspaceService.writeBinaryFile(agentId, path, buffer);
        return reply.code(201).send({ agentId, path });
      } catch (error) {
        if (error instanceof WorkspaceError) {
          return reply
            .code(error.code === 'PATH_TRAVERSAL_BLOCKED' ? 400 : 500)
            .send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'WRITE_FAILED',
          message: error instanceof Error ? error.message : 'Write failed',
        });
      }
    },
  );

  // GET /api/addon-proxy/config/:namespace
  app.get<{ Params: { namespace: string } }>(
    '/addon-proxy/config/:namespace',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const { namespace } = request.params;
      const addon = await opts.addonService.getAddon(request.addonId!);

      if (!addon) {
        return reply
          .code(404)
          .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      }

      const authResult = proxyService.authorize(addon, 'config.read');
      if (!authResult.authorized) {
        return reply
          .code(403)
          .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      }

      await proxyService.recordUsage(request.addonId!, `/config/${namespace}`);

      return reply.send({
        namespace,
        config: {},
        message: 'Config retrieval placeholder',
      });
    },
  );

  // ==========================================================================
  // Storage (per-addon SQLite) — /addon-proxy/storage/*
  // ==========================================================================
  //
  // The addon's own iframe reaches its private SQLite file through these
  // routes. Reads require `storage.read`, writes require `storage.write`. The
  // schema (manifest.storage.migrations) is applied lazily by the engine on
  // first open, so tables exist even if the UI has never run.

  const getMigrations = (manifest: unknown): string[] => {
    const m = manifest as { storage?: { migrations?: string[] } } | null;
    return m?.storage?.migrations ?? [];
  };

  /**
   * Resolve the addon + authorize a storage permission. Returns the addon's
   * migrations on success, or null after having sent the error response.
   */
  const forStorage = async (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: 'storage.read' | 'storage.write',
  ): Promise<{ migrations: string[] } | null> => {
    if (!opts.storageEngine) {
      reply.code(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Storage not available',
      });
      return null;
    }
    const addon = await opts.addonService.getAddon(request.addonId!);
    if (!addon) {
      reply
        .code(404)
        .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      return null;
    }
    const auth = proxyService.authorize(addon, permission);
    if (!auth.authorized) {
      reply.code(403).send({ error: 'PERMISSION_DENIED', message: auth.error });
      return null;
    }
    return { migrations: getMigrations(addon.manifest) };
  };

  /** Run a (synchronous) storage operation, mapping engine errors to HTTP. */
  const runStorage = (reply: FastifyReply, fn: () => unknown) => {
    try {
      return reply.send(fn());
    } catch (err) {
      if (err instanceof AddonStorageError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      return reply.code(500).send({
        error: 'STORAGE_ERROR',
        message: err instanceof Error ? err.message : 'Storage error',
      });
    }
  };

  // KV — list / get / set / delete
  app.get<{ Querystring: { prefix?: string } }>(
    '/addon-proxy/storage/kv',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv');
      return runStorage(reply, () => ({
        items: opts.storageEngine!.kvList(
          request.addonId!,
          ctx.migrations,
          request.query.prefix,
        ),
      }));
    },
  );

  app.get<{ Params: { key: string } }>(
    '/addon-proxy/storage/kv/:key',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv/:key');
      return runStorage(reply, () => ({
        value: opts.storageEngine!.kvGet(
          request.addonId!,
          ctx.migrations,
          request.params.key,
        ),
      }));
    },
  );

  app.put<{ Params: { key: string }; Body: { value: unknown } }>(
    '/addon-proxy/storage/kv/:key',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.write');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv/:key');
      return runStorage(reply, () => {
        opts.storageEngine!.kvSet(
          request.addonId!,
          ctx.migrations,
          request.params.key,
          request.body?.value,
        );
        return { ok: true };
      });
    },
  );

  app.delete<{ Params: { key: string } }>(
    '/addon-proxy/storage/kv/:key',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.write');
      if (!ctx) return;
      await proxyService.recordUsage(request.addonId!, '/storage/kv/:key');
      return runStorage(reply, () => ({
        deleted: opts.storageEngine!.kvDelete(
          request.addonId!,
          ctx.migrations,
          request.params.key,
        ),
      }));
    },
  );

  // Raw SQL — query (read) / exec (write)
  app.post<{ Body: { sql: string; params?: StorageParams } }>(
    '/addon-proxy/storage/query',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      const { sql, params } = request.body ?? {};
      if (typeof sql !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_REQUEST', message: 'sql is required' });
      }
      await proxyService.recordUsage(request.addonId!, '/storage/query');
      return runStorage(reply, () => ({
        rows: opts.storageEngine!.query(
          request.addonId!,
          ctx.migrations,
          sql,
          params,
        ),
      }));
    },
  );

  app.post<{ Body: { sql: string; params?: StorageParams } }>(
    '/addon-proxy/storage/exec',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.write');
      if (!ctx) return;
      const { sql, params } = request.body ?? {};
      if (typeof sql !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_REQUEST', message: 'sql is required' });
      }
      await proxyService.recordUsage(request.addonId!, '/storage/exec');
      return runStorage(reply, () =>
        opts.storageEngine!.exec(request.addonId!, ctx.migrations, sql, params),
      );
    },
  );

  // Full-text search over a declared FTS5 table
  app.post<{ Body: { table: string; match: string; limit?: number } }>(
    '/addon-proxy/storage/search',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const ctx = await forStorage(request, reply, 'storage.read');
      if (!ctx) return;
      const { table, match, limit } = request.body ?? {};
      if (typeof table !== 'string' || typeof match !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'table and match are required',
        });
      }
      await proxyService.recordUsage(request.addonId!, '/storage/search');
      return runStorage(reply, () => ({
        rows: opts.storageEngine!.search(
          request.addonId!,
          ctx.migrations,
          table,
          match,
          limit,
        ),
      }));
    },
  );

  // ==========================================================================
  // Shared helper for the routes below (tasks/pulses/channels) — resolve the
  // addon and check one permission, sending the 404/403 response itself on
  // failure. Mirrors `forStorage` above but permission-generic.
  // ==========================================================================
  const getAuthorizedAddon = async (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: string,
  ): Promise<Addon | null> => {
    const addon = await opts.addonService.getAddon(request.addonId!);
    if (!addon) {
      reply
        .code(404)
        .send({ error: 'ADDON_NOT_FOUND', message: 'Addon not found' });
      return null;
    }
    const authResult = proxyService.authorize(addon, permission);
    if (!authResult.authorized) {
      reply
        .code(403)
        .send({ error: 'PERMISSION_DENIED', message: authResult.error });
      return null;
    }
    return addon;
  };

  // ==========================================================================
  // Tasks — /addon-proxy/tasks/*
  // ==========================================================================
  //
  // Deliberately narrower than the web-facing /api/tasks surface: no agent
  // assignment, no scheduling, no subtask CRUD/execution-history — just
  // enough for an addon to create, read, and drive a task to completion.

  const TASK_STATUSES = [
    'backlog',
    'todo',
    'in_progress',
    'review',
    'done',
    'cancelled',
  ] as const;

  const createAddonTaskSchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().min(1),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  });

  const updateTaskStatusBodySchema = z.object({
    status: z.enum(TASK_STATUSES),
  });

  // GET /api/addon-proxy/tasks
  app.get<{ Querystring: { status?: string } }>(
    '/addon-proxy/tasks',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'tasks.list');
      if (!addon) return;
      if (!opts.taskService) return reply.send({ items: [] });

      await proxyService.recordUsage(request.addonId!, '/tasks');
      const status = request.query.status as
        | (typeof TASK_STATUSES)[number]
        | undefined;
      const items = await opts.taskService.listTasks(status);
      return reply.send({ items });
    },
  );

  // GET /api/addon-proxy/tasks/:id
  app.get<{ Params: { id: string } }>(
    '/addon-proxy/tasks/:id',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'tasks.read');
      if (!addon) return;
      if (!opts.taskService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Tasks not available',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/tasks/:id');
      const task = await opts.taskService.getTaskWithDetails(request.params.id);
      if (!task) {
        return reply
          .code(404)
          .send({ error: 'TASK_NOT_FOUND', message: 'Task not found' });
      }
      return reply.send({ task });
    },
  );

  // POST /api/addon-proxy/tasks
  app.post<{
    Body: { title?: string; description: string; priority?: string };
  }>(
    '/addon-proxy/tasks',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'tasks.write');
      if (!addon) return;
      if (!opts.taskService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Tasks not available',
        });
      }

      let parsed;
      try {
        parsed = createAddonTaskSchema.parse(request.body);
      } catch (error) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/tasks');
      const derivedTitle =
        parsed.title ??
        (parsed.description.length > 60
          ? `${parsed.description.slice(0, 60).trimEnd()}…`
          : parsed.description);

      const createInput: {
        title: string;
        description: string;
        priority?: TaskPriority;
      } = {
        title: derivedTitle,
        description: parsed.description,
      };
      if (parsed.priority !== undefined) {
        createInput.priority = parsed.priority as TaskPriority;
      }

      const result = await opts.taskService.createTask(createInput);
      if (!result.ok) {
        return reply
          .code(500)
          .send({ error: result.error.code, message: result.error.message });
      }
      return reply.code(201).send({ task: result.data });
    },
  );

  // PATCH /api/addon-proxy/tasks/:id/status
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/addon-proxy/tasks/:id/status',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'tasks.write');
      if (!addon) return;
      if (!opts.taskService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Tasks not available',
        });
      }

      let parsed;
      try {
        parsed = updateTaskStatusBodySchema.parse(request.body);
      } catch (error) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/tasks/:id/status');
      const result = await opts.taskService.updateTaskStatus(
        request.params.id,
        parsed.status,
      );
      if (!result.ok) {
        const status = result.error.code === 'task.not_found' ? 404 : 500;
        return reply
          .code(status)
          .send({ error: result.error.code, message: result.error.message });
      }
      return reply.send({ task: result.data });
    },
  );

  // GET /api/addon-proxy/tasks/:id/subtasks
  app.get<{ Params: { id: string } }>(
    '/addon-proxy/tasks/:id/subtasks',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'tasks.read');
      if (!addon) return;
      if (!opts.taskService) return reply.send({ items: [] });

      await proxyService.recordUsage(request.addonId!, '/tasks/:id/subtasks');
      const items = await opts.taskService.getSubtasks(request.params.id);
      return reply.send({ items });
    },
  );

  // POST /api/addon-proxy/tasks/:id/execute
  app.post<{ Params: { id: string } }>(
    '/addon-proxy/tasks/:id/execute',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'tasks.invoke');
      if (!addon) return;
      if (!opts.taskService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Tasks not available',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/tasks/:id/execute');
      const result = await opts.taskService.executeTask(request.params.id);
      if (!result.ok) {
        const status =
          result.error.code === 'task.not_found'
            ? 404
            : result.error.code === 'session.not_configured'
              ? 503
              : 500;
        return reply
          .code(status)
          .send({ error: result.error.code, message: result.error.message });
      }
      return reply.send({ sessionId: result.data.sessionId });
    },
  );

  // ==========================================================================
  // Pulses — /addon-proxy/pulses/*
  // ==========================================================================
  //
  // Full CRUD + trigger + history, mirroring `routes/pulses.ts` almost 1:1
  // (pulses are inherently an automation primitive addons should be able to
  // fully drive) — just gated behind addon permissions instead of user auth.

  const pulseService =
    opts.jobsRepo && opts.jobRunsRepo && opts.sessionsRepo
      ? new PulseService(opts.jobsRepo, opts.jobRunsRepo, opts.sessionsRepo)
      : undefined;

  // GET /api/addon-proxy/pulses
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/addon-proxy/pulses',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'pulses.list');
      if (!addon) return;
      if (!pulseService) {
        return reply.send({ pulses: [], total: 0, limit: 50, offset: 0 });
      }

      let parsed;
      try {
        parsed = listPulsesSchema.parse(request.query);
      } catch (error) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid query parameters',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/pulses');
      const listInput: import('@openaidy/shared-types').ListPulsesFilters = {
        limit: parsed.limit,
        offset: parsed.offset,
      };
      if (parsed.status !== undefined) listInput.status = parsed.status;
      const result = await pulseService.listPulses(listInput);
      return reply.send({
        pulses: result.items,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    },
  );

  // GET /api/addon-proxy/pulses/:id
  app.get<{ Params: { id: string } }>(
    '/addon-proxy/pulses/:id',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'pulses.read');
      if (!addon) return;
      if (!pulseService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Pulses not available',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/pulses/:id');
      try {
        const pulse = await pulseService.getPulse(request.params.id);
        return reply.send({ pulse });
      } catch {
        return reply
          .code(404)
          .send({ error: 'PULSE_NOT_FOUND', message: 'Pulse not found' });
      }
    },
  );

  // POST /api/addon-proxy/pulses
  app.post<{ Body: unknown }>(
    '/addon-proxy/pulses',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'pulses.write');
      if (!addon) return;
      if (!pulseService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Pulses not available',
        });
      }

      let parsed;
      try {
        parsed = createPulseSchema.parse(request.body);
      } catch (error) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/pulses');
      try {
        const input: import('@openaidy/shared-types').CreatePulseInput = {
          name: parsed.name,
          prompt: parsed.prompt,
          schedule: toScheduleInput(parsed.schedule),
        };
        if (parsed.agentId != null) input.agentId = parsed.agentId;
        if (parsed.sessionId != null) input.sessionId = parsed.sessionId;
        const pulse = await pulseService.createPulse(input);
        return reply.code(201).send({ pulse });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('not found')) {
          return reply
            .code(404)
            .send({ error: 'SESSION_NOT_FOUND', message: msg });
        }
        return reply
          .code(400)
          .send({ error: 'INVALID_SCHEDULE', message: msg });
      }
    },
  );

  // PATCH /api/addon-proxy/pulses/:id
  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/addon-proxy/pulses/:id',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'pulses.write');
      if (!addon) return;
      if (!pulseService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Pulses not available',
        });
      }

      let parsed;
      try {
        parsed = updatePulseSchema.parse(request.body);
      } catch (error) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid request body',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/pulses/:id');
      try {
        const input: import('@openaidy/shared-types').UpdatePulseInput = {};
        if (parsed.name !== undefined) input.name = parsed.name;
        if (parsed.prompt !== undefined) input.prompt = parsed.prompt;
        if (parsed.schedule !== undefined) {
          input.schedule = toScheduleInput(parsed.schedule);
        }
        if (parsed.status !== undefined) input.status = parsed.status;
        if (parsed.agentId !== undefined) input.agentId = parsed.agentId;
        if (parsed.sessionId !== undefined) input.sessionId = parsed.sessionId;
        const pulse = await pulseService.updatePulse(request.params.id, input);
        return reply.send({ pulse });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg === 'Pulse not found') {
          return reply
            .code(404)
            .send({ error: 'PULSE_NOT_FOUND', message: msg });
        }
        if (msg.includes('not found')) {
          return reply
            .code(404)
            .send({ error: 'SESSION_NOT_FOUND', message: msg });
        }
        return reply
          .code(400)
          .send({ error: 'INVALID_SCHEDULE', message: msg });
      }
    },
  );

  // DELETE /api/addon-proxy/pulses/:id
  app.delete<{ Params: { id: string } }>(
    '/addon-proxy/pulses/:id',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'pulses.delete');
      if (!addon) return;
      if (!pulseService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Pulses not available',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/pulses/:id');
      try {
        await pulseService.deletePulse(request.params.id);
        return reply.code(204).send();
      } catch {
        return reply
          .code(404)
          .send({ error: 'PULSE_NOT_FOUND', message: 'Pulse not found' });
      }
    },
  );

  // POST /api/addon-proxy/pulses/:id/trigger
  app.post<{ Params: { id: string } }>(
    '/addon-proxy/pulses/:id/trigger',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'pulses.invoke');
      if (!addon) return;
      const { jobsRepo, jobRunsRepo, sessionsRepo, sessionService } = opts;
      if (
        !pulseService ||
        !jobsRepo ||
        !jobRunsRepo ||
        !sessionsRepo ||
        !sessionService
      ) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Pulses not available',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/pulses/:id/trigger');
      try {
        const run = await pulseService.triggerPulse(
          request.params.id,
          (jobId) =>
            triggerPulseNow(jobId, {
              jobsRepo,
              jobRunsRepo,
              sessionsStore: sessionsRepo,
              sessionMessageService: sessionService,
              logger: app.log,
            }),
        );
        const updatedRun = await jobRunsRepo.findById(run.id);
        return reply.send({ run: updatedRun ?? run });
      } catch (error) {
        if (error instanceof Error && error.message === 'Job not found') {
          return reply
            .code(404)
            .send({ error: 'PULSE_NOT_FOUND', message: 'Pulse not found' });
        }
        return reply.code(500).send({
          error: 'PULSE_TRIGGER_FAILED',
          message: error instanceof Error ? error.message : 'Trigger failed',
        });
      }
    },
  );

  // GET /api/addon-proxy/pulses/:id/history
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    '/addon-proxy/pulses/:id/history',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'pulses.read');
      if (!addon) return;
      if (!pulseService) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Pulses not available',
        });
      }

      let parsed;
      try {
        parsed = listRunsSchema.parse(request.query);
      } catch (error) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message:
            error instanceof Error ? error.message : 'Invalid query parameters',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/pulses/:id/history');
      try {
        const result = await pulseService.getPulseHistory(request.params.id, {
          limit: parsed.limit,
          offset: parsed.offset,
        });
        return reply.send({
          runs: result.items,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        });
      } catch {
        return reply
          .code(404)
          .send({ error: 'PULSE_NOT_FOUND', message: 'Pulse not found' });
      }
    },
  );

  // ==========================================================================
  // Channels — /addon-proxy/channels/* (read-only + connect/disconnect)
  // ==========================================================================
  //
  // No outbound "send a message" capability exists anywhere in the codebase
  // yet — channels are purely reactive. Mirrors `routes/channels.ts` exactly.

  // GET /api/addon-proxy/channels
  app.get(
    '/addon-proxy/channels',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'channels.list');
      if (!addon) return;
      if (!opts.channelRegistry) return reply.send({ items: [] });

      await proxyService.recordUsage(request.addonId!, '/channels');
      const items = opts.channelRegistry.getAll().map(toStatusResponse);
      return reply.send({ items });
    },
  );

  // GET /api/addon-proxy/channels/:id/status
  app.get<{ Params: { id: string } }>(
    '/addon-proxy/channels/:id/status',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'channels.read');
      if (!addon) return;
      if (!opts.channelRegistry) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Channels not available',
        });
      }

      await proxyService.recordUsage(request.addonId!, '/channels/:id/status');
      const channel = opts.channelRegistry.get(request.params.id);
      if (!channel) {
        return reply
          .code(404)
          .send({ error: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
      }
      return reply.send(toStatusResponse(channel));
    },
  );

  // POST /api/addon-proxy/channels/:id/connect
  app.post<{ Params: { id: string } }>(
    '/addon-proxy/channels/:id/connect',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'channels.manage');
      if (!addon) return;
      if (!opts.channelRegistry) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Channels not available',
        });
      }

      const channel = opts.channelRegistry.get(request.params.id);
      if (!channel) {
        return reply
          .code(404)
          .send({ error: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
      }

      await proxyService.recordUsage(request.addonId!, '/channels/:id/connect');
      // Fire-and-forget — connect() is async and may take time (QR flow).
      channel.connect().catch((err) => {
        app.log.error(
          { err, channelId: request.params.id },
          'addon channel connect error',
        );
      });
      return reply.code(204).send();
    },
  );

  // POST /api/addon-proxy/channels/:id/disconnect
  app.post<{ Params: { id: string } }>(
    '/addon-proxy/channels/:id/disconnect',
    { preHandler: validateAddonToken },
    async (request, reply) => {
      const addon = await getAuthorizedAddon(request, reply, 'channels.manage');
      if (!addon) return;
      if (!opts.channelRegistry) {
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Channels not available',
        });
      }

      const channel = opts.channelRegistry.get(request.params.id);
      if (!channel) {
        return reply
          .code(404)
          .send({ error: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
      }

      await proxyService.recordUsage(
        request.addonId!,
        '/channels/:id/disconnect',
      );
      await channel.disconnect();
      return reply.code(204).send();
    },
  );

  // Health check
  app.get('/addon-proxy/health', async (_, reply) => {
    return reply.send({ status: 'ok' });
  });
};
