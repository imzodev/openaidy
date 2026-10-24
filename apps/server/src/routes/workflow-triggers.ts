import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MESSAGE_MATCH_TYPE_VALUES } from '@openaidy/shared-types';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import type { WorkflowTriggerService } from '../tasks/triggers/service';

export type WorkflowTriggerRoutesOptions = {
  triggerService: WorkflowTriggerService;
  authMiddleware: AuthMiddleware;
};

/** Largest webhook body accepted. */
const WEBHOOK_BODY_LIMIT = 256 * 1024;

const channelConfigSchema = z.object({
  channelId: z.string().min(1),
  match: z.object({
    type: z.enum(MESSAGE_MATCH_TYPE_VALUES),
    value: z.string().optional(),
  }),
  senders: z.array(z.string()).optional(),
  replyWithResult: z.boolean().optional(),
  ackText: z.string().optional(),
});

const createTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webhook'), name: z.string().optional() }),
  z.object({
    kind: z.literal('channel_message'),
    name: z.string().optional(),
    channel: channelConfigSchema,
  }),
]);

const updateTriggerSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  channel: channelConfigSchema.partial().optional(),
});

function statusFor(code: string): number {
  switch (code) {
    case 'task.not_found':
    case 'trigger.not_found':
      return 404;
    case 'trigger.unauthorized':
      return 401;
    case 'trigger.invalid':
    case 'validation.invalid_request':
      return 400;
    case 'workflow.already_running':
      return 409;
    case 'workflow.invalid_graph':
      return 422;
    case 'session.not_configured':
      return 503;
    default:
      return 500;
  }
}

function invalidRequest(error: z.ZodError) {
  return {
    ok: false as const,
    error: {
      code: 'validation.invalid_request',
      message: error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; '),
    },
  };
}

/**
 * Managing a workflow's triggers (signed-in users).
 */
export const workflowTriggerRoutes: FastifyPluginAsync<
  WorkflowTriggerRoutesOptions
> = async (app, options) => {
  const { triggerService, authMiddleware } = options;
  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.list' }),
  );

  /** GET /workflow-triggers?kind=webhook — every trigger, across workflows. */
  app.get('/workflow-triggers', async (request) => {
    const kind = (request.query as { kind?: string }).kind;
    const triggers = await triggerService.listAll(
      kind === 'webhook' || kind === 'channel_message' ? kind : undefined,
    );
    return { ok: true, data: triggers };
  });

  /** GET /tasks/:id/triggers */
  app.get('/tasks/:id/triggers', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await triggerService.listForTask(id);
    if (result.ok) return result;
    reply.code(statusFor(result.error.code));
    return result;
  });

  /**
   * POST /tasks/:id/triggers
   * `{kind:'webhook', name?}` → `{trigger, token}` (the token is only shown
   * now), or `{kind:'channel_message', name?, channel:{…}}` → trigger.
   */
  app.post('/tasks/:id/triggers', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = createTriggerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return invalidRequest(parsed.error);
    }
    const body = parsed.data;
    const result =
      body.kind === 'webhook'
        ? await triggerService.createWebhook(id, body.name)
        : await triggerService.createChannelTrigger(id, {
            ...(body.name ? { name: body.name } : {}),
            config: {
              channelId: body.channel.channelId,
              match: {
                type: body.channel.match.type,
                ...(body.channel.match.value !== undefined
                  ? { value: body.channel.match.value }
                  : {}),
              },
              ...(body.channel.senders
                ? { senders: body.channel.senders }
                : {}),
              replyWithResult: body.channel.replyWithResult ?? true,
              ...(body.channel.ackText !== undefined
                ? { ackText: body.channel.ackText }
                : {}),
            },
          });
    if (!result.ok) {
      reply.code(statusFor(result.error.code));
      return result;
    }
    reply.code(201);
    return result;
  });

  /** PATCH /workflow-triggers/:id — name, enabled, channel settings. */
  app.patch('/workflow-triggers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateTriggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return invalidRequest(parsed.error);
    }
    const { name, enabled, channel } = parsed.data;
    const result = await triggerService.update(id, {
      ...(name !== undefined ? { name } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(channel
        ? {
            channel: Object.fromEntries(
              Object.entries(channel).filter(([, v]) => v !== undefined),
            ),
          }
        : {}),
    });
    if (result.ok) return result;
    reply.code(statusFor(result.error.code));
    return result;
  });

  /** DELETE /workflow-triggers/:id */
  app.delete('/workflow-triggers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await triggerService.delete(id);
    if (result.ok) return result;
    reply.code(statusFor(result.error.code));
    return result;
  });

  /** POST /workflow-triggers/:id/regenerate-token — the old token stops working. */
  app.post(
    '/workflow-triggers/:id/regenerate-token',
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await triggerService.regenerateToken(id);
      if (result.ok) return result;
      reply.code(statusFor(result.error.code));
      return result;
    },
  );
};

/**
 * POST /hooks/:triggerId — the public webhook endpoint. Not behind the
 * login: the trigger's own token (`Authorization: Bearer <token>`, or
 * `?token=` for services that can't set headers) is the credential. Any
 * body is accepted (JSON, form, text) and becomes the run's input.
 */
export const webhookRoutes: FastifyPluginAsync<{
  triggerService: WorkflowTriggerService;
}> = async (app, options) => {
  const { triggerService } = options;

  // Encapsulated to this plugin: accept form posts and any other body as
  // text, so a webhook from any service starts the run.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );
  app.addContentTypeParser(
    '*',
    { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT },
    (_request, body, done) => done(null, body),
  );

  app.post(
    '/hooks/:triggerId',
    { bodyLimit: WEBHOOK_BODY_LIMIT },
    async (request, reply) => {
      const { triggerId } = request.params as { triggerId: string };
      const query = Object.fromEntries(
        Object.entries((request.query ?? {}) as Record<string, unknown>).map(
          ([k, v]) => [k, String(v)],
        ),
      );
      const header = request.headers.authorization;
      const token = header?.toLowerCase().startsWith('bearer ')
        ? header.slice(7).trim()
        : query['token'];

      const result = await triggerService.fireWebhook(triggerId, {
        token,
        contentType: request.headers['content-type'],
        body: request.body,
        query,
      });
      if (result.ok) {
        reply.code(202);
        return { ok: true, data: result.data };
      }
      reply.code(statusFor(result.error.code));
      return { ok: false, error: result.error };
    },
  );
};
