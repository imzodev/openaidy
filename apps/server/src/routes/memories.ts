import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { MemoriesStore } from '@openaidy/db';
import type { UpdateMemoryInput } from '@openaidy/shared-types';
import type { AgentRegistry } from '../agents/registry';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';

/**
 * Memory routes options.
 *
 * Memories are otherwise only touched by agent builtin tools; these routes
 * expose them for the management UI (browse / search / create / edit / delete).
 */
export type MemoryRoutesOptions = {
  memoriesRepo: MemoriesStore;
  agentRegistry: AgentRegistry;
  authMiddleware: AuthMiddleware;
};

const importanceSchema = z.number().int().min(1).max(5);

const createMemorySchema = z.object({
  agentId: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  importance: importanceSchema.optional(),
});

const updateMemorySchema = z
  .object({
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    tags: z.array(z.string()).optional(),
    importance: importanceSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one field must be provided',
  });

const listQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (
  app,
  { memoriesRepo, agentRegistry, authMiddleware },
) => {
  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'agents.list' }),
  );

  /**
   * GET /memories/agents
   * Agents paired with their memory counts, for the left-rail selector.
   * Includes agents with zero memories, plus any orphaned agentIds that still
   * own memories but are no longer registered.
   */
  app.get('/memories/agents', async () => {
    const counts = await memoriesRepo.countByAgent();
    const items = agentRegistry.listAllAgents().map((agent) => ({
      id: agent.id,
      name: agent.name,
      count: counts[agent.id] ?? 0,
    }));

    const known = new Set(items.map((a) => a.id));
    for (const [agentId, count] of Object.entries(counts)) {
      if (!known.has(agentId)) {
        items.push({ id: agentId, name: agentId, count });
      }
    }

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { items, total };
  });

  /**
   * GET /memories?agentId=&q=&limit=
   * List memories (optionally scoped to an agent), or full-text search when
   * `q` is provided. Results are wrapped in `{ items }`.
   */
  app.get('/memories', async (request, reply) => {
    let query;
    try {
      query = listQuerySchema.parse(request.query);
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : 'Invalid query parameters',
      };
    }

    const term = query.q?.trim();
    const items = term
      ? await memoriesRepo.search(term, query.agentId, query.limit)
      : await memoriesRepo.list(query.agentId, query.limit);

    return { items };
  });

  /**
   * POST /memories
   * Create a memory for a given agent.
   * Body: { agentId, title, content, tags?, importance? }
   */
  app.post('/memories', async (request, reply) => {
    let body;
    try {
      body = createMemorySchema.parse(request.body);
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : 'Invalid request body',
      };
    }

    if (!agentRegistry.hasAgent(body.agentId)) {
      reply.code(400);
      return { error: 'Unknown agent', agentId: body.agentId };
    }

    // Build explicitly so absent optionals are omitted rather than set to
    // `undefined` (exactOptionalPropertyTypes).
    const memory = await memoriesRepo.create({
      agentId: body.agentId,
      title: body.title,
      content: body.content,
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.importance !== undefined ? { importance: body.importance } : {}),
    });
    reply.code(201);
    return memory;
  });

  /**
   * PATCH /memories/:id
   * Update a memory. Body is a partial: { title?, content?, tags?, importance? }
   */
  app.patch('/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updateMemorySchema.parse(request.body);
    } catch (err) {
      reply.code(400);
      return {
        error: err instanceof Error ? err.message : 'Invalid request body',
      };
    }

    // Only carry through the fields that were actually provided.
    const patch: UpdateMemoryInput = {};
    if (parsed.title !== undefined) patch.title = parsed.title;
    if (parsed.content !== undefined) patch.content = parsed.content;
    if (parsed.tags !== undefined) patch.tags = parsed.tags;
    if (parsed.importance !== undefined) patch.importance = parsed.importance;

    const updated = await memoriesRepo.update(id, patch);
    if (!updated) {
      reply.code(404);
      return { error: 'Memory not found', id };
    }
    return updated;
  });

  /**
   * DELETE /memories/:id
   * Delete a memory by ID.
   */
  app.delete('/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await memoriesRepo.delete(id);
    if (!deleted) {
      reply.code(404);
      return { error: 'Memory not found', id };
    }
    return { deleted };
  });
};
