import { Show, For } from 'solid-js';
import { MessageSquare, Plus, Trash2, Clock } from 'lucide-solid';
import type { Session } from '../../lib/api';

type SessionsPageProps = {
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession?: (id: string) => void;
  isLoading?: boolean;
};

export function SessionsPage(props: SessionsPageProps) {
  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="w-full py-6 px-4 sm:px-6">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-2xl font-bold text-text-primary">Sessions</h1>
          <button
            onClick={props.onCreateSession}
            class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Plus class="w-4 h-4" />
            New Session
          </button>
        </div>

        <Show when={props.isLoading}>
          <div class="text-center py-12">
            <div class="animate-pulse text-text-tertiary">
              Loading sessions...
            </div>
          </div>
        </Show>

        <Show when={!props.isLoading && props.sessions.length === 0}>
          <div class="text-center py-12">
            <MessageSquare class="w-12 h-12 mx-auto mb-4 text-text-muted" />
            <h3 class="text-lg font-medium text-text-primary mb-2">
              No sessions yet
            </h3>
            <p class="text-text-secondary mb-4">
              Create a new session to start chatting with agents
            </p>
            <button
              onClick={props.onCreateSession}
              class="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors"
            >
              Create Session
            </button>
          </div>
        </Show>

        <Show when={!props.isLoading && props.sessions.length > 0}>
          <div class="grid gap-4">
            <For each={props.sessions}>
              {(session) => (
                <div
                  class={`p-4 rounded-lg border transition-all cursor-pointer ${
                    props.selectedSessionId === session.id
                      ? 'border-primary bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                  onClick={() => props.onSelectSession(session.id)}
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <h3 class="font-medium text-text-primary truncate">
                        {session.title}
                      </h3>
                      <div class="flex items-center gap-2 mt-1 text-sm text-text-tertiary">
                        <Clock class="w-3.5 h-3.5" />
                        <span>{formatDate(session.createdAt)}</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <Show when={props.onDeleteSession}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onDeleteSession?.(session.id);
                          }}
                          class="p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          title="Delete session"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
