import { describe, it, expect } from 'vitest';
import { shouldShowDateSeparator, formatDateSeparator } from './message-date';

describe('shouldShowDateSeparator', () => {
  it('returns true when there is no previous message', () => {
    expect(
      shouldShowDateSeparator({ createdAt: '2024-01-01T10:00:00Z' }, undefined),
    ).toBe(true);
  });

  it('returns false when the previous message is the same calendar day', () => {
    expect(
      shouldShowDateSeparator(
        { createdAt: '2024-01-01T10:30:00Z' },
        { createdAt: '2024-01-01T09:00:00Z' },
      ),
    ).toBe(false);
  });

  it('returns true when the previous message is on a different day', () => {
    expect(
      shouldShowDateSeparator(
        { createdAt: '2024-01-02T00:30:00Z' },
        { createdAt: '2024-01-01T23:30:00Z' },
      ),
    ).toBe(true);
  });

  it('treats invalid timestamps as no separator', () => {
    expect(
      shouldShowDateSeparator(
        { createdAt: 'invalid' },
        { createdAt: '2024-01-01T10:00:00Z' },
      ),
    ).toBe(false);
  });
});

describe('formatDateSeparator', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('renders "Today" for messages dated today', () => {
    expect(formatDateSeparator('2024-06-15T08:00:00Z', now)).toBe('Today');
  });

  it('renders "Yesterday" for messages dated yesterday', () => {
    expect(formatDateSeparator('2024-06-14T20:00:00Z', now)).toBe('Yesterday');
  });

  it('renders a long-form date for older messages', () => {
    const out = formatDateSeparator('2024-01-01T12:00:00Z', now);
    // Don't pin the locale-specific format — just check it includes the year
    // and isn't a relative label.
    expect(out).toContain('2024');
    expect(out).not.toBe('Today');
    expect(out).not.toBe('Yesterday');
  });

  it('returns "" for invalid timestamps', () => {
    expect(formatDateSeparator('not a date', now)).toBe('');
  });
});
