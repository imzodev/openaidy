import { For, Show, createMemo } from 'solid-js';
import { MessageSquare, Trash2 } from 'lucide-solid';
import type { Session } from '../lib/api';

type SessionListProps = {
  sessions: Session[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  isLoading?: boolean;
  isCollapsed: boolean;
  isActiveView: boolean;
};

// Most recent activity first. Falls back to createdAt for legacy sessions that
// don't have an updatedAt (e.g. in-memory backend records).
function lastActivityMs(session: Session): number {
  const ts = session.updatedAt ?? session.createdAt;
  return ts ? new Date(ts).getTime() : 0;
}

export function SessionList(props: SessionListProps) {
  const sortedSessions = createMemo(() =>
    [...props.sessions].sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
  );
  return (
    <div class="h-full flex flex-col">
      <Show when={props.isLoading}>
        <div class="p-4 text-center text-text-tertiary">
          <Show when={!props.isCollapsed}>
            <span>Loading sessions...</span>
          </Show>
          <Show when={props.isCollapsed}>
            <span class="animate-pulse">...</span>
          </Show>
        </div>
      </Show>

      <Show when={!props.isLoading && props.sessions.length === 0}>
        <div
          class={`p-4 text-center text-text-tertiary ${props.isCollapsed ? 'px-2' : ''}`}
        >
          <MessageSquare class="w-6 h-6 mx-auto mb-2 opacity-50" />
          <Show when={!props.isCollapsed}>
            <p class="text-sm">No sessions yet</p>
            <p class="text-xs mt-1">Create one</p>
          </Show>
        </div>
      </Show>

      <ul class="space-y-1 p-2 flex-1 overflow-y-auto">
        <For each={sortedSessions()}>
          {(session) => (
            <li>
              <div
                onClick={() => props.onSelect(session.id)}
                class={`w-full text-left py-2 rounded-lg transition-colors group flex items-center cursor-pointer ${
                  props.isActiveView && props.selectedId === session.id
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary'
                } ${props.isCollapsed ? 'justify-center px-0' : 'px-3 gap-2'}`}
                title={props.isCollapsed ? session.title : undefined}
              >
                <MessageSquare class="w-4 h-4 flex-shrink-0" />
                <Show when={!props.isCollapsed}>
                  <span class="truncate flex-1">{session.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // TODO: Implement delete
                    }}
                    class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity"
                    aria-label="Delete session"
                  >
                    <Trash2 class="w-3 h-3" />
                  </button>
                </Show>
              </div>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
