/**
 * Streaming Message Component
 *
 * Renders assistant message content with incremental updates during streaming.
 */

import { Show, For, createMemo } from 'solid-js';
import { Bot } from 'lucide-solid';
import type {
  StreamingDelta,
  StreamingToolCall,
  StreamingUsage,
} from '../lib/use-streaming';

export type StreamingMessageProps = {
  deltas: StreamingDelta[];
  toolCalls: StreamingToolCall[];
  usage: StreamingUsage | null;
  isComplete: boolean;
  isError: boolean;
  error?: string;
};

export function StreamingMessage(props: StreamingMessageProps) {
  // Combine all deltas into accumulated content
  const content = createMemo(() => {
    return props.deltas.map((d) => d.content).join('');
  });

  return (
    <div class="rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center">
          <Bot class="w-4 h-4" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="font-medium text-sm text-text-primary">Assistant</span>
            <Show when={props.isError}>
              <span class="text-xs text-red-500">Error</span>
            </Show>
            <Show when={!props.isComplete && !props.isError}>
              <span class="text-xs text-text-tertiary animate-pulse">
                Streaming...
              </span>
            </Show>
          </div>

          {/* Error message */}
          <Show when={props.isError && props.error}>
            <p class="text-red-600 dark:text-red-400 text-sm">{props.error}</p>
          </Show>

          {/* Content */}
          <Show when={content()}>
            <p class="text-text-secondary whitespace-pre-wrap">{content()}</p>
          </Show>

          {/* Tool calls */}
          <Show when={props.toolCalls.length > 0}>
            <div class="mt-3 space-y-2">
              <For each={props.toolCalls}>
                {(toolCall) => (
                  <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-2 text-sm">
                    <span class="font-mono text-yellow-800 dark:text-yellow-200">
                      🔧 {toolCall.name}
                    </span>
                    <pre class="mt-1 text-xs overflow-x-auto">
                      {JSON.stringify(toolCall.input, null, 2)}
                    </pre>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Usage metadata */}
          <Show when={props.isComplete && props.usage}>
            <div class="mt-2 text-xs text-text-tertiary">
              <span>Tokens: </span>
              <span>in={props.usage!.inputTokens}, </span>
              <span>out={props.usage!.outputTokens}, </span>
              <span>total={props.usage!.totalTokens}</span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
