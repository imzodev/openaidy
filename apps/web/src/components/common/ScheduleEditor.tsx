/**
 * ScheduleEditor Component
 *
 * A reusable schedule editor for the four `ScheduleInput` shapes:
 * - `every`   (preset interval: 15m/30m/1h/6h/12h/1d/1w)
 * - `daily`   (HH:MM)
 * - `cron`    (cron expression, optional tz)
 * - `at`      (one-shot ISO datetime)
 *
 * The component works with the public `ScheduleInput` discriminated
 * union (no `kind` tag — discrimination is by key presence). Internal
 * state is tracked by a `kind` signal so the UI can switch between
 * input modes; on every change we emit the canonical `ScheduleInput`
 * to the parent. No component-local copy of the type is exported.
 *
 * Reused by the task modal (Phase 6) and could be used by the pulses
 * modal — same shape, same shared-types source.
 */

import { createSignal, createEffect, Show, on } from 'solid-js';
import type { ScheduleInput, SchedulePreset } from '../../lib/types';

type ScheduleKind = 'every' | 'daily' | 'cron' | 'at';

export type ScheduleEditorProps = {
  value: ScheduleInput | null;
  onChange: (value: ScheduleInput | null) => void;
  /** Returns an error message string or null if valid */
  validate?: (value: ScheduleInput) => string | null;
};

const INTERVAL_OPTIONS: ReadonlyArray<{
  value: SchedulePreset;
  label: string;
}> = [
  { value: '15m', label: 'Every 15 minutes' },
  { value: '30m', label: 'Every 30 minutes' },
  { value: '1h', label: 'Every hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '1d', label: 'Every day' },
  { value: '1w', label: 'Every week' },
] as const;

/**
 * Detect the kind of a `ScheduleInput`. The shared `ScheduleInput`
 * union is not tagged; we discriminate by key presence.
 */
function detectKind(v: ScheduleInput | null): ScheduleKind {
  if (!v) return 'every';
  if ('every' in v) return 'every';
  if ('daily' in v) return 'daily';
  if ('cron' in v) return 'cron';
  if ('at' in v) return 'at';
  return 'every';
}

export function ScheduleEditor(props: ScheduleEditorProps) {
  const [kind, setKind] = createSignal<ScheduleKind>(detectKind(props.value));

  // Every (interval) state
  const [interval, setInterval] = createSignal<SchedulePreset>(
    (props.value && 'every' in props.value ? props.value.every : null) ?? '1h',
  );

  // Daily state
  const [dailyHour, setDailyHour] = createSignal(
    (props.value && 'daily' in props.value ? props.value.daily.hour : null) ??
      9,
  );
  const [dailyMinute, setDailyMinute] = createSignal(
    (props.value && 'daily' in props.value ? props.value.daily.minute : null) ??
      0,
  );

  // Cron state
  const [cronExpression, setCronExpression] = createSignal(
    (props.value && 'cron' in props.value ? props.value.cron : null) ??
      '0 * * * *',
  );

  // At (one-shot) state
  const [atDate, setAtDate] = createSignal(
    (props.value && 'at' in props.value ? props.value.at : null) ?? '',
  );

  const [error, setError] = createSignal<string | null>(null);

  // Sync from external value changes
  createEffect(
    on(
      () => props.value,
      (v) => {
        if (!v) {
          setKind('every');
          return;
        }
        setKind(detectKind(v));
        if ('every' in v) setInterval(v.every);
        if ('daily' in v) {
          setDailyHour(v.daily.hour);
          setDailyMinute(v.daily.minute);
        }
        if ('cron' in v) setCronExpression(v.cron);
        if ('at' in v) setAtDate(v.at);
      },
      { defer: false },
    ),
  );

  function buildValue(): ScheduleInput | null {
    switch (kind()) {
      case 'every':
        return { every: interval() };
      case 'daily':
        return { daily: { hour: dailyHour(), minute: dailyMinute() } };
      case 'cron': {
        const expr = cronExpression();
        if (!expr.trim()) return null;
        // tz is optional; if the previous value had a tz, preserve it.
        const prev = props.value;
        const prevTz = prev && 'cron' in prev ? prev.tz : undefined;
        return prevTz ? { cron: expr, tz: prevTz } : { cron: expr };
      }
      case 'at': {
        const d = atDate();
        if (!d) return null;
        return { at: d };
      }
    }
  }

  function emit() {
    setError(null);
    const v = buildValue();
    if (v && props.validate) {
      const err = props.validate(v);
      if (err) {
        setError(err);
        return;
      }
    }
    props.onChange(v);
  }

  function handleKindChange(k: ScheduleKind) {
    setKind(k);
    // Emit immediately so the parent sees the new kind
    const v = buildValue();
    if (v) props.onChange(v);
  }

  return (
    <div class="space-y-3">
      {/* Type selector */}
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleKindChange('every')}
          class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            kind() === 'every'
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Interval
        </button>
        <button
          type="button"
          onClick={() => handleKindChange('daily')}
          class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            kind() === 'daily'
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Daily
        </button>
        <button
          type="button"
          onClick={() => handleKindChange('cron')}
          class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            kind() === 'cron'
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Cron
        </button>
        <button
          type="button"
          onClick={() => handleKindChange('at')}
          class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            kind() === 'at'
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          One-time
        </button>
      </div>

      {/* Interval selector */}
      <Show when={kind() === 'every'}>
        <select
          value={interval()}
          onChange={(e) => {
            setInterval(e.currentTarget.value as SchedulePreset);
            emit();
          }}
          class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-primary"
        >
          {INTERVAL_OPTIONS.map((opt) => (
            <option value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Show>

      {/* Daily time selector */}
      <Show when={kind() === 'daily'}>
        <div class="flex items-center gap-2">
          <select
            value={dailyHour()}
            onChange={(e) => {
              setDailyHour(Number(e.currentTarget.value));
              emit();
            }}
            class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-primary"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option value={i}>{i.toString().padStart(2, '0')}</option>
            ))}
          </select>
          <span class="text-text-secondary font-medium">:</span>
          <select
            value={dailyMinute()}
            onChange={(e) => {
              setDailyMinute(Number(e.currentTarget.value));
              emit();
            }}
            class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-primary"
          >
            {[0, 15, 30, 45].map((m) => (
              <option value={m}>{m.toString().padStart(2, '0')}</option>
            ))}
          </select>
        </div>
      </Show>

      {/* Cron input */}
      <Show when={kind() === 'cron'}>
        <input
          type="text"
          value={cronExpression()}
          onInput={(e) => {
            setCronExpression(e.currentTarget.value);
            emit();
          }}
          placeholder="0 * * * *"
          class={`w-full px-3 py-2 rounded-lg border ${
            error() ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
          } bg-white dark:bg-gray-800 text-text-primary`}
        />
        <Show when={error()}>
          <p class="text-sm text-red-500">{error()}</p>
        </Show>
      </Show>

      {/* One-shot datetime picker */}
      <Show when={kind() === 'at'}>
        <input
          type="datetime-local"
          value={atDate()}
          onInput={(e) => {
            setAtDate(e.currentTarget.value);
            emit();
          }}
          class={`w-full px-3 py-2 rounded-lg border ${
            error() ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
          } bg-white dark:bg-gray-800 text-text-primary`}
        />
        <Show when={error()}>
          <p class="text-sm text-red-500">{error()}</p>
        </Show>
      </Show>
    </div>
  );
}
