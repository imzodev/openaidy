import { For, Show, createMemo } from 'solid-js';
import { useWebSocketContext } from '../lib/ws-provider';
import type { PresenceStatus } from '@openaidy/sdk';

type PresenceIndicatorProps = {
  /** Additional CSS classes */
  class?: string;
  /** Show client type labels */
  showLabels?: boolean;
};

// Status to color/icon mapping
const STATUS_CONFIG = {
  online: { color: 'bg-green-500', label: 'Online', icon: '●' },
  away: { color: 'bg-yellow-500', label: 'Away', icon: '◐' },
  busy: { color: 'bg-red-500', label: 'Busy', icon: '◉' },
  offline: { color: 'bg-gray-400', label: 'Offline', icon: '○' },
} as const;

// Client type display names
const CLIENT_TYPE_NAMES: Record<string, string> = {
  web: 'Web',
  cli: 'CLI',
  mobile: 'Mobile',
  channel: 'Bot',
};

// Get client type from presence metadata
function getClientType(metadata?: Record<string, unknown>): string {
  if (!metadata) return 'Unknown';
  return (metadata.clientType as string) || 'Unknown';
}

export function PresenceIndicator(props: PresenceIndicatorProps) {
  const { presence } = useWebSocketContext();

  const sortedPresence = createMemo(() => {
    const entries = presence();
    // Sort: online first, then away, busy, offline
    const statusOrder: Record<PresenceStatus, number> = {
      online: 0,
      away: 1,
      busy: 2,
      offline: 3,
    };
    return [...entries].sort(
      (a, b) => statusOrder[a.status] - statusOrder[b.status],
    );
  });

  const onlineCount = createMemo(
    () => presence().filter((p) => p.status === 'online').length,
  );

  return (
    <div
      class={`flex flex-col gap-1 ${props.class ?? ''}`}
      role="group"
      aria-label="Presence"
    >
      <Show when={presence().length > 0}>
        <div class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {onlineCount()} online
        </div>
        <ul class="flex flex-wrap gap-2" aria-label="Active users">
          <For each={sortedPresence()}>
            {(entry) => {
              const clientType = getClientType(entry.metadata);
              const statusInfo = STATUS_CONFIG[entry.status];
              return (
                <li
                  class="flex items-center gap-1 px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
                  title={`${clientType ? CLIENT_TYPE_NAMES[clientType] || clientType : 'Unknown'} - ${statusInfo.label}`}
                >
                  <span
                    class={`w-2 h-2 rounded-full ${statusInfo.color}`}
                    aria-hidden="true"
                  />
                  <Show when={props.showLabels && clientType}>
                    <span class="text-xs text-gray-600 dark:text-gray-400">
                      {CLIENT_TYPE_NAMES[clientType] || clientType}
                    </span>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
      <Show when={presence().length === 0}>
        <span class="text-sm text-gray-500 dark:text-gray-400">
          No active users
        </span>
      </Show>
    </div>
  );
}
