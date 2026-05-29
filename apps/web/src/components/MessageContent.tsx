/**
 * MessageContent
 *
 * Renders message text, extracting any <think>...</think> blocks into a
 * collapsible "Thinking" section that is hidden by default.
 */

import { Show, For } from 'solid-js';
import { parseThinking, ThinkingBlock } from './ThinkingBlock';

type MessageContentProps = { content: string };

export function MessageContent(props: MessageContentProps) {
  const parts = () => parseThinking(props.content);

  return (
    <For each={parts()}>
      {(part) => (
        <Show
          when={part.type === 'thinking'}
          fallback={
            <p class="text-text-secondary whitespace-pre-wrap text-md">
              {(part as { type: 'text'; text: string }).text}
            </p>
          }
        >
          <ThinkingBlock
            text={(part as { type: 'thinking'; text: string }).text}
          />
        </Show>
      )}
    </For>
  );
}
