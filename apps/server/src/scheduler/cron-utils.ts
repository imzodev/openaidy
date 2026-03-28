import { Cron } from 'croner';

/**
 * Validates a cron expression
 * @param expression - Cron expression to validate (5 or 6 fields)
 * @returns true if valid
 * @throws Error with descriptive message if invalid
 */
export function validateCronExpression(expression: string): boolean {
  if (!expression || expression.trim() === '') {
    throw new Error('Invalid cron expression: Expression cannot be empty');
  }

  try {
    new Cron(expression);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error('Invalid cron expression: ' + error.message);
    }
    throw new Error('Invalid cron expression');
  }
}

/**
 * Calculates the next run time for a cron expression
 * @param expression - Valid cron expression
 * @param fromDate - Date to calculate from (defaults to now)
 * @returns Next scheduled run time
 * @throws Error if expression is invalid
 */
export function calculateNextRun(
  expression: string,
  fromDate: Date = new Date(),
): Date {
  try {
    const cron = new Cron(expression, { timezone: 'UTC' });
    const next = cron.nextRun(fromDate);
    if (!next) {
      throw new Error('No next run time available');
    }
    return next;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error('Failed to calculate next run: ' + error.message);
    }
    throw new Error('Failed to calculate next run');
  }
}

/**
 * Calculates multiple future run times
 * @param expression - Valid cron expression
 * @param count - Number of future runs to calculate
 * @param fromDate - Date to calculate from (defaults to now)
 * @returns Array of next scheduled run times
 */
export function calculateNextRuns(
  expression: string,
  count: number,
  fromDate: Date = new Date(),
): Date[] {
  if (count <= 0) {
    return [];
  }

  try {
    const cron = new Cron(expression);
    const runs: Date[] = [];
    let current = fromDate;

    for (let i = 0; i < count; i++) {
      const next = cron.nextRun(current);
      if (!next) break;
      runs.push(next);
      current = next;
    }

    return runs;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error('Failed to calculate next runs: ' + error.message);
    }
    throw new Error('Failed to calculate next runs');
  }
}

/**
 * Parses and describes a cron expression in human-readable format
 * @param expression - Cron expression to describe
 * @returns Human-readable description
 */
export function describeCronExpression(expression: string): string {
  try {
    validateCronExpression(expression);

    if (expression === '* * * * *') return 'Every minute';
    if (expression === '0 * * * *') return 'Every hour';
    if (expression === '0 0 * * *') return 'Every day at midnight';
    if (expression === '0 0 * * 0') return 'Every Sunday at midnight';
    if (expression === '0 0 * * 1') return 'Every Monday at midnight';
    if (expression === '0 0 1 * *') return 'Monthly on the 1st at midnight';

    const minuteInterval = expression.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
    if (minuteInterval) {
      return 'Every ' + minuteInterval[1] + ' minutes';
    }

    const hourlyPattern = expression.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
    if (hourlyPattern) {
      return 'Every ' + hourlyPattern[1] + ' hours';
    }

    return expression;
  } catch {
    return 'Invalid expression';
  }
}

/**
 * Checks if a cron expression would run at a specific date
 * @param expression - Cron expression
 * @param date - Date to check
 * @returns true if the expression matches the date
 */
export function matchesCronExpression(expression: string, date: Date): boolean {
  try {
    const cron = new Cron(expression);
    const nextRun = cron.nextRun(new Date(date.getTime() - 1000));
    if (!nextRun) return false;

    const diff = Math.abs(nextRun.getTime() - date.getTime());
    return diff < 60000;
  } catch {
    return false;
  }
}
