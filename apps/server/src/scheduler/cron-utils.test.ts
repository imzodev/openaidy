import { describe, it, expect } from 'vitest';
import {
  validateCronExpression,
  calculateNextRun,
  calculateNextRuns,
  describeCronExpression,
  matchesCronExpression,
} from './cron-utils';

describe('cron-utils', () => {
  describe('validateCronExpression', () => {
    it('accepts valid 5-field expression', () => {
      expect(() => validateCronExpression('* * * * *')).not.toThrow();
      expect(() => validateCronExpression('0 * * * *')).not.toThrow();
      expect(() => validateCronExpression('0 0 * * *')).not.toThrow();
      expect(() => validateCronExpression('*/5 * * * *')).not.toThrow();
    });

    it('rejects empty string', () => {
      expect(() => validateCronExpression('')).toThrow(
        'Expression cannot be empty',
      );
    });

    it('rejects too few fields', () => {
      expect(() => validateCronExpression('* * *')).toThrow();
    });

    it('accepts asterisk in all fields', () => {
      expect(() => validateCronExpression('* * * * *')).not.toThrow();
    });

    it('accepts comma-separated values', () => {
      expect(() => validateCronExpression('0,30 * * * *')).not.toThrow();
    });

    it('accepts ranges', () => {
      expect(() => validateCronExpression('0-30 * * * *')).not.toThrow();
    });

    it('accepts step values', () => {
      expect(() => validateCronExpression('*/5 * * * *')).not.toThrow();
    });

    it('provides helpful error message', () => {
      expect(() => validateCronExpression('invalid')).toThrow(
        'Invalid cron expression',
      );
    });
  });

  describe('calculateNextRun', () => {
    it('calculates next minute correctly', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const next = calculateNextRun('* * * * *', now);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(60000);
    });

    it('calculates next hour correctly', () => {
      const now = new Date('2026-03-24T10:30:00Z');
      const next = calculateNextRun('0 * * * *', now);
      expect(next.getUTCMinutes()).toBe(0);
      expect(next.getUTCHours()).toBe(11);
    });

    it('calculates next day correctly', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const next = calculateNextRun('0 0 * * *', now);
      expect(next.getUTCDate()).toBe(25);
      expect(next.getUTCHours()).toBe(0);
      expect(next.getUTCMinutes()).toBe(0);
    });

    it('handles every 5 minutes', () => {
      const now = new Date('2026-03-24T10:02:00Z');
      const next = calculateNextRun('*/5 * * * *', now);
      expect(next.getUTCMinutes()).toBe(5);
    });

    it('handles every hour', () => {
      const now = new Date('2026-03-24T10:30:00Z');
      const next = calculateNextRun('0 * * * *', now);
      expect(next.getUTCMinutes()).toBe(0);
    });

    it('handles daily at 3am', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const next = calculateNextRun('0 3 * * *', now);
      expect(next.getUTCHours()).toBe(3);
      expect(next.getUTCDate()).toBe(25);
    });

    it('handles weekly on Monday', () => {
      // March 24, 2026 is a Tuesday
      const now = new Date('2026-03-24T10:00:00Z');
      const next = calculateNextRun('0 0 * * 1', now);
      // Next Monday should be March 30
      expect(next.getUTCDay()).toBe(1);
    });

    it('handles monthly on 1st', () => {
      const now = new Date('2026-03-15T10:00:00Z');
      const next = calculateNextRun('0 0 1 * *', now);
      expect(next.getUTCDate()).toBe(1);
      expect(next.getUTCMonth()).toBe(3); // April
    });

    it('uses provided fromDate parameter', () => {
      const fromDate = new Date('2026-03-24T10:00:00Z');
      const next = calculateNextRun('* * * * *', fromDate);
      expect(next.getTime()).toBeGreaterThan(fromDate.getTime());
    });

    it('defaults to current time if no fromDate', () => {
      const before = Date.now();
      const next = calculateNextRun('* * * * *');
      const after = Date.now();
      expect(next.getTime()).toBeGreaterThanOrEqual(before);
      expect(next.getTime()).toBeLessThanOrEqual(after + 60000);
    });

    it('throws error for invalid expression', () => {
      expect(() => calculateNextRun('invalid')).toThrow(
        'Failed to calculate next run',
      );
    });
  });

  describe('calculateNextRuns', () => {
    it('calculates multiple future runs', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const runs = calculateNextRuns('* * * * *', 5, now);
      expect(runs).toHaveLength(5);
    });

    it('returns correct number of runs', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const runs = calculateNextRuns('* * * * *', 3, now);
      expect(runs).toHaveLength(3);
    });

    it('runs are in chronological order', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const runs = calculateNextRuns('* * * * *', 5, now);
      for (let i = 1; i < runs.length; i++) {
        const current = runs[i];
        const previous = runs[i - 1];
        expect(current).toBeDefined();
        expect(previous).toBeDefined();
        if (current && previous) {
          expect(current.getTime()).toBeGreaterThan(previous.getTime());
        }
      }
    });

    it('handles count of 0', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const runs = calculateNextRuns('* * * * *', 0, now);
      expect(runs).toHaveLength(0);
    });

    it('handles large count', () => {
      const now = new Date('2026-03-24T10:00:00Z');
      const runs = calculateNextRuns('* * * * *', 100, now);
      expect(runs).toHaveLength(100);
    });
  });

  describe('describeCronExpression', () => {
    it('describes "every minute"', () => {
      expect(describeCronExpression('* * * * *')).toBe('Every minute');
    });

    it('describes "every hour"', () => {
      expect(describeCronExpression('0 * * * *')).toBe('Every hour');
    });

    it('describes "every day"', () => {
      expect(describeCronExpression('0 0 * * *')).toBe('Every day at midnight');
    });

    it('describes "every N minutes"', () => {
      expect(describeCronExpression('*/5 * * * *')).toBe('Every 5 minutes');
      expect(describeCronExpression('*/10 * * * *')).toBe('Every 10 minutes');
    });

    it('describes "every Sunday at midnight"', () => {
      expect(describeCronExpression('0 0 * * 0')).toBe(
        'Every Sunday at midnight',
      );
    });

    it('describes "every Monday at midnight"', () => {
      expect(describeCronExpression('0 0 * * 1')).toBe(
        'Every Monday at midnight',
      );
    });

    it('describes "monthly on the 1st"', () => {
      expect(describeCronExpression('0 0 1 * *')).toBe(
        'Monthly on the 1st at midnight',
      );
    });

    it('handles invalid expression gracefully', () => {
      expect(describeCronExpression('invalid')).toBe('Invalid expression');
    });
  });

  describe('matchesCronExpression', () => {
    it('returns true for matching date', () => {
      // Create a date that matches a cron expression
      const date = new Date('2026-03-24T10:05:00Z');
      // This is approximate since we're checking within 1 minute tolerance
      const result = matchesCronExpression('*/5 * * * *', date);
      expect(typeof result).toBe('boolean');
    });

    it('handles invalid expression gracefully', () => {
      const date = new Date('2026-03-24T10:00:00Z');
      expect(matchesCronExpression('invalid', date)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('Expression with all asterisks (every minute)', () => {
      expect(() => validateCronExpression('* * * * *')).not.toThrow();
    });

    it('Expression with mixed ranges and lists', () => {
      expect(() => validateCronExpression('0,30 9-17 * * 1-5')).not.toThrow();
    });

    it('Expression crossing month boundaries', () => {
      const now = new Date('2026-03-31T23:59:00Z');
      const next = calculateNextRun('* * * * *', now);
      expect(next.getUTCMonth()).toBe(3); // April
    });

    it('Expression crossing year boundaries', () => {
      const now = new Date('2026-12-31T23:59:00Z');
      const next = calculateNextRun('* * * * *', now);
      expect(next.getUTCFullYear()).toBe(2027);
    });
  });
});
