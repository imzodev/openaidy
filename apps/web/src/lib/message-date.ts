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
  return a.toDateString() !== b.toDateString();
}

/**
 * Render a calendar date as a short, human-friendly header (e.g.
 * "July 20, 2025" / "Today" / "Yesterday"). Locale-aware via `Intl`.
 */
export function formatDateSeparator(
  iso: string,
  now: Date = new Date(),
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.round(
    (today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0 && sameDay(d, now)) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
