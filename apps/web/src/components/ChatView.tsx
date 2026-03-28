import { Show, For } from 'solid-js';
import { User, Bot, AlertCircle } from 'lucide-solid';
import type { SessionMessage } from '../lib/api';

type ChatViewProps = {
  messages: SessionMessage[];
  isLoading: boolean;
  error?: string;
};

export function ChatView(props: ChatViewProps) {
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'user':
        return <User class="w-4 h-4" />;
      case 'assistant':
        return <Bot class="w-4 h-4" />;
      default:
        return <AlertCircle class="w-4 h-4" />;
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'user':
        return 'You';
      case 'assistant':
        return 'Assistant';
      case 'system':
        return 'System';
      default:
        return role;
    }
  };

  const getRoleClass = (role: string) => {
    switch (role) {
      case 'user':
        return 'bg-blue-50 dark:bg-blue-900/20';
      case 'assistant':
        return 'bg-gray-50 dark:bg-gray-800';
      default:
        return 'bg-yellow-50 dark:bg-yellow-900/20';
    }
  };

  return (
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Loading state */}
      <Show when={props.isLoading}>
        <div class="flex items-center justify-center h-full">
          <div class="animate-pulse flex items-center gap-2 text-text-tertiary">
            <div class="w-2 h-2 bg-primary rounded-full animate-bounce" />
            <div
              class="w-2 h-2 bg-primary rounded-full animate-bounce"
              style={{ 'animation-delay': '0.1s' }}
            />
            <div
              class="w-2 h-2 bg-primary rounded-full animate-bounce"
              style={{ 'animation-delay': '0.2s' }}
            />
            <span class="ml-2">Loading messages...</span>
          </div>
        </div>
      </Show>

      {/* Error state */}
      <Show when={props.error}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p class="text-red-600 dark:text-red-400 text-sm">{props.error}</p>
        </div>
      </Show>

      {/* Empty state */}
      <Show
        when={!props.isLoading && !props.error && props.messages.length === 0}
      >
        <div class="flex flex-col items-center justify-center h-full text-text-tertiary">
          <Bot class="w-12 h-12 mb-4 opacity-50" />
          <p class="text-lg font-medium">No messages yet</p>
          <p class="text-sm mt-1">
            Start a conversation by sending a message below
          </p>
        </div>
      </Show>

      {/* Messages */}
      <Show when={!props.isLoading && props.messages.length > 0}>
        <For each={props.messages}>
          {(message) => (
            <div class={`rounded-lg p-4 ${getRoleClass(message.role)}`}>
              <div class="flex items-start gap-3">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center">
                  {getRoleIcon(message.role)}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-medium text-sm text-text-primary">
                      {getRoleLabel(message.role)}
                    </span>
                    <span class="text-xs text-text-tertiary">
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p class="text-text-secondary whitespace-pre-wrap">
                    {message.content}
                  </p>
                </div>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
