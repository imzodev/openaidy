/**
 * CreateEditPulseModal Component
 *
 * Modal for creating and editing pulses with name, prompt, and schedule.
 */

import { createSignal, createEffect, Show, on } from 'solid-js';
import { Modal } from '../ui/Modal';
import type {
  Pulse,
  CreatePulseBody,
  UpdatePulseBody,
  ScheduleInput,
} from '../../lib/api';

export type CreateEditPulseModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (body: CreatePulseBody | UpdatePulseBody) => Promise<void>;
  pulse?: Pulse;
  isLoading?: boolean;
};

type ScheduleType = 'interval' | 'daily' | 'cron' | 'at';

const INTERVAL_OPTIONS = [
  { value: '15m', label: 'Every 15 minutes' },
  { value: '30m', label: 'Every 30 minutes' },
  { value: '1h', label: 'Every hour' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '1d', label: 'Every day' },
  { value: '1w', label: 'Every week' },
] as const;

export function CreateEditPulseModal(props: CreateEditPulseModalProps) {
  const [name, setName] = createSignal('');
  const [prompt, setPrompt] = createSignal('');
  const [scheduleType, setScheduleType] =
    createSignal<ScheduleType>('interval');
  const [interval, setInterval] = createSignal<
    '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w'
  >('1h');
  const [dailyHour, setDailyHour] = createSignal(9);
  const [dailyMinute, setDailyMinute] = createSignal(0);
  const [cronExpression, setCronExpression] = createSignal('0 * * * *');
  const [atDate, setAtDate] = createSignal('');
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [submitting, setSubmitting] = createSignal(false);

  // Reset form when modal opens or pulse changes
  createEffect(
    on(
      () => [props.isOpen, props.pulse],
      () => {
        if (props.isOpen) {
          if (props.pulse) {
            // Edit mode - parse existing pulse
            setName(props.pulse.name);
            setPrompt(props.pulse.prompt);
            // Try to detect schedule type from scheduleHuman or pulse data
            // Default to interval for now
            setScheduleType('interval');
            setInterval('1h');
          } else {
            // Create mode
            setName('');
            setPrompt('');
            setScheduleType('interval');
            setInterval('1h');
            setDailyHour(9);
            setDailyMinute(0);
            setCronExpression('0 * * * *');
            setAtDate('');
          }
          setErrors({});
        }
      },
      { defer: false },
    ),
  );

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name().trim()) {
      newErrors.name = 'Name is required';
    }
    if (!prompt().trim()) {
      newErrors.prompt = 'Prompt is required';
    }
    if (scheduleType() === 'cron' && !cronExpression().trim()) {
      newErrors.cron = 'Cron expression is required';
    }
    if (scheduleType() === 'at' && !atDate()) {
      newErrors.at = 'Date is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const buildScheduleInput = (): ScheduleInput => {
    switch (scheduleType()) {
      case 'interval':
        return { every: interval() };
      case 'daily':
        return { daily: { hour: dailyHour(), minute: dailyMinute() } };
      case 'cron':
        return { cron: cronExpression() };
      case 'at':
        return { at: atDate() };
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const body = buildScheduleInput();
      if (props.pulse) {
        await props.onSubmit({
          name: name(),
          prompt: prompt(),
          schedule: body,
        } as UpdatePulseBody);
      } else {
        await props.onSubmit({
          name: name(),
          prompt: prompt(),
          schedule: body,
        } as CreatePulseBody);
      }
    } catch (err) {
      setErrors({
        submit: err instanceof Error ? err.message : 'Failed to save',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={props.pulse ? 'Edit Pulse' : 'Create Pulse'}
      size="lg"
    >
      <form onSubmit={handleSubmit} class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-text-primary mb-1">
            Name
          </label>
          <input
            type="text"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            class={`w-full px-3 py-2 rounded-lg border ${errors().name ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-white dark:bg-gray-800 text-text-primary`}
            placeholder="Daily AI digest"
          />
          <Show when={errors().name}>
            <p class="text-sm text-red-500 mt-1">{errors().name}</p>
          </Show>
        </div>

        <div>
          <label class="block text-sm font-medium text-text-primary mb-1">
            Prompt
          </label>
          <textarea
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            rows={4}
            class={`w-full px-3 py-2 rounded-lg border ${errors().prompt ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-white dark:bg-gray-800 text-text-primary resize-none`}
            placeholder="Summarize my conversations from today"
          />
          <Show when={errors().prompt}>
            <p class="text-sm text-red-500 mt-1">{errors().prompt}</p>
          </Show>
        </div>

        <div>
          <label class="block text-sm font-medium text-text-primary mb-2">
            Schedule
          </label>
          <div class="flex flex-wrap gap-2 mb-3">
            <button
              type="button"
              onClick={() => setScheduleType('interval')}
              class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${scheduleType() === 'interval' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              Interval
            </button>
            <button
              type="button"
              onClick={() => setScheduleType('daily')}
              class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${scheduleType() === 'daily' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => setScheduleType('cron')}
              class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${scheduleType() === 'cron' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              Cron
            </button>
            <button
              type="button"
              onClick={() => setScheduleType('at')}
              class={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${scheduleType() === 'at' ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              One-time
            </button>
          </div>

          <Show when={scheduleType() === 'interval'}>
            <select
              value={interval()}
              onChange={(e) =>
                setInterval(
                  e.currentTarget.value as typeof interval extends () => infer T
                    ? T
                    : never,
                )
              }
              class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-primary"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Show>

          <Show when={scheduleType() === 'daily'}>
            <div class="flex items-center gap-2">
              <select
                value={dailyHour()}
                onChange={(e) => setDailyHour(Number(e.currentTarget.value))}
                class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-primary"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option value={i}>{i.toString().padStart(2, '0')}</option>
                ))}
              </select>
              <span>:</span>
              <select
                value={dailyMinute()}
                onChange={(e) => setDailyMinute(Number(e.currentTarget.value))}
                class="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-text-primary"
              >
                {[0, 15, 30, 45].map((m) => (
                  <option value={m}>{m.toString().padStart(2, '0')}</option>
                ))}
              </select>
            </div>
          </Show>

          <Show when={scheduleType() === 'cron'}>
            <input
              type="text"
              value={cronExpression()}
              onInput={(e) => setCronExpression(e.currentTarget.value)}
              placeholder="0 * * * *"
              class={`w-full px-3 py-2 rounded-lg border ${errors().cron ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-white dark:bg-gray-800 text-text-primary`}
            />
            <Show when={errors().cron}>
              <p class="text-sm text-red-500 mt-1">{errors().cron}</p>
            </Show>
          </Show>

          <Show when={scheduleType() === 'at'}>
            <input
              type="datetime-local"
              value={atDate()}
              onInput={(e) => setAtDate(e.currentTarget.value)}
              class={`w-full px-3 py-2 rounded-lg border ${errors().at ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} bg-white dark:bg-gray-800 text-text-primary`}
            />
            <Show when={errors().at}>
              <p class="text-sm text-red-500 mt-1">{errors().at}</p>
            </Show>
          </Show>
        </div>

        <Show when={errors().submit}>
          <p class="text-sm text-red-500">{errors().submit}</p>
        </Show>

        <div class="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={props.onClose}
            class="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting()}
            class="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting()
              ? 'Saving...'
              : props.pulse
                ? 'Save Changes'
                : 'Create Pulse'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
