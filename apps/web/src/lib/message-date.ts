/**
 * Date helpers for chat message separators.
 *
 * Pure functions; no JSX, no Solid dependencies. The component that
 * renders the separator (MessageListItem / MessageDateSeparator) lives in
 * `components/` and imports these helpers.
 */

import type { SessionMessage } from './api';

/**
 * Returns true when a date separator should be rendered before `current`,
 * i.e. when the previous message's calendar day is different (or there is
 * no previous message).
 */
export function shouldShowDateSeparator(
  current: Pick<SessionMessage, 'createdAt'>,
  previous: Pick<SessionMessage, 'createdAt'> | undefined,
): boolean {
  if (!previous) return true;
  const a = new Date(current.createdAt);
  const b = new Date(previous.createdAt);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  // Use UTC date comparison so the result is independent of the
  // test runner / server timezone.
  return (
    a.getUTCFullYear() !== b.getUTCFullYear() ||
    a.getUTCMonth() !== b.getUTCMonth() ||
    a.getUTCDate() !== b.getUTCDate()
  );
}

/**
 * Render a calendar date as a short, human-friendly header (e.g.
 * "July 20, 2025" / "Today" / "Yesterday"). Locale-aware via `Intl`.
 *
 * All comparisons use UTC so the result is independent of the
 * server / test runner timezone.
 */
export function formatDateSeparator(
  iso: string,
  now: Date = new Date(),
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const utcSameDay = (a: Date, b: Date) =>
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();

  const utcStartOfDay = (date: Date) =>
    new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );

  const today = utcStartOfDay(now);
  const target = utcStartOfDay(d);
  const diffDays = Math.round(
    (today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0 && utcSameDay(d, now)) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
