/**
 * ScheduleDisplay Component
 *
 * A small read-only display for a task schedule. Used in TaskCard
 * and the executions page.
 *
 * The prop type is exported as `ScheduleDisplayProps` for the
 * convenience of consumers who want to construct it (only used
 * in tests today). The schedule payload type is re-exported
 * from the shared types — never redeclared.
 */

import { Show } from 'solid-js';
import { Repeat, Calendar, Clock, PauseCircle } from 'lucide-solid';
import type { TaskScheduleDto } from '../../lib/types';

type ScheduleDisplayProps = {
  schedule: TaskScheduleDto;
  size?: 'sm' | 'md';
  showStatus?: boolean;
};

export function ScheduleDisplay(props: ScheduleDisplayProps) {
  const sizeCls = () => (props.size === 'sm' ? 'text-xs' : 'text-sm');
  const iconCls = () => (props.size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5');

  const icon = () => {
    if (props.schedule.schedule && 'at' in props.schedule.schedule) {
      return <Calendar class={iconCls()} />;
    }
    if (props.schedule.schedule && 'cron' in props.schedule.schedule) {
      return <Clock class={iconCls()} />;
    }
    return <Repeat class={iconCls()} />;
  };

  return (
    <div
      class={`flex items-center gap-1.5 ${sizeCls()} text-gray-500 dark:text-gray-400`}
    >
      {icon()}
      <span>{props.schedule.scheduleHuman}</span>
      <Show when={props.showStatus && props.schedule.status === 'paused'}>
        <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded text-xs">
          <PauseCircle class="w-2.5 h-2.5" />
          paused
        </span>
      </Show>
      <Show when={props.showStatus && props.schedule.status === 'expired'}>
        <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded text-xs">
          expired
        </span>
      </Show>
    </div>
  );
}
