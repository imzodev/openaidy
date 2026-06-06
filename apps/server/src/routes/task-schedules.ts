import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth';
import { createLogger } from '../lib/logger';
import type { TaskScheduleRoutesOptions } from '../types';

const log = createLogger('task-schedule-routes');

// ========================================
// Schemas (API input validation only)
//
// These mirror the public DTOs in `@openaidy/shared-types` but use the
// slightly stricter shape the API accepts on the wire. We re-validate
// here so the public types can evolve without breaking the API surface.
// ========================================

const scheduleInputSchema = z.union([
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
      expression: z.string().min(1),
      tz: z.string().optional(),
    }),
  }),
  z.object({
    at: z.string().datetime(),
  }),
]);

const replanPolicySchema = z.enum(['never', 'on-description-change', 'always']);

const createScheduleSchema = z.object({
  schedule: scheduleInputSchema,
  replanPolicy: replanPolicySchema.optional(),
  /**
   * Positive integer. Defaults to 9999 server-side when omitted.
   * There is no "infinite" option.
   */
  maxExecutions: z.number().int().positive().optional(),
});

const updateScheduleSchema = z
  .object({
    schedule: scheduleInputSchema.optional(),
    /** Pause or resume. Other status transitions are not user-facing. */
    status: z.enum(['active', 'paused']).optional(),
    replanPolicy: replanPolicySchema.optional(),
    /** Positive integer. Cannot be unset. */
    maxExecutions: z.number().int().positive().optional(),
  })
  .refine(
    (v) =>
      v.schedule !== undefined ||
      v.status !== undefined ||
      v.replanPolicy !== undefined ||
      v.maxExecutions !== undefined,
    { message: 'At least one field must be provided' },
  );

const listExecutionsSchema = z.object({
  status: z
    .enum([
      'planned',
      'planning',
      'executing',
      'verifying',
      'completed',
      'failed',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ========================================
// API → Service input converters
// ========================================

function toScheduleInput(
  schedule: z.infer<typeof scheduleInputSchema>,
): import('@openaidy/shared-types').ScheduleInput {
  if ('every' in schedule) return { every: schedule.every };
  if ('daily' in schedule) return { daily: schedule.daily };
  if ('cron' in schedule) {
    const result: import('@openaidy/shared-types').ScheduleInput = {
      cron: schedule.cron.expression,
    };
    if (schedule.cron.tz !== undefined) {
      (result as { cron: string; tz?: string }).tz = schedule.cron.tz;
    }
    return result;
  }
  if ('at' in schedule) return { at: schedule.at };
  // Unreachable: the discriminated union above covers every case.
  throw new Error('Invalid schedule format');
}

// ========================================
// Error → HTTP status mapping
//
// The service returns structured ServiceResult errors with codes. The
// API maps these to HTTP statuses. Unknown codes fall back to 500.
// ========================================

const HTTP_STATUS_FOR_CODE: Record<string, number> = {
  // 400
  'validation.invalid_request': 400,
  'schedule.invalid': 400,
  'schedule.invalid_max_executions': 400,
  // 404
  'task.not_found': 404,
  'schedule.not_found': 404,
  // 409 (state conflicts)
  'schedule.already_exists': 409,
  'schedule.expired': 409,
  // 422
  'execution.failed': 422,
  // 500
  'schedule.update_failed': 500,
};

function statusForError(code: string): number {
  return HTTP_STATUS_FOR_CODE[code] ?? 500;
}

// ========================================
// Routes
// ========================================

export const taskScheduleRoutes: FastifyPluginAsync<
  TaskScheduleRoutesOptions
> = async (app, options) => {
  const { taskScheduleService, authMiddleware } = options;

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: 'sessions.list' }),
  );

  // -------------------------------------------------------------
  // POST /api/tasks/:taskId/schedule
  //
  // Create a schedule for a task. The task must exist; the schedule
  // is a 1:1 property of the task, so creating when one already
  // exists is a 409. The body shape is the same as the optional
  // `schedule` field on POST /api/tasks.
  // -------------------------------------------------------------
  app.post('/api/tasks/:taskId/schedule', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    let parsed: z.infer<typeof createScheduleSchema>;
    try {
      parsed = createScheduleSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }

    const input: import('@openaidy/shared-types').CreateTaskScheduleInput = {
      schedule: toScheduleInput(parsed.schedule),
    };
    if (parsed.replanPolicy !== undefined) {
      input.replanPolicy = parsed.replanPolicy;
    }
    if (parsed.maxExecutions !== undefined) {
      input.maxExecutions = parsed.maxExecutions;
    }

    const result = await taskScheduleService.createSchedule(taskId, input);
    if (result.ok) {
      reply.code(201);
      return { schedule: result.data };
    }
    reply.code(statusForError(result.error.code));
    return { error: result.error.code, message: result.error.message };
  });

  // -------------------------------------------------------------
  // GET /api/tasks/:taskId/schedule
  // -------------------------------------------------------------
  app.get('/api/tasks/:taskId/schedule', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const result = await taskScheduleService.getScheduleForTask(taskId);
    if (result.ok) return { schedule: result.data };
    reply.code(statusForError(result.error.code));
    return { error: result.error.code, message: result.error.message };
  });

  // -------------------------------------------------------------
  // PATCH /api/tasks/:taskId/schedule
  //
  // Patches one or more fields. To "remove" a schedule, use DELETE.
  // Pausing a schedule sets status='paused' (visible via GET);
  // resuming sets status='active'. An expired schedule is terminal
  // — use the create endpoint to make a new one.
  // -------------------------------------------------------------
  app.patch('/api/tasks/:taskId/schedule', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    let parsed: z.infer<typeof updateScheduleSchema>;
    try {
      parsed = updateScheduleSchema.parse(request.body);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid request body',
      };
    }

    const input: import('@openaidy/shared-types').UpdateTaskScheduleInput = {};
    if (parsed.schedule !== undefined) {
      input.schedule = toScheduleInput(parsed.schedule);
    }
    if (parsed.status !== undefined) {
      input.status = parsed.status;
    }
    if (parsed.replanPolicy !== undefined) {
      input.replanPolicy = parsed.replanPolicy;
    }
    if (parsed.maxExecutions !== undefined) {
      input.maxExecutions = parsed.maxExecutions;
    }

    const result = await taskScheduleService.updateSchedule(taskId, input);
    if (result.ok) return { schedule: result.data };
    reply.code(statusForError(result.error.code));
    return { error: result.error.code, message: result.error.message };
  });

  // -------------------------------------------------------------
  // POST /api/tasks/:taskId/schedule/pause
  // POST /api/tasks/:taskId/schedule/resume
  //
  // Convenience endpoints that map to update with status=paused /
  // status=active. The service also exposes these, but having
  // dedicated routes makes the UI's intent explicit and lets us add
  // audit logging later.
  // -------------------------------------------------------------
  app.post('/api/tasks/:taskId/schedule/pause', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const result = await taskScheduleService.pauseSchedule(taskId);
    if (result.ok) return { schedule: result.data };
    reply.code(statusForError(result.error.code));
    return { error: result.error.code, message: result.error.message };
  });

  app.post('/api/tasks/:taskId/schedule/resume', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const result = await taskScheduleService.resumeSchedule(taskId);
    if (result.ok) return { schedule: result.data };
    reply.code(statusForError(result.error.code));
    return { error: result.error.code, message: result.error.message };
  });

  // -------------------------------------------------------------
  // DELETE /api/tasks/:taskId/schedule
  // -------------------------------------------------------------
  app.delete('/api/tasks/:taskId/schedule', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const result = await taskScheduleService.removeSchedule(taskId);
    if (result.ok) {
      reply.code(204);
      return;
    }
    reply.code(statusForError(result.error.code));
    return { error: result.error.code, message: result.error.message };
  });

  // -------------------------------------------------------------
  // POST /api/tasks/:taskId/schedule/trigger
  //
  // Force an immediate run without affecting nextRunAt or
  // executionCount. Returns the new history row's ID so the caller
  // can poll its status.
  // -------------------------------------------------------------
  app.post('/api/tasks/:taskId/schedule/trigger', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const result = await taskScheduleService.triggerNow(taskId);
    if (result.ok) {
      reply.code(202); // accepted, run is async
      return { historyId: result.data.historyId };
    }
    reply.code(statusForError(result.error.code));
    return { error: result.error.code, message: result.error.message };
  });

  // -------------------------------------------------------------
  // GET /api/tasks/:taskId/schedule/executions
  //
  // List execution history for the task's schedule, newest first.
  // Supports optional ?status= and pagination.
  // -------------------------------------------------------------
  app.get('/api/tasks/:taskId/schedule/executions', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    let parsed: z.infer<typeof listExecutionsSchema>;
    try {
      parsed = listExecutionsSchema.parse(request.query);
    } catch (error) {
      reply.code(400);
      return {
        error: 'validation.invalid_request',
        message:
          error instanceof Error ? error.message : 'Invalid query parameters',
      };
    }

    try {
      const result = await taskScheduleService.listExecutions(taskId, {
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        limit: parsed.limit,
        offset: parsed.offset,
      });
      if (result.ok) {
        return {
          executions: result.data.items,
          total: result.data.total,
          limit: result.data.limit,
          offset: result.data.offset,
        };
      }
      reply.code(statusForError(result.error.code));
      return { error: result.error.code, message: result.error.message };
    } catch (error) {
      log.error('Failed to list executions', error);
      reply.code(500);
      return { error: 'execution.list_failed', message: 'Internal error' };
    }
  });
};
