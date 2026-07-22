import { Show, For, createEffect, onMount } from 'solid-js';
import { Bot, CircleStop } from 'lucide-solid';
import type { SessionMessage } from '../lib/api';
import type { QueuedMessage } from '../lib/types';
import { TypingIndicator } from './TypingIndicator';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolBlocks';
import { QueuedMessageCard } from './QueuedMessageCard';
import { RunActivityBadge } from './RunActivityBadge';
import type { RunActivityPhase } from './RunActivityBadge';
import { MessageListItem } from './MessageListItem';
import { LoadMoreControl } from './LoadMoreControl';
import { MessageContent } from './MessageContent';

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
  /** Server-driven activity heartbeat for the in-flight run (#378). */
  runActivity?: {
    phase: RunActivityPhase;
    toolName?: string;
    elapsedMs: number;
  };
  /** Message ID to scroll to (e.g. from clicking a run) */
  scrollToMessageId?: string;
  /** True while a "load older messages" page is being fetched. */
  isLoadingMore?: boolean;
  /** True when more pages exist on the server. */
  hasMore?: boolean;
  /** Total message count reported by the server (for end-of-history UI). */
  total?: number;
  /** Invoked when the user clicks "Load more" or scrolls to the top. */
  onLoadMore?: () => void;
};

export function ChatView(props: ChatViewProps) {
  let bottomRef: HTMLDivElement | undefined;
  let scrollContainerRef: HTMLDivElement | undefined;
  let isUserScrolledUp = false;

  // Tracks the id of the oldest loaded message so we can detect when a
  // "load older" page prepended messages (oldest id changes → scrollHeight
  // grew → adjust scrollTop to keep the user's view anchored).
  let oldestLoadedId: string | undefined;
  let prependedDelta = 0;

  const handleScroll = () => {
    if (!scrollContainerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    // Consider "at bottom" if within 80px of the bottom
    isUserScrolledUp = scrollHeight - scrollTop - clientHeight > 80;

    // Auto-trigger loading the previous page once the user reaches the top.
    // 16px hysteresis avoids re-firing while the user is mid-scroll.
    if (
      scrollTop <= 16 &&
      props.hasMore &&
      !props.isLoadingMore &&
      !props.isLoading &&
      props.onLoadMore
    ) {
      void props.onLoadMore();
    }
  };

  // Auto-scroll to the bottom whenever the message list grows by being
  // appended (new tail message, streaming content, queue). When the list
  // grows by being prepended ("load older"), we adjust scrollTop instead
  // so the user's view stays anchored — see the effect below.
  createEffect(() => {
    void props.messages.length;
    void props.streamingContent;
    void props.queuedMessages?.length;
    if (!scrollContainerRef) return;
    if (prependedDelta > 0) {
      // Don't snap to bottom; let the dedicated prepend effect adjust.
      return;
    }
    if (isUserScrolledUp) return;
    // Scroll the chat container directly. scrollIntoView on a nested
    // overflow-auto element inside an overflow-hidden parent can bubble up
    // to the document on mobile, dragging the sticky header (which lives
    // outside the chat container) off-screen.
    scrollContainerRef.scrollTo({
      top: scrollContainerRef.scrollHeight,
      behavior: 'smooth',
    });
  });

  // Detect prepends and adjust scroll position so the user's view doesn't
  // jump when older messages are inserted at the top. Solid effects run
  // after reactive updates but before the next paint; rAF guarantees the
  // new DOM height is committed before we adjust scrollTop.
  createEffect(() => {
    const list = props.messages;
    const newOldest = list[0]?.id;
    if (!newOldest) return;
    if (oldestLoadedId === undefined) {
      oldestLoadedId = newOldest;
      return;
    }
    if (newOldest === oldestLoadedId) return;
    // The first message id changed → a prepend happened.
    const container = scrollContainerRef;
    if (!container) return;
    const before = container.scrollHeight;
    oldestLoadedId = newOldest;
    requestAnimationFrame(() => {
      const after = container.scrollHeight;
      prependedDelta = Math.max(0, after - before);
      if (prependedDelta > 0) {
        container.scrollTop = container.scrollTop + prependedDelta;
      }
      // Clear the latch on the next frame so subsequent tail appends can
      // auto-scroll again.
      requestAnimationFrame(() => {
        prependedDelta = 0;
      });
    });
  });

  // Reset scroll anchor tracking when switching sessions.
  createEffect(() => {
    if (props.messages.length === 0) {
      oldestLoadedId = undefined;
    }
  });

  // Scroll to a specific message when scrollToMessageId is set (e.g. from
  // clicking a run). Same reason as above: keep the scroll inside the chat
  // container.
  createEffect(() => {
    const targetId = props.scrollToMessageId;
    if (!targetId || !scrollContainerRef) return;
    const el = scrollContainerRef.querySelector(
      `[data-message-id="${targetId}"]`,
    );
    if (el) {
      scrollContainerRef.scrollTo({
        top: (el as HTMLElement).offsetTop,
        behavior: 'smooth',
      });
    }
  });

  // Initial scroll-to-bottom once the first messages have rendered.
  onMount(() => {
    if (scrollContainerRef && props.messages.length > 0) {
      scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight;
    }
  });

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      class="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4"
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
          <Show when={props.onLoadMore}>
            <button
              type="button"
              class="mt-2 text-xs font-medium text-red-700 dark:text-red-300 underline"
              onClick={() => props.onLoadMore?.()}
            >
              Retry
            </button>
          </Show>
        </div>
      </Show>

      {/* Empty state */}
      <Show
        when={
          !props.isLoading &&
          !props.error &&
          props.messages.length === 0 &&
          !props.isStreaming
        }
      >
        <div class="flex flex-col items-center justify-center h-full text-text-tertiary">
          <Bot class="w-12 h-12 mb-4 opacity-50" />
          <p class="text-lg font-medium">No messages yet</p>
          <p class="text-sm mt-1">
            Start a conversation by sending a message below
          </p>
        </div>
      </Show>

      {/* Messages — rendered with date separators and a "load older" control */}
      <Show when={!props.isLoading && props.messages.length > 0}>
        <LoadMoreControl
          hasMore={props.hasMore ?? false}
          isLoadingMore={props.isLoadingMore ?? false}
          total={props.total}
          loaded={props.messages.length}
          onLoadMore={() => props.onLoadMore?.()}
        />
        <For each={props.messages}>
          {(message, index) => (
            <MessageListItem
              message={message}
              previous={index() > 0 ? props.messages[index() - 1] : undefined}
            />
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
              {/* Show the most recent assistant thinking block, if any */}
              <Show
                when={
                  props.messages.length > 0 &&
                  props.messages[props.messages.length - 1]?.reasoningContent
                }
              >
                <ThinkingBlock
                  text={
                    props.messages[props.messages.length - 1]!.reasoningContent!
                  }
                />
              </Show>
              <Show when={props.streamingContent}>
                <div class="text-text-secondary mb-2">
                  <MessageContent content={props.streamingContent!} />
                  <span class="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                </div>
              </Show>
              {/* Live activity heartbeat — what the agent is doing right now */}
              <Show when={props.runActivity}>
                <div class="mb-2">
                  <RunActivityBadge
                    phase={props.runActivity!.phase}
                    toolName={props.runActivity!.toolName}
                    elapsedMs={props.runActivity!.elapsedMs}
                  />
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
