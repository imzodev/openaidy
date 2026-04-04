import { createMemo, Show } from 'solid-js';
import { useWebSocketContext } from '../lib/ws-provider';
import type { WebSocketClientState } from '@openaidy/sdk';

type ConnectionStatusProps = {
  /** Show detailed status text */
  showDetails?: boolean;
  /** Additional CSS classes */
  class?: string;
};

const STATUS_CONFIG: Record<
  WebSocketClientState,
  { label: string; color: string; icon: string }
> = {
  connected: { label: 'Connected', color: 'bg-green-500', icon: '●' },
  connecting: { label: 'Connecting', color: 'bg-yellow-500', icon: '◐' },
  reconnecting: { label: 'Reconnecting', color: 'bg-yellow-500', icon: '↻' },
  disconnected: { label: 'Disconnected', color: 'bg-gray-400', icon: '○' },
  error: { label: 'Error', color: 'bg-red-500', icon: '✕' },
};

export function ConnectionStatus(props: ConnectionStatusProps) {
  const { state, error } = useWebSocketContext();

  const status = createMemo(
    () => STATUS_CONFIG[state()] ?? STATUS_CONFIG.disconnected,
  );

  return (
    <div
      class={`flex items-center gap-2 ${props.class ?? ''}`}
      role="status"
      aria-live="polite"
      aria-label={`Connection status: ${status().label}`}
    >
      <span
        class={`inline-block w-2 h-2 rounded-full ${status().color} ${
          state() === 'connecting' || state() === 'reconnecting'
            ? 'animate-pulse'
            : ''
        }`}
        aria-hidden="true"
      />
      <Show when={props.showDetails}>
        <span class="text-sm text-gray-600 dark:text-gray-400">
          {status().label}
        </span>
        <Show when={error()}>
          <span class="text-xs text-red-500" title={error()}>
            {error()}
          </span>
        </Show>
      </Show>
    </div>
  );
}
