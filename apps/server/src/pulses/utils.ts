import type { ScheduledJob } from '@openaidy/db';
import {
  validateCronExpression,
  calculateNextRun,
  describeCronExpression,
} from '../scheduler/cron-utils';

/**
 * Schedule input types - discriminated union for different scheduling options
 */
export type ScheduleInput =
  | { every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }
  | { daily: { hour: number; minute: number } }
  | { cron: string; tz?: string }
  | { at: string };

/**
 * Parsed schedule result
 */
export type ParsedSchedule = {
  type: 'cron' | 'one-shot';
  cronExpression?: string;
  schedule?: Date;
  nextRunAt: Date;
};

/**
 * Mapping of 'every' values to cron expressions
 */
const EVERY_TO_CRON: Record<
  '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w',
  string
> = {
  '15m': '*/15 * * * *',
  '30m': '*/30 * * * *',
  '1h': '0 * * * *',
  '6h': '0 */6 * * *',
  '12h': '0 */12 * * *',
  '1d': '0 0 * * *',
  '1w': '0 0 * * 0',
};

/**
 * Parse a schedule input into cron expression and next run time
 */
export function parseScheduleInput(schedule: ScheduleInput): ParsedSchedule {
  // Handle 'every' schedules
  if ('every' in schedule) {
    const cronExpression = EVERY_TO_CRON[schedule.every];
    if (!cronExpression) {
      throw new Error(`Invalid every value: ${schedule.every}`);
    }
    validateCronExpression(cronExpression);
    return {
      type: 'cron',
      cronExpression,
      nextRunAt: calculateNextRun(cronExpression, new Date()),
    };
  }

  // Handle 'daily' schedules
  if ('daily' in schedule) {
    const { hour, minute } = schedule.daily;

    // Validate hour (0-23) and minute (0-59)
    if (hour < 0 || hour > 23) {
      throw new Error(`Invalid hour: ${hour}. Must be between 0 and 23.`);
    }
    if (minute < 0 || minute > 59) {
      throw new Error(`Invalid minute: ${minute}. Must be between 0 and 59.`);
    }

    const cronExpression = `${minute} ${hour} * * *`;
    validateCronExpression(cronExpression);
    return {
      type: 'cron',
      cronExpression,
      nextRunAt: calculateNextRun(cronExpression, new Date()),
    };
  }

  // Handle 'cron' schedules
  if ('cron' in schedule) {
    const { cron: cronExpression, tz: _tz } = schedule;
    // Note: timezone handling would require a timezone-aware cron parser
    // For now, we validate and use UTC
    validateCronExpression(cronExpression);
    return {
      type: 'cron',
      cronExpression,
      nextRunAt: calculateNextRun(cronExpression, new Date()),
    };
  }

  // Handle 'at' schedules (one-shot)
  if ('at' in schedule) {
    const scheduleDate = new Date(schedule.at);

    if (isNaN(scheduleDate.getTime())) {
      throw new Error(`Invalid date format: ${schedule.at}`);
    }

    if (scheduleDate.getTime() <= Date.now()) {
      throw new Error(`Schedule date must be in the future: ${schedule.at}`);
    }

    return {
      type: 'one-shot',
      schedule: scheduleDate,
      nextRunAt: scheduleDate,
    };
  }

  throw new Error('Invalid schedule input');
}

/**
 * Pulse record type - the API response format for a pulse
 */
export type PulseRecord = {
  id: string;
  name: string;
  prompt: string;
  schedule: { cron?: string } | { at: string };
  scheduleHuman: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  agentId?: string;
  sessionId?: string;
  lastRunAt?: Date;
  nextRunAt: Date;
  createdAt: Date;
};

/**
 * Convert a ScheduledJob to a PulseRecord
 */
export function jobToPulse(job: ScheduledJob): PulseRecord {
  const metadata = job.metadata as Record<string, unknown> | null;

  // Extract name and prompt from metadata
  const name = (metadata?.name as string | undefined) ?? 'Unnamed Pulse';
  const prompt =
    (metadata?.prompt as string | undefined) ??
    (job.payload.message as string | undefined) ??
    '';

  // Derive schedule object
  let schedule: PulseRecord['schedule'];
  if (job.cronExpression) {
    schedule = { cron: job.cronExpression };
  } else if (job.schedule) {
    schedule = { at: job.schedule.toISOString() };
  } else {
    // Default to cron if neither is set
    schedule = { cron: job.cronExpression ?? '0 0 * * *' };
  }

  // Derive human-readable schedule
  const scheduleHuman = job.cronExpression
    ? describeCronExpression(job.cronExpression)
    : job.schedule
      ? `Once at ${job.schedule.toISOString()}`
      : 'Unknown schedule';

  const record: PulseRecord = {
    id: job.id,
    name,
    prompt,
    schedule,
    scheduleHuman,
    status: job.status,
    nextRunAt: job.nextRunAt,
    createdAt: job.createdAt,
  };
  const agentId = job.payload.agentId as string | undefined;
  if (agentId !== undefined) record.agentId = agentId;
  const sessionId = job.targetSessionId ?? undefined;
  if (sessionId !== undefined) record.sessionId = sessionId;
  const lastRunAt = job.lastRunAt ?? undefined;
  if (lastRunAt !== undefined) record.lastRunAt = lastRunAt;
  return record;
}
