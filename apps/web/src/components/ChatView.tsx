import { Show, For, createEffect } from 'solid-js';
import {
  User,
  Bot,
  AlertCircle,
  Wrench,
  Server,
  CircleStop,
} from 'lucide-solid';
import type { SessionMessage } from '../lib/api';
import type { QueuedMessage } from '../lib/types';
import { TypingIndicator } from './TypingIndicator';
import { MessageContent } from './MessageContent';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock, ToolResultBlock } from './ToolBlocks';
import { QueuedMessageCard } from './QueuedMessageCard';

type StreamingToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Live stdout/stderr streamed while the tool runs (e.g. exec_run). */
  output?: string;
  /** True once the user cancelled this tool call. */
  cancelled?: boolean;
};

type ChatViewProps = {
  messages: SessionMessage[];
  isLoading: boolean;
  error?: string;
  streamingContent?: string;
  isStreaming?: boolean;
  streamingToolCalls?: StreamingToolCall[];
  /** Messages queued while the agent is responding; sent when it finishes. */
  queuedMessages?: QueuedMessage[];
  onEditQueued?: (id: string, content: string) => void;
  onRemoveQueued?: (id: string) => void;
  /** Ask the server to cancel an in-flight tool call. */
  onCancelTool?: (toolCallId: string) => void;
  /** Ask the server to cancel the whole in-flight run ("Stop agent"). */
  onCancelRun?: () => void;
  /** Message ID to scroll to (e.g. from clicking a run) */
  scrollToMessageId?: string;
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
    void props.queuedMessages?.length;
    if (!isUserScrolledUp) {
      bottomRef?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Scroll to a specific message when scrollToMessageId is set (e.g. from clicking a run)
  createEffect(() => {
    const targetId = props.scrollToMessageId;
    if (!targetId || !scrollContainerRef) return;
    const el = scrollContainerRef.querySelector(
      `[data-message-id="${targetId}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            <div
              class={`rounded-lg p-4 ${getRoleClass(message)}`}
              data-message-id={message.id}
            >
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
                    when={
                      message.role === 'assistant' && message.reasoningContent
                    }
                  >
                    <ThinkingBlock text={message.reasoningContent!} />
                  </Show>
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
                    {props.streamingContent
                      ? 'Streaming...'
                      : (props.streamingToolCalls?.length ?? 0) > 0
                        ? 'Using tools...'
                        : 'Thinking...'}
                  </span>
                </span>
                {/* Stop agent — aborts the whole run (provider stream + tools) */}
                <Show when={props.onCancelRun}>
                  <button
                    type="button"
                    onClick={() => props.onCancelRun?.()}
                    aria-label="Stop agent"
                    class="ml-auto inline-flex items-center gap-1 rounded border border-red-200 dark:border-red-800 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <CircleStop class="w-3.5 h-3.5" />
                    Stop agent
                  </button>
                </Show>
              </div>
              <Show when={props.streamingContent}>
                <div class="text-text-secondary mb-2">
                  <MessageContent content={props.streamingContent!} />
                  <span class="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                </div>
              </Show>
              <Show when={(props.streamingToolCalls?.length ?? 0) > 0}>
                <div class="space-y-1">
                  <For each={props.streamingToolCalls}>
                    {(tc) => (
                      <ToolCallBlock
                        name={tc.name}
                        input={tc.input}
                        isActive={!tc.cancelled}
                        output={tc.output}
                        cancelled={tc.cancelled}
                        onStop={
                          props.onCancelTool
                            ? () => props.onCancelTool?.(tc.id)
                            : undefined
                        }
                      />
                    )}
                  </For>
                </div>
              </Show>
              <Show
                when={
                  !props.streamingContent &&
                  (props.streamingToolCalls?.length ?? 0) === 0
                }
              >
                <TypingIndicator />
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Queued messages — awaiting send after the current run completes */}
      <Show when={(props.queuedMessages?.length ?? 0) > 0}>
        <div class="space-y-2" aria-label="Queued messages">
          <For each={props.queuedMessages}>
            {(queued, index) => (
              <QueuedMessageCard
                message={queued}
                position={index() + 1}
                onEdit={(id, content) => props.onEditQueued?.(id, content)}
                onRemove={(id) => props.onRemoveQueued?.(id)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
