/**
 * Self-update routes (issue #456). Admin-scoped — updating replaces the running
 * binary and restarts the server.
 *
 *   GET  /update/check   — current vs. latest npm version + whether self-update is possible
 *   GET  /update/status  — in-memory state of any in-flight update
 *   POST /update         — trigger `npm install -g @openaidy/app@latest` + restart
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UpdateCheckResult, UpdateState } from '@openaidy/shared-types';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import type { UpdateService } from '../update/service';

const ADMIN_SCOPE = '*';

const triggerSchema = z.object({
  /** Optional explicit target; defaults to the latest published version. */
  version: z.string().min(1).optional(),
});

export type UpdateRoutesOptions = {
  updateService: UpdateService;
  authMiddleware: AuthMiddleware;
};

export const updateRoutes: FastifyPluginAsync<UpdateRoutesOptions> = async (
  app,
  opts,
) => {
  const { updateService } = opts;
  const adminAuth = requireAuth({
    authMiddleware: opts.authMiddleware,
    requiredScope: ADMIN_SCOPE,
  });

  app.get<{ Reply: UpdateCheckResult | { error: string; message: string } }>(
    '/update/check',
    { preHandler: adminAuth },
    async (_request, reply) => {
      try {
        return await updateService.check();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({
          error: 'UPDATE_CHECK_FAILED',
          message: `Unable to check for updates: ${message}`,
        });
      }
    },
  );

  app.get<{ Reply: UpdateState }>(
    '/update/status',
    { preHandler: adminAuth },
    async () => updateService.getState(),
  );

  app.post<{
    Body: unknown;
    Reply: UpdateState | { error: string; message: string };
  }>('/update', { preHandler: adminAuth }, async (request, reply) => {
    const parsed = triggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'version, if provided, must be a non-empty string',
      });
    }

    // Resolve the target version. When the caller doesn't pin one, ask the
    // registry for the latest and refuse if there's nothing newer to install.
    let targetVersion = parsed.data.version;
    if (!targetVersion) {
      let check: UpdateCheckResult;
      try {
        check = await updateService.check();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({
          error: 'UPDATE_CHECK_FAILED',
          message: `Unable to check for updates: ${message}`,
        });
      }
      if (!check.updateAvailable) {
        return reply.code(409).send({
          error: 'ALREADY_LATEST',
          message: `Already on the latest version (${check.currentVersion}).`,
        });
      }
      targetVersion = check.latestVersion;
    }

    const result = updateService.startUpdate(targetVersion);
    if (!result.ok) {
      if (result.reason === 'not-supported') {
        return reply.code(409).send({
          error: 'UPDATE_NOT_SUPPORTED',
          message:
            'This deployment cannot update itself. Update manually with: ' +
            'npm install -g @openaidy/app@latest && openaidy restart',
        });
      }
      return reply.code(409).send({
        error: 'UPDATE_IN_PROGRESS',
        message: 'An update is already in progress.',
      });
    }

    return reply.code(202).send(result.state);
  });
};
