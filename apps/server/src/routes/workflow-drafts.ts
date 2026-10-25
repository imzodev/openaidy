import type { FastifyPluginAsync } from 'fastify';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import type { WorkflowDraftService } from '../tasks/drafting/service';

export type WorkflowDraftRoutesOptions = {
  draftService: WorkflowDraftService;
  authMiddleware: AuthMiddleware;
};

function statusFor(code: string): number {
  switch (code) {
    case 'draft.empty':
      return 400;
    case 'draft.invalid':
      return 422;
    case 'draft.no_model':
      return 503;
    case 'draft.model_error':
      return 502;
    default:
      return 500;
  }
}

/**
 * POST /workflows/draft `{description}` — draft a workflow graph from a
 * sentence. Nothing is saved; the client shows it, then creates the
 * workflow with PUT /tasks/:id/graph.
 */
export const workflowDraftRoutes: FastifyPluginAsync<
  WorkflowDraftRoutesOptions
> = async (app, options) => {
  const { draftService, authMiddleware } = options;
  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.list' }),
  );

  app.post('/workflows/draft', async (request, reply) => {
    const description = (request.body as { description?: unknown } | undefined)
      ?.description;
    const result = await draftService.draft(
      typeof description === 'string' ? description : '',
    );
    if (result.ok) return result;
    reply.code(statusFor(result.error.code));
    return result;
  });
};
