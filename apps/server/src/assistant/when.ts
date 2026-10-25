/**
 * Turns what an agent writes for "when" into a Date: a relative time
 * ("in 2 hours", "in 30 minutes", "in 3 days"), an ISO time with an
 * offset ("2026-10-31T09:00:00-06:00"), or a local ISO time without one
 * ("2026-10-31T09:00"), read in the owner's timezone.
 */
export function parseWhen(
  when: string,
  timeZone: string,
  now: Date = new Date(),
): { ok: true; date: Date } | { ok: false; error: string } {
  const text = when.trim().toLowerCase();
  const relative =
    /^in\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)$/.exec(
      text,
    );
  let date: Date | null = null;
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!;
    const minutes = unit.startsWith('m')
      ? 1
      : unit.startsWith('h')
        ? 60
        : unit.startsWith('d')
          ? 1440
          : 10080;
    date = new Date(now.getTime() + amount * minutes * 60_000);
  } else if (
    /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})$/.test(
      text,
    )
  ) {
    date = new Date(when.trim());
  } else {
    const local =
      /^(\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (local) {
      date = fromZonedTime(
        local.slice(1).map((v) => (v === undefined ? 0 : Number(v))),
        timeZone,
      );
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return {
      ok: false,
      error:
        'Give "when" as "in 2 hours" / "in 30 minutes" / "in 3 days", or a date and time like 2026-10-31T09:00 (owner timezone) or with an offset.',
    };
  }
  if (date.getTime() < now.getTime() + 30_000) {
    return { ok: false, error: 'That time is in the past (or right now).' };
  }
  if (date.getTime() > now.getTime() + 366 * 24 * 60 * 60_000) {
    return { ok: false, error: 'Reminders can be at most a year ahead.' };
  }
  return { ok: true, date };
}

/** The UTC instant of a wall-clock time in `timeZone`. */
function fromZonedTime(
  [year, month, day, hour, minute, second = 0]: number[],
  timeZone: string,
): Date {
  const asUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second);
  // Offset of the zone at (roughly) that moment; a second pass settles
  // times next to a DST change.
  let guess = asUtc - zoneOffsetMs(new Date(asUtc), timeZone);
  guess = asUtc - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "Fri, Oct 31, 09:00" in `timeZone`, for confirmations. */
export function formatWhen(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
