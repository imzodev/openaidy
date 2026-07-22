import { Show } from 'solid-js';
import {
  formatDateSeparator,
  shouldShowDateSeparator,
} from '../lib/message-date';
import type { SessionMessage } from '../lib/api';

export type MessageDateSeparatorProps = {
  /** Current message — the separator renders before it. */
  current: Pick<SessionMessage, 'createdAt'>;
  /** Previous message — used to decide whether a separator is needed. */
  previous: Pick<SessionMessage, 'createdAt'> | undefined;
  /** Override "now" for testing the relative labels (Today / Yesterday). */
  now?: Date;
};

/**
 * Render a horizontal date banner above a message when its calendar day
 * differs from the previous message's day. Pure visual component — the
 * decision logic lives in `lib/message-date.ts`.
 */
export function MessageDateSeparator(props: MessageDateSeparatorProps) {
  const shouldShow = () =>
    shouldShowDateSeparator(props.current, props.previous);
  const label = () =>
    props.now
      ? formatDateSeparator(props.current.createdAt, props.now)
      : formatDateSeparator(props.current.createdAt);

  return (
    <Show when={shouldShow()}>
      <div
        class="flex items-center gap-3 px-1"
        aria-label={label()}
        data-date-separator
      >
        <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span class="text-xs font-medium text-text-tertiary">{label()}</span>
        <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>
    </Show>
  );
}
