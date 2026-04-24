import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SchedulerService } from '../scheduler/service';
import type { JobsStore, JobRunsStore, SessionsStore } from '@openaidy/db';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import type { ScheduleInput } from '../pulses/utils';
import { parseScheduleInput, jobToPulse } from '../pulses/utils';

/**
 * Validation schemas
 */
const createPulseSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  schedule: z.union([
    z.object({
      every: z.enum(['15m', '30m', '1h', '6h', '12h', '1d', '1w']),
    }),
    z.object({
      daily: z.object({
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59),
      }),
    }),
    z.object({
      cron: z.object({
        expression: z.string(),
        tz: z.string().optional(),
      }),
    }),
    z.object({
      at: z.string(),
    }),
  ]),
  agentId: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

const updatePulseSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  schedule: z
    .union([
      z.object({
        every: z.enum(['15m', '30m', '1h', '6h', '12h', '1d', '1w']),
      }),
      z.object({
        daily: z.object({
          hour: z.number().int().min(0).max(23),
          minute: z.number().int().min(0).max(59),
        }),
      }),
      z.object({
        cron: z.object({
          expression: z.string(),
          tz: z.string().optional(),
        }),
      }),
      z.object({
        at: z.string(),
      }),
    ])
    .optional(),
  status: z.enum(['active', 'paused']).optional(),
  agentId: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

const listPulsesSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Pulse routes options
 */
export type PulseRoutesOptions = {
  jobsRepo: JobsStore;
  jobRunsRepo: JobRunsStore;
  sessionsRepo: SessionsStore;
  schedulerService: SchedulerService;
  authMiddleware: AuthMiddleware;
};

/**
 * Convert API schedule format to ScheduleInput
 */
function toScheduleInput(
  schedule: z.infer<typeof createPulseSchema>['schedule'],
): ScheduleInput {
  if ('every' in schedule) {
    return { every: schedule.every };
  }
  if ('daily' in schedule) {
    return { daily: schedule.daily };
  }
  if ('cron' in schedule) {
    const result: ScheduleInput = { cron: schedule.cron.expression };
    if (schedule.cron.tz !== undefined) {
      (result as { cron: string; tz?: string }).tz = schedule.cron.tz;
    }
    return result;
  }
  if ('at' in schedule) {
    return { at: schedule.at };
  }
  throw new Error('Invalid schedule format');
}

/**
 * Pulse routes
 *
 * Provides REST API for managing pulses (scheduled AI tasks).
 */
export const pulseRoutes: FastifyPluginAsync<PulseRoutesOptions> = async (
  app,
  options,
) => {
  const {
    jobsRepo,
    jobRunsRepo,
    sessionsRepo,
    schedulerService,
    authMiddleware,
  } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: '*' }),
  );

  /**
   * POST /api/pulses
   * Create a new pulse
   */
  app.post('/api/pulses', async (request, reply) => {
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

    // If sessionId provided, verify session exists
    if (parsed.sessionId) {
      const session = await sessionsRepo.findById(parsed.sessionId);
      if (!session) {
        reply.code(404);
        return {
          error: 'session.not_found',
          message: 'Session not found',
        };
      }
    }

    // Parse schedule to get cron expression and next run time
    const scheduleInput = toScheduleInput(parsed.schedule);
    let parsedSchedule;
    try {
      parsedSchedule = parseScheduleInput(scheduleInput);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_schedule',
        message: error instanceof Error ? error.message : 'Invalid schedule',
      };
    }

    const createJobInput: Parameters<typeof jobsRepo.create>[0] = {
      type: parsedSchedule.type,
      targetType: 'isolated',
      payload: {
        message: parsed.prompt,
        agentId: parsed.agentId,
      },
      status: 'active',
      metadata: {
        kind: 'pulse',
        name: parsed.name,
      },
      nextRunAt: parsedSchedule.nextRunAt,
    };
    if (parsedSchedule.schedule !== undefined) {
      createJobInput.schedule = parsedSchedule.schedule;
    }
    if (parsedSchedule.cronExpression !== undefined) {
      createJobInput.cronExpression = parsedSchedule.cronExpression;
    }
    const job = await jobsRepo.create(createJobInput);

    reply.code(201);
    return { pulse: jobToPulse(job) };
  });

  /**
   * GET /api/pulses
   * List pulses with optional filters
   */
  app.get('/api/pulses', async (request, reply) => {
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

    // Fetch all jobs and filter by pulse type (metadata.kind === 'pulse')
    const listFilters: Parameters<typeof jobsRepo.list>[0] = { limit: 1000 };
    if (parsed.status !== undefined) {
      listFilters.status = parsed.status;
    }
    const allJobs = await jobsRepo.list(listFilters);

    // Filter to only pulses
    const pulses = allJobs.filter((job) => {
      const metadata = job.metadata as Record<string, unknown> | null;
      return metadata?.kind === 'pulse';
    });

    // Apply pagination
    const total = pulses.length;
    const paginatedPulses = pulses.slice(
      parsed.offset,
      parsed.offset + parsed.limit,
    );

    return {
      pulses: paginatedPulses.map(jobToPulse),
      total,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  });

  /**
   * GET /api/pulses/:id
   * Get pulse details
   */
  app.get('/api/pulses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const job = await jobsRepo.findById(id);
    if (!job) {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    const metadata = job.metadata as Record<string, unknown> | null;
    if (metadata?.kind !== 'pulse') {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    return { pulse: jobToPulse(job) };
  });

  /**
   * PATCH /api/pulses/:id
   * Update pulse (pause/resume, update name, prompt, schedule, etc.)
   */
  app.patch('/api/pulses/:id', async (request, reply) => {
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

    // Check pulse exists
    const existingJob = await jobsRepo.findById(id);
    if (!existingJob) {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    const existingMetadata = existingJob.metadata as Record<
      string,
      unknown
    > | null;
    if (existingMetadata?.kind !== 'pulse') {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    // Build updates
    const updates: {
      status?: 'active' | 'paused' | 'completed' | 'failed';
      metadata?: Record<string, unknown>;
      nextRunAt?: Date;
      cronExpression?: string;
      schedule?: Date;
    } = {};

    if (parsed.status !== undefined) {
      updates.status = parsed.status;
    }

    // Handle schedule update
    if (parsed.schedule !== undefined) {
      const scheduleInput = toScheduleInput(parsed.schedule);
      const parsedSchedule = parseScheduleInput(scheduleInput);
      if (parsedSchedule.cronExpression !== undefined) {
        updates.cronExpression = parsedSchedule.cronExpression;
      }
      if (parsedSchedule.schedule !== undefined) {
        updates.schedule = parsedSchedule.schedule;
      }
      updates.nextRunAt = parsedSchedule.nextRunAt;
    }

    // Handle metadata updates (name, prompt changes)
    if (parsed.name !== undefined || parsed.prompt !== undefined) {
      const newMetadata = { ...existingMetadata };
      if (parsed.name !== undefined) {
        newMetadata.name = parsed.name;
      }
      updates.metadata = newMetadata;
    }

    const updatedJob = await jobsRepo.update(id, updates);

    return { pulse: jobToPulse(updatedJob) };
  });

  /**
   * DELETE /api/pulses/:id
   * Delete pulse
   */
  app.delete('/api/pulses/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Check pulse exists
    const existingJob = await jobsRepo.findById(id);
    if (!existingJob) {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    const metadata = existingJob.metadata as Record<string, unknown> | null;
    if (metadata?.kind !== 'pulse') {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    await jobsRepo.delete(id);
    reply.code(204);
    return;
  });

  /**
   * POST /api/pulses/:id/trigger
   * Manually trigger pulse execution
   */
  app.post('/api/pulses/:id/trigger', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Check pulse exists
    const existingJob = await jobsRepo.findById(id);
    if (!existingJob) {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    const metadata = existingJob.metadata as Record<string, unknown> | null;
    if (metadata?.kind !== 'pulse') {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    try {
      const run = await schedulerService.triggerJob(id);
      const updatedRun = await jobRunsRepo.findById(run.id);
      return { run: updatedRun || run };
    } catch (error) {
      if (error instanceof Error && error.message === 'Job not found') {
        reply.code(404);
        return {
          error: 'pulse.not_found',
          message: 'Pulse not found',
        };
      }
      throw error;
    }
  });

  /**
   * GET /api/pulses/:id/history
   * List pulse execution history
   */
  app.get('/api/pulses/:id/history', async (request, reply) => {
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

    // Check pulse exists
    const existingJob = await jobsRepo.findById(id);
    if (!existingJob) {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    const metadata = existingJob.metadata as Record<string, unknown> | null;
    if (metadata?.kind !== 'pulse') {
      reply.code(404);
      return {
        error: 'pulse.not_found',
        message: 'Pulse not found',
      };
    }

    const runs = await jobRunsRepo.listByJob(id, {
      limit: parsed.limit,
      offset: parsed.offset,
    });

    const total = runs.length;

    return {
      runs,
      total,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  });
};

export default pulseRoutes;
