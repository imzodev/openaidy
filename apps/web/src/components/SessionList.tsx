import { For, Show, createSignal } from 'solid-js';
import { Plus, MessageSquare, Trash2 } from 'lucide-solid';
import type { Session } from '../lib/api';

type SessionListProps = {
  sessions: Session[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onCreate: () => void;
  isLoading?: boolean;
};

export function SessionList(props: SessionListProps) {
  const [isCreating, setIsCreating] = createSignal(false);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await props.onCreate();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <aside class="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <h1 class="text-lg font-semibold text-gray-900 dark:text-white">OpenAidy</h1>
      </div>

      {/* New Session Button */}
      <div class="p-3">
        <button
          onClick={handleCreate}
          disabled={isCreating()}
          class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg transition-colors"
        >
          <Plus class="w-4 h-4" />
          <span>{isCreating() ? 'Creating...' : 'New Session'}</span>
        </button>
      </div>

      {/* Session List */}
      <div class="flex-1 overflow-y-auto">
        <Show when={props.isLoading}>
          <div class="p-4 text-center text-gray-500 dark:text-gray-400">
            Loading sessions...
          </div>
        </Show>

        <Show when={!props.isLoading && props.sessions.length === 0}>
          <div class="p-4 text-center text-gray-500 dark:text-gray-400">
            <MessageSquare class="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p class="text-sm">No sessions yet</p>
            <p class="text-xs mt-1">Create one to get started</p>
          </div>
        </Show>

        <ul class="space-y-1 p-2">
          <For each={props.sessions}>
            {(session) => (
              <li>
                <div
                  onClick={() => props.onSelect(session.id)}
                  class={`w-full text-left px-3 py-2 rounded-lg transition-colors group flex items-center gap-2 cursor-pointer ${
                    props.selectedId === session.id
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <MessageSquare class="w-4 h-4 flex-shrink-0" />
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
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>
    </aside>
  );
}
