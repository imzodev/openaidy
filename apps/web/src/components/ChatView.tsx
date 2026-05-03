import { Show, For, createEffect } from 'solid-js';
import { User, Bot, AlertCircle, Wrench, Server } from 'lucide-solid';
import type { SessionMessage } from '../lib/api';
import { TypingIndicator } from './TypingIndicator';
import { MessageContent, ToolResultBlock } from './MessageContent';

type ChatViewProps = {
  messages: SessionMessage[];
  isLoading: boolean;
  error?: string;
  streamingContent?: string;
  isStreaming?: boolean;
};

export function ChatView(props: ChatViewProps) {
  let bottomRef: HTMLDivElement | undefined;
  let scrollContainerRef: HTMLDivElement | undefined;
  let isUserScrolledUp = false;

  const handleScroll = () => {
    if (!scrollContainerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    // Consider "at bottom" if within 80px of the bottom
    isUserScrolledUp = scrollHeight - scrollTop - clientHeight > 80;
  };

  createEffect(() => {
    void props.messages.length;
    void props.streamingContent;
    if (!isUserScrolledUp) {
      bottomRef?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  const isMcpTool = (message: SessionMessage) =>
    typeof message.metadata?.toolName === 'string' &&
    (message.metadata.toolName as string).includes('::');

  const getRoleIcon = (message: SessionMessage) => {
    switch (message.role) {
      case 'user':
        return <User class="w-4 h-4" />;
      case 'assistant':
        return <Bot class="w-4 h-4" />;
      case 'tool':
        return isMcpTool(message) ? (
          <Server class="w-4 h-4" />
        ) : (
          <Wrench class="w-4 h-4" />
        );
      default:
        return <AlertCircle class="w-4 h-4" />;
    }
  };

  const getRoleLabel = (message: SessionMessage) => {
    switch (message.role) {
      case 'user':
        return 'You';
      case 'assistant':
        return 'Assistant';
      case 'system':
        return 'System';
      case 'tool': {
        const toolName = message.metadata?.toolName;
        if (typeof toolName !== 'string') return 'tool';
        if (toolName.includes('::')) {
          const [serverId, name] = toolName.split('::');
          return `${serverId} / ${name}`;
        }
        return toolName;
      }
      default:
        return message.role;
    }
  };

  const getRoleClass = (message: SessionMessage) => {
    switch (message.role) {
      case 'user':
        return 'bg-blue-50 dark:bg-blue-900/20';
      case 'assistant':
        return 'bg-gray-50 dark:bg-gray-800';
      case 'tool':
        return isMcpTool(message)
          ? 'bg-purple-50 dark:bg-purple-900/20'
          : 'bg-yellow-50 dark:bg-yellow-900/20';
      default:
        return 'bg-yellow-50 dark:bg-yellow-900/20';
    }
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      class="flex-1 overflow-y-auto p-4 space-y-4"
    >
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
            <div class={`rounded-lg p-4 ${getRoleClass(message)}`}>
              <div class="flex items-start gap-3">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center">
                  {getRoleIcon(message)}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-medium text-sm text-text-primary">
                      {getRoleLabel(message)}
                    </span>
                    <span class="text-xs text-text-tertiary">
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <Show
                    when={message.role === 'tool'}
                    fallback={<MessageContent content={message.content} />}
                  >
                    <ToolResultBlock
                      content={message.content}
                      isMcp={isMcpTool(message)}
                    />
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
      </Show>

      {/* Streaming content display — shown while waiting or receiving */}
      <Show when={props.isStreaming}>
        <div class="rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center">
              <Bot class="w-4 h-4" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-sm text-text-primary">
                  Assistant
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  <span class="text-xs text-text-tertiary">
                    {props.streamingContent ? 'Streaming...' : 'Thinking...'}
                  </span>
                </span>
              </div>
              <Show
                when={props.streamingContent}
                fallback={<TypingIndicator />}
              >
                <div class="text-text-secondary">
                  <MessageContent content={props.streamingContent!} />
                  <span class="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
