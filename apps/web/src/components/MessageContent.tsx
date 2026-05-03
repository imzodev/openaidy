/**
 * MessageContent
 *
 * Renders message text, extracting any <think>...</think> blocks into a
 * collapsible "Thinking" section that is hidden by default.
 */

import { Show, For, createSignal } from 'solid-js';
import { ChevronDown, ChevronRight, Wrench, Server } from 'lucide-solid';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string };

export function parseThinking(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const regex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index).trim();
      if (text) parts.push({ type: 'text', text });
    }
    if (match[1]?.trim()) {
      parts.push({ type: 'thinking', text: match[1].trim() });
    }
    lastIndex = regex.lastIndex;
  }

  const remaining = content.slice(lastIndex).trim();
  if (remaining) {
    parts.push({ type: 'text', text: remaining });
  }

  return parts;
}

type ThinkingBlockProps = { text: string };

function ThinkingBlock(props: ThinkingBlockProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="mb-2 rounded border border-gray-200 dark:border-gray-700 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm font-medium text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <Show
          when={open()}
          fallback={<ChevronRight class="w-3 h-3 flex-shrink-0" />}
        >
          <ChevronDown class="w-3 h-3 flex-shrink-0" />
        </Show>
        Thinking
      </button>
      <Show when={open()}>
        <div class="px-3 pb-3 pt-0">
          <p class="whitespace-pre-wrap text-sm text-text-tertiary italic leading-relaxed">
            {props.text}
          </p>
        </div>
      </Show>
    </div>
  );
}

type ToolCallBlockProps = {
  name: string;
  input: Record<string, unknown>;
};

export function ToolCallBlock(props: ToolCallBlockProps) {
  const [open, setOpen] = createSignal(false);
  const isMcp = () => props.name.includes('::');
  const label = () => {
    if (isMcp()) {
      const [serverId, name] = props.name.split('::');
      return `${serverId} / ${name}`;
    }
    return props.name;
  };

  return (
    <div
      class={`mb-2 rounded border text-sm ${
        isMcp()
          ? 'border-purple-200 dark:border-purple-800'
          : 'border-yellow-200 dark:border-yellow-800'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-medium transition-colors ${
          isMcp()
            ? 'text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100'
            : 'text-yellow-700 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-100'
        }`}
      >
        <Show
          when={open()}
          fallback={<ChevronRight class="w-3 h-3 flex-shrink-0" />}
        >
          <ChevronDown class="w-3 h-3 flex-shrink-0" />
        </Show>
        {isMcp() ? (
          <Server class="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <Wrench class="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <span class="font-mono">{label()}</span>
      </button>
      <Show when={open()}>
        <div class="px-3 pb-3 pt-0">
          <pre class="text-xs overflow-x-auto text-text-secondary">
            {JSON.stringify(props.input, null, 2)}
          </pre>
        </div>
      </Show>
    </div>
  );
}

type ToolResultBlockProps = {
  content: string;
  isMcp: boolean;
};

export function ToolResultBlock(props: ToolResultBlockProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <div
      class={`rounded border text-sm ${
        props.isMcp
          ? 'border-purple-200 dark:border-purple-800'
          : 'border-yellow-200 dark:border-yellow-800'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-medium transition-colors ${
          props.isMcp
            ? 'text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100'
            : 'text-yellow-700 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-100'
        }`}
      >
        <Show
          when={open()}
          fallback={<ChevronRight class="w-3 h-3 flex-shrink-0" />}
        >
          <ChevronDown class="w-3 h-3 flex-shrink-0" />
        </Show>
        <span class="text-xs">result</span>
      </button>
      <Show when={open()}>
        <div class="px-3 pb-3 pt-0">
          <pre class="text-xs overflow-x-auto text-text-secondary whitespace-pre-wrap">
            {props.content}
          </pre>
        </div>
      </Show>
    </div>
  );
}

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
