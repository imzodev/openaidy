import { Show } from 'solid-js';
import { User, Bot, AlertCircle, Wrench, Server } from 'lucide-solid';
import { COMPACTION_SUMMARY_KIND } from '@aidyagent/shared-types';
import type { SessionMessage } from '../lib/api';
import { MessageContent } from './MessageContent';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolResultBlock } from './ToolBlocks';
import { AttachmentList } from './AttachmentList';
import { CopyButton } from './ui/CopyButton';
import { Wordmark } from './ui/Wordmark';
import { MessageDateSeparator } from './MessageDateSeparator';

export type MessageListItemProps = {
  message: SessionMessage;
  /** The previous message in chronological order. Used for the date separator. */
  previous?: SessionMessage;
};

function isMcpTool(message: SessionMessage): boolean {
  return (
    typeof message.metadata?.toolName === 'string' &&
    (message.metadata.toolName as string).includes('::')
  );
}

function getRoleIcon(message: SessionMessage) {
  switch (message.role) {
    case 'user':
      return <User class="w-3.5 h-3.5" />;
    case 'assistant':
      return <Bot class="w-3.5 h-3.5" />;
    case 'tool':
      return isMcpTool(message) ? (
        <Server class="w-3.5 h-3.5" />
      ) : (
        <Wrench class="w-3.5 h-3.5" />
      );
    default:
      return <AlertCircle class="w-3.5 h-3.5" />;
  }
}

function getRoleLabel(message: SessionMessage): string {
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
}

function getBubbleClass(message: SessionMessage): string {
  switch (message.role) {
    case 'user':
      return 'bg-blue-600 text-white';
    case 'assistant':
      return 'bg-transparent';
    case 'tool':
      return isMcpTool(message)
        ? 'bg-purple-50/70 dark:bg-purple-900/15'
        : 'bg-fill';
    default:
      return 'bg-amber-50 dark:bg-amber-900/15';
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Render a single chat message: user turns as right-aligned bubbles,
 * assistant turns as clean text beside the Aidy glyph, tool/system turns as
 * quiet inset cards. Includes copy, timestamp, optional thinking/tool/
 * attachment blocks, and a date separator when the calendar day changes.
 */
export function MessageListItem(props: MessageListItemProps) {
  const isUser = () => props.message.role === 'user';
  const isAssistant = () => props.message.role === 'assistant';

  return (
    <Show
      when={props.message.metadata?.kind !== COMPACTION_SUMMARY_KIND}
      fallback={<CompactionDivider content={props.message.content} />}
    >
      <MessageDateSeparator current={props.message} previous={props.previous} />
      <Show
        when={isUser()}
        fallback={
          <div
            class={`group flex items-start gap-3 animate-rise-in ${
              isAssistant() ? 'py-1' : 'rounded-xl px-3 py-2.5'
            } ${getBubbleClass(props.message)}`}
            data-message-id={props.message.id}
          >
            <div class="flex-shrink-0">
              <Show
                when={isAssistant()}
                fallback={
                  <div class="w-7 h-7 rounded-full bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center text-text-tertiary">
                    {getRoleIcon(props.message)}
                  </div>
                }
              >
                <Wordmark iconOnly size="md" />
              </Show>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 h-7 mb-0.5">
                <span class="font-semibold text-[13px] text-text-primary truncate">
                  {getRoleLabel(props.message)}
                </span>
                <span class="text-[11px] text-text-muted flex-shrink-0">
                  {formatTime(props.message.createdAt)}
                </span>
                <Show when={props.message.content}>
                  <span class="ml-auto md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <CopyButton text={props.message.content} />
                  </span>
                </Show>
              </div>
              <Show when={isAssistant() && props.message.reasoningContent}>
                <ThinkingBlock text={props.message.reasoningContent!} />
              </Show>
              <Show
                when={props.message.role === 'tool'}
                fallback={<MessageContent content={props.message.content} />}
              >
                <ToolResultBlock
                  content={props.message.content}
                  isMcp={isMcpTool(props.message)}
                />
              </Show>
              <Show when={props.message.attachments?.length}>
                <AttachmentList attachments={props.message.attachments!} />
              </Show>
            </div>
          </div>
        }
      >
        <div
          class="group flex flex-col items-end gap-1 animate-rise-in"
          data-message-id={props.message.id}
        >
          <span class="sr-only">{getRoleLabel(props.message)}</span>
          <div
            class={`max-w-[85%] md:max-w-[75%] rounded-[20px] rounded-br-md px-4 py-2.5 shadow-sm [&_*]:!text-white [&_a]:underline [&_code]:!bg-white/20 ${getBubbleClass(
              props.message,
            )}`}
          >
            <MessageContent content={props.message.content} />
            <Show when={props.message.attachments?.length}>
              <AttachmentList attachments={props.message.attachments!} />
            </Show>
          </div>
          <div class="flex items-center gap-1.5 px-1 h-6 text-[11px] text-text-muted md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <span>{formatTime(props.message.createdAt)}</span>
            <Show when={props.message.content}>
              <CopyButton text={props.message.content} />
            </Show>
          </div>
        </div>
      </Show>
    </Show>
  );
}

/**
 * The agent condensed the turns above into a summary to save context. Shown
 * as a quiet divider; the summary itself is one click away.
 */
function CompactionDivider(props: { content: string }) {
  return (
    <details class="group my-2 text-xs text-text-tertiary">
      <summary class="flex items-center gap-3 cursor-pointer list-none select-none">
        <span class="flex-1 h-px bg-separator" />
        <span>Earlier conversation summarized</span>
        <span class="flex-1 h-px bg-separator" />
      </summary>
      <div class="mt-2 rounded-xl p-3 bg-fill text-sm text-text-secondary">
        <MessageContent content={props.content} />
      </div>
    </details>
  );
}
