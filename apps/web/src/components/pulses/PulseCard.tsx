/**
 * PulseCard Component
 *
 * Displays a single pulse with status, schedule, and action buttons.
 */

import { Show } from 'solid-js';
import { Play, Pause, Edit2, History, Trash2, Zap } from 'lucide-solid';
import type { Pulse } from '../../lib/api';

export type PulseCardProps = {
  pulse: Pulse;
  onTrigger: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onEdit: (pulse: Pulse) => void;
  onHistory: (id: string) => void;
  onDelete: (id: string) => void;
  isActionLoading?: boolean;
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatNextRun(iso: string | null): string {
  if (!iso) return 'Not scheduled';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs < 0) return 'Due now';
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 60) return `In ${diffMins}m`;
  if (diffHours < 24) return `In ${diffHours}h`;
  return `In ${diffDays}d`;
}

const STATUS_STYLES: Record<Pulse['status'], string> = {
  active:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  paused:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export function PulseCard(props: PulseCardProps) {
  return (
    <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <div class="flex items-start justify-between mb-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <Zap class="w-4 h-4 text-primary flex-shrink-0" />
            <h3 class="text-base font-semibold text-text-primary truncate">
              {props.pulse.name}
            </h3>
          </div>
          <p class="text-sm text-text-secondary truncate px-6">
            {props.pulse.prompt}
          </p>
        </div>
        <span
          class={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${STATUS_STYLES[props.pulse.status]}`}
        >
          {props.pulse.status}
        </span>
      </div>

      <div class="flex items-center gap-4 text-xs text-text-tertiary mb-3">
        <span title="Schedule">{props.pulse.scheduleHuman}</span>
        <span title="Next run">{formatNextRun(props.pulse.nextRunAt)}</span>
        <span title="Last run">
          Last: {formatRelativeTime(props.pulse.lastRunAt)}
        </span>
      </div>

      <div class="flex items-center gap-1 border-t border-gray-100 dark:border-gray-700 pt-3">
        <Show when={props.pulse.status === 'active'}>
          <button
            onClick={() => props.onTrigger(props.pulse.id)}
            disabled={props.isActionLoading}
            class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
            title="Run now"
          >
            <Play class="w-3.5 h-3.5" />
            Run
          </button>
          <button
            onClick={() => props.onPause(props.pulse.id)}
            disabled={props.isActionLoading}
            class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors disabled:opacity-50"
            title="Pause"
          >
            <Pause class="w-3.5 h-3.5" />
            Pause
          </button>
        </Show>

        <Show when={props.pulse.status === 'paused'}>
          <button
            onClick={() => props.onResume(props.pulse.id)}
            disabled={props.isActionLoading}
            class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors disabled:opacity-50"
            title="Resume"
          >
            <Play class="w-3.5 h-3.5" />
            Resume
          </button>
        </Show>

        <Show
          when={
            props.pulse.status === 'completed' ||
            props.pulse.status === 'failed'
          }
        >
          <button
            onClick={() => props.onTrigger(props.pulse.id)}
            disabled={props.isActionLoading}
            class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
            title="Run now"
          >
            <Play class="w-3.5 h-3.5" />
            Run
          </button>
        </Show>

        <button
          onClick={() => props.onEdit(props.pulse)}
          class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title="Edit"
        >
          <Edit2 class="w-3.5 h-3.5" />
          Edit
        </button>

        <button
          onClick={() => props.onHistory(props.pulse.id)}
          class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title="History"
        >
          <History class="w-3.5 h-3.5" />
          History
        </button>

        <div class="flex-1" />

        <button
          onClick={() => props.onDelete(props.pulse.id)}
          class="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
          title="Delete"
        >
          <Trash2 class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
