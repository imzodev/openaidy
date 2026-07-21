import { Show } from 'solid-js';
import { User, Bot, AlertCircle, Wrench, Server } from 'lucide-solid';
import type { SessionMessage } from '../lib/api';
import { MessageContent } from './MessageContent';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolResultBlock } from './ToolBlocks';
import { AttachmentList } from './AttachmentList';
import { CopyButton } from './ui/CopyButton';
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
}

/**
 * Render a single chat message with the appropriate role icon, label,
 * timestamp, copy button, optional thinking/tool/attachment blocks, and a
 * date separator when the calendar day changes from the previous message.
 */
export function MessageListItem(props: MessageListItemProps) {
  return (
    <>
      <MessageDateSeparator current={props.message} previous={props.previous} />
      <div
        class={`rounded-lg p-4 ${getBubbleClass(props.message)}`}
        data-message-id={props.message.id}
      >
        <div class="flex items-start gap-3">
          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center">
            {getRoleIcon(props.message)}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium text-sm text-text-primary">
                {getRoleLabel(props.message)}
              </span>
              <span class="text-xs text-text-tertiary">
                {new Date(props.message.createdAt).toLocaleTimeString()}
              </span>
              <Show when={props.message.content}>
                <span class="ml-auto">
                  <CopyButton text={props.message.content} />
                </span>
              </Show>
            </div>
            <Show
              when={
                props.message.role === 'assistant' &&
                props.message.reasoningContent
              }
            >
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
      </div>
    </>
  );
}
