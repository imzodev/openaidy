/**
 * MessageContent
 *
 * Renders message text, extracting any
 */

import { Show, For } from 'solid-js';
import { marked } from 'marked';
import { parseThinking, ThinkingBlock } from './ThinkingBlock';

type MessageContentProps = { content: string };

// Detect if content contains markdown formatting
function isMarkdown(text: string): boolean {
  // Simple heuristic: check for common markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s/m, // Headers
    /\*\*[^*]+\*\*/m, // Bold
    /_[^_]+_/m, // Italic
    /`[^`]+`/m, // Inline code
    /^\s*[-*+]\s/m, // Unordered lists
    /^\s*\d+\.\s/m, // Ordered lists
    /^>\s/m, // Blockquotes
    /\[[^\]]+\]\([^)]+\)/m, // Links
    /^\|.*\|$/m, // Tables
  ];
  return markdownPatterns.some((pattern) => pattern.test(text));
}

export function MessageContent(props: MessageContentProps) {
  const parts = () => parseThinking(props.content);

  return (
    <For each={parts()}>
      {(part) => (
        <Show
          when={part.type === 'thinking'}
          fallback={
            <div class="text-text-secondary text-md">
              {isMarkdown((part as { type: 'text'; text: string }).text) ? (
                <div
                  class="prose prose-sm dark:prose-invert max-w-none"
                  innerHTML={
                    marked.parse(
                      (part as { type: 'text'; text: string }).text,
                    ) as string
                  }
                />
              ) : (
                <p class="whitespace-pre-wrap">
                  {(part as { type: 'text'; text: string }).text}
                </p>
              )}
            </div>
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
