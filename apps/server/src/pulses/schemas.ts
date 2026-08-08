/**
 * Pulse request schemas
 *
 * Shared between the web-facing `/api/pulses` routes and the addon-proxy
 * `/api/addon-proxy/pulses` routes, so schedule validation has one source of
 * truth regardless of caller.
 */

import { z } from 'zod';

export const pulseScheduleSchema = z.union([
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
]);

export const createPulseSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  schedule: pulseScheduleSchema,
  agentId: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

export const updatePulseSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  schedule: pulseScheduleSchema.optional(),
  status: z.enum(['active', 'paused']).optional(),
  agentId: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

export const listPulsesSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function toScheduleInput(
  schedule: z.infer<typeof pulseScheduleSchema>,
): import('@openaidy/shared-types').ScheduleInput {
  if ('every' in schedule) {
    return { every: schedule.every };
  }
  if ('daily' in schedule) {
    return { daily: schedule.daily };
  }
  if ('cron' in schedule) {
    const result: import('@openaidy/shared-types').ScheduleInput = {
      cron: schedule.cron.expression,
    };
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
