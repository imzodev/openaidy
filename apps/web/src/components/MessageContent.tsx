/**
 * MessageContent
 *
 * Renders message text, extracting any
 */

import { Show, For } from 'solid-js';
import { marked } from 'marked';
import type { Token, TokensList } from 'marked';
import { parseThinking, ThinkingBlock } from './ThinkingBlock';
import { CodeBlock } from './ui/CodeBlock';

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

type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'code'; code: string; language?: string };

/**
 * Tokenize markdown into an ordered list of segments. Fenced code blocks
 * become Solid-rendered CodeBlock elements; every other top-level token is
 * serialized to HTML via marked's default renderer.
 */
function tokenizeMarkdown(text: string): Segment[] {
  const tokens = marked.lexer(text) as TokensList;
  const segments: Segment[] = [];
  let buffer: Token[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const html = marked.parser(buffer) as string;
    if (html) segments.push({ kind: 'html', html });
    buffer = [];
  };

  for (const token of tokens) {
    if (token.type === 'code') {
      flushBuffer();
      const codeToken = token as Token & {
        type: 'code';
        text: string;
        lang?: string;
      };
      segments.push({
        kind: 'code',
        code: codeToken.text.replace(/\n$/, ''),
        language: codeToken.lang || undefined,
      });
    } else if (token.type === 'space') {
      // Skip — marked.parser handles inter-block spacing.
      continue;
    } else {
      buffer.push(token);
    }
  }
  flushBuffer();
  return segments;
}

export function MessageContent(props: MessageContentProps) {
  const parts = () => parseThinking(props.content);

  return (
    <For each={parts()}>
      {(part) => (
        <Show
          when={part.type === 'thinking'}
          fallback={
            <div class="text-text-secondary text-md break-words">
              {isMarkdown((part as { type: 'text'; text: string }).text) ? (
                <MarkdownBody
                  text={(part as { type: 'text'; text: string }).text}
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

function MarkdownBody(props: { text: string }) {
  const segments = () => tokenizeMarkdown(props.text);

  return (
    <div class="prose prose-sm dark:prose-invert max-w-none">
      <For each={segments()}>
        {(segment) => (
          <Show
            when={segment.kind === 'code'}
            fallback={
              <span
                innerHTML={(segment as { kind: 'html'; html: string }).html}
              />
            }
          >
            <CodeBlock
              code={(segment as { kind: 'code'; code: string }).code}
              language={
                (segment as { kind: 'code'; language?: string }).language
              }
            />
          </Show>
        )}
      </For>
    </div>
  );
}
