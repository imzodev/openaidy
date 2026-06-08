/**
 * Shared helpers for task-schedule tools.
 *
 * Extracted from create.ts / update.ts to avoid duplication.
 */

/**
 * Build a `ScheduleInput` discriminated union from the tool's
 * `schedule` object shape. The shape is identical to the pulse tools
 * — kept here so the two tools stay consistent.
 */
export function buildScheduleInput(
  schedule: Record<string, unknown>,
):
  | { ok: true; value: import('@openaidy/shared-types').ScheduleInput }
  | { ok: false; error: string } {
  if (schedule['every']) {
    return {
      ok: true,
      value: {
        every: schedule['every'] as
          | '15m'
          | '30m'
          | '1h'
          | '6h'
          | '12h'
          | '1d'
          | '1w',
      },
    };
  }
  if (schedule['daily']) {
    const daily = schedule['daily'] as { hour: number; minute: number };
    return {
      ok: true,
      value: { daily: { hour: daily.hour, minute: daily.minute } },
    };
  }
  if (schedule['cron']) {
    const cronObj = schedule['cron'] as {
      expression: string;
      tz?: string;
    };
    return {
      ok: true,
      value: {
        cron: cronObj['expression'],
        ...(cronObj['tz'] ? { tz: cronObj['tz'] } : {}),
      },
    };
  }
  if (schedule['at']) {
    return { ok: true, value: { at: schedule['at'] as string } };
  }
  return { ok: false, error: 'Invalid schedule format.' };
}
