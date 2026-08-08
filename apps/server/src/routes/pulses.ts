import type { FastifyPluginAsync } from 'fastify';
import type { JobsStore, JobRunsStore, SessionsStore } from '@openaidy/db';
import type { SessionMessageService } from '../sessions/service';
import { triggerPulseNow } from '../scheduler';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import { PulseService } from '../pulses/service.js';
import { createLogger } from '../lib/logger';
import {
  createPulseSchema,
  updatePulseSchema,
  listPulsesSchema,
  listRunsSchema,
  toScheduleInput,
} from '../pulses/schemas.js';

const log = createLogger('pulse-routes');

// ========================================
// Route options
// ========================================

export type PulseRoutesOptions = {
  jobsRepo: JobsStore;
  jobRunsRepo: JobRunsStore;
  sessionsRepo: SessionsStore;
  sessionMessageService: SessionMessageService;
  authMiddleware: AuthMiddleware;
};

// ========================================
// Routes
// ========================================

export const pulseRoutes: FastifyPluginAsync<PulseRoutesOptions> = async (
  app,
  options,
) => {
  const { authMiddleware } = options;

  const service = new PulseService(
    options.jobsRepo,
    options.jobRunsRepo,
    options.sessionsRepo,
  );

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: '*' }),
  );

  // POST /api/pulses
  app.post('/pulses', async (request, reply) => {
    let parsed;
    try {
      parsed = createPulseSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }

    try {
      const input: import('@openaidy/shared-types').CreatePulseInput = {
        name: parsed.name,
        prompt: parsed.prompt,
        schedule: toScheduleInput(parsed.schedule),
      };
      if (parsed.agentId != null) input.agentId = parsed.agentId;
      if (parsed.sessionId != null) input.sessionId = parsed.sessionId;
      const pulse = await service.createPulse(input);
      reply.code(201);
      return { pulse };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found')) {
        reply.code(404);
        return { error: 'session.not_found', message: msg };
      }
      if (msg.includes('Invalid schedule')) {
        reply.code(400);
        return { error: 'validation.invalid_schedule', message: msg };
      }
      throw error;
    }
  });

  // GET /api/pulses
  app.get('/pulses', async (request, reply) => {
    let parsed;
    try {
      parsed = listPulsesSchema.parse(request.query);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid query parameters',
      };
    }

    const listInput: import('@openaidy/shared-types').ListPulsesFilters = {
      limit: parsed.limit,
      offset: parsed.offset,
    };
    if (parsed.status !== undefined) {
      listInput.status = parsed.status;
    }
    const result = await service.listPulses(listInput);

    return {
      pulses: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  });

  // GET /api/pulses/:id
  app.get('/pulses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const pulse = await service.getPulse(id);
      return { pulse };
    } catch (error) {
      log.error('Failed to get pulse', error);
      reply.code(404);
      return { error: 'pulse.not_found', message: 'Pulse not found' };
    }
  });

  // PATCH /api/pulses/:id
  app.patch('/pulses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updatePulseSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }

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
      const pulse = await service.updatePulse(id, input);
      return { pulse };
    } catch (error) {
      log.error('Failed to update pulse', error);
      reply.code(404);
      return { error: 'pulse.not_found', message: 'Pulse not found' };
    }
  });

  // DELETE /api/pulses/:id
  app.delete('/pulses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await service.deletePulse(id);
      reply.code(204);
      return;
    } catch (error) {
      log.error('Failed to delete pulse', error);
      reply.code(404);
      return { error: 'pulse.not_found', message: 'Pulse not found' };
    }
  });

  // POST /api/pulses/:id/trigger
  app.post('/pulses/:id/trigger', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const run = await service.triggerPulse(id, (jobId) =>
        triggerPulseNow(jobId, {
          jobsRepo: options.jobsRepo,
          jobRunsRepo: options.jobRunsRepo,
          sessionsStore: options.sessionsRepo,
          sessionMessageService: options.sessionMessageService,
          logger: app.log,
        }),
      );
      const updatedRun = await options.jobRunsRepo.findById(run.id);
      return { run: updatedRun || run };
    } catch (error) {
      if (error instanceof Error && error.message === 'Job not found') {
        reply.code(404);
        return { error: 'pulse.not_found', message: 'Pulse not found' };
      }
      throw error;
    }
  });

  // GET /api/pulses/:id/history
  app.get('/pulses/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = listRunsSchema.parse(request.query);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid query parameters',
      };
    }

    try {
      const result = await service.getPulseHistory(id, {
        limit: parsed.limit,
        offset: parsed.offset,
      });
      return {
        runs: result.items,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      };
    } catch (error) {
      log.error('Failed to get pulse history', error);
      reply.code(404);
      return { error: 'pulse.not_found', message: 'Pulse not found' };
    }
  });
};

export default pulseRoutes;
