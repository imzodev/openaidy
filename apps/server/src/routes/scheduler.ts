import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SchedulerService } from '../scheduler/service';
import type { JobsStore, JobRunsStore, SessionsStore } from '@openaidy/db';
import {
  validateCronExpression,
  calculateNextRun,
} from '../scheduler/cron-utils';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';

/**
 * Validation schemas
 */
const createJobSchema = z
  .object({
    type: z.enum(['one-shot', 'cron']),
    schedule: z.string().datetime().optional(),
    cronExpression: z.string().optional(),
    targetType: z.enum(['session', 'isolated']),
    targetSessionId: z.string().uuid().optional(),
    payload: z.record(z.unknown()),
    maxRetries: z.number().int().min(0).optional(),
    backoffMs: z.number().int().positive().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'one-shot') return !!data.schedule;
      if (data.type === 'cron') return !!data.cronExpression;
      return false;
    },
    {
      message:
        'one-shot jobs require schedule, cron jobs require cronExpression',
    },
  )
  .refine(
    (data) => {
      if (data.targetType === 'session') return !!data.targetSessionId;
      return true;
    },
    { message: 'session jobs require targetSessionId' },
  );

const updateJobSchema = z
  .object({
    status: z.enum(['active', 'paused']).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((data) => data.status !== undefined || data.metadata !== undefined, {
    message: 'At least one field must be provided',
  });

const listJobsSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'failed']).optional(),
  type: z.enum(['one-shot', 'cron']).optional(),
  targetType: z.enum(['session', 'isolated']).optional(),
  targetSessionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Scheduler routes options
 */
export type SchedulerRoutesOptions = {
  schedulerService: SchedulerService;
  jobsRepo: JobsStore;
  jobRunsRepo: JobRunsStore;
  sessionsRepo: SessionsStore;
  authMiddleware: AuthMiddleware;
};

/**
 * Scheduler routes
 *
 * Provides REST API for managing scheduled jobs and viewing execution history.
 */
export const schedulerRoutes: FastifyPluginAsync<
  SchedulerRoutesOptions
> = async (app, options) => {
  const {
    schedulerService,
    jobsRepo,
    jobRunsRepo,
    sessionsRepo,
    authMiddleware,
  } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: '*' }),
  );

  /**
   * POST /api/jobs
   * Create a new scheduled job
   */
  app.post('/api/jobs', async (request, reply) => {
    let parsed;
    try {
      parsed = createJobSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }

    // Validate cron expression if cron job
    if (parsed.type === 'cron') {
      try {
        validateCronExpression(parsed.cronExpression!);
      } catch (error) {
        reply.code(400);
        return {
          error: 'validation.invalid_cron',
          message:
            error instanceof Error ? error.message : 'Invalid cron expression',
        };
      }
    }

    // Validate session exists if session job
    if (parsed.targetType === 'session') {
      const session = await sessionsRepo.findById(parsed.targetSessionId!);
      if (!session) {
        reply.code(404);
        return {
          error: 'session.not_found',
          message: 'Session not found',
        };
      }
    }

    // Calculate nextRunAt
    let nextRunAt: Date;
    try {
      nextRunAt =
        parsed.type === 'one-shot'
          ? new Date(parsed.schedule!)
          : calculateNextRun(parsed.cronExpression!, new Date());
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_schedule',
        message: error instanceof Error ? error.message : 'Invalid schedule',
      };
    }

    const createInput: {
      type: 'one-shot' | 'cron';
      schedule?: Date;
      cronExpression?: string;
      targetType: 'session' | 'isolated';
      targetSessionId?: string;
      payload: Record<string, unknown>;
      status: 'active';
      maxRetries?: number;
      backoffMs?: number;
      metadata?: Record<string, unknown>;
      nextRunAt: Date;
    } = {
      type: parsed.type,
      targetType: parsed.targetType,
      payload: parsed.payload,
      status: 'active',
      nextRunAt,
    };

    if (parsed.type === 'one-shot') {
      createInput.schedule = new Date(parsed.schedule!);
    }

    if (parsed.type === 'cron') {
      createInput.cronExpression = parsed.cronExpression!;
    }

    if (parsed.targetSessionId !== undefined) {
      createInput.targetSessionId = parsed.targetSessionId;
    }

    if (parsed.maxRetries !== undefined) {
      createInput.maxRetries = parsed.maxRetries;
    }

    if (parsed.backoffMs !== undefined) {
      createInput.backoffMs = parsed.backoffMs;
    }

    if (parsed.metadata !== undefined) {
      createInput.metadata = parsed.metadata;
    }

    const job = await jobsRepo.create(createInput);

    reply.code(201);
    return job;
  });

  /**
   * GET /api/jobs
   * List jobs with optional filters
   */
  app.get('/api/jobs', async (request, reply) => {
    let parsed;
    try {
      parsed = listJobsSchema.parse(request.query);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid query parameters',
      };
    }

    const listFilters: {
      status?: 'active' | 'paused' | 'completed' | 'failed';
      type?: 'one-shot' | 'cron';
      targetType?: 'session' | 'isolated';
      targetSessionId?: string;
      limit?: number;
      offset?: number;
    } = {
      limit: parsed.limit,
      offset: parsed.offset,
    };

    if (parsed.status !== undefined) {
      listFilters.status = parsed.status;
    }
    if (parsed.type !== undefined) {
      listFilters.type = parsed.type;
    }
    if (parsed.targetType !== undefined) {
      listFilters.targetType = parsed.targetType;
    }
    if (parsed.targetSessionId !== undefined) {
      listFilters.targetSessionId = parsed.targetSessionId;
    }

    const jobs = await jobsRepo.list(listFilters);

    // Get total count for pagination (simplified - returns current page count)
    const total = jobs.length;

    return {
      jobs,
      total,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  });

  /**
   * GET /api/jobs/:id
   * Get job details
   */
  app.get('/api/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const job = await jobsRepo.findById(id);
    if (!job) {
      reply.code(404);
      return {
        error: 'job.not_found',
        message: 'Job not found',
      };
    }

    return job;
  });

  /**
   * PATCH /api/jobs/:id
   * Update job (pause/resume, update metadata)
   */
  app.patch('/api/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    let parsed;
    try {
      parsed = updateJobSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }

    // Check job exists
    const existingJob = await jobsRepo.findById(id);
    if (!existingJob) {
      reply.code(404);
      return {
        error: 'job.not_found',
        message: 'Job not found',
      };
    }

    const updates: {
      status?: 'active' | 'paused' | 'completed' | 'failed';
      metadata?: Record<string, unknown>;
    } = {};

    if (parsed.status !== undefined) {
      updates.status = parsed.status;
    }
    if (parsed.metadata !== undefined) {
      updates.metadata = parsed.metadata;
    }

    const job = await jobsRepo.update(id, updates);

    return job;
  });

  /**
   * DELETE /api/jobs/:id
   * Delete job (cascade deletes runs)
   */
  app.delete('/api/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Check job exists
    const existingJob = await jobsRepo.findById(id);
    if (!existingJob) {
      reply.code(404);
      return {
        error: 'job.not_found',
        message: 'Job not found',
      };
    }

    await jobsRepo.delete(id);
    reply.code(204);
    return;
  });

  /**
   * POST /api/jobs/:id/trigger
   * Manually trigger job execution
   */
  app.post('/api/jobs/:id/trigger', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const run = await schedulerService.triggerJob(id);

      // Fetch the updated run to get final status
      const updatedRun = await jobRunsRepo.findById(run.id);

      return { run: updatedRun || run };
    } catch (error) {
      if (error instanceof Error && error.message === 'Job not found') {
        reply.code(404);
        return {
          error: 'job.not_found',
          message: 'Job not found',
        };
      }

      // Re-throw other errors to be handled by Fastify error handler
      throw error;
    }
  });

  /**
   * GET /api/jobs/:id/runs
   * List job runs (execution history)
   */
  app.get('/api/jobs/:id/runs', async (request, reply) => {
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

    // Check job exists
    const job = await jobsRepo.findById(id);
    if (!job) {
      reply.code(404);
      return {
        error: 'job.not_found',
        message: 'Job not found',
      };
    }

    const runs = await jobRunsRepo.listByJob(id, {
      limit: parsed.limit,
      offset: parsed.offset,
    });

    // Get total count for pagination (simplified - returns current page count)
    const total = runs.length;

    return {
      runs,
      total,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  });
};
