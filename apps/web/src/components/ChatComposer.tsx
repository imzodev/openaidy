import { createSignal, Show } from 'solid-js';
import { Send } from 'lucide-solid';
import { AgentPicker } from './AgentPicker';
import type { Agent } from '../lib/api';

type ChatComposerProps = {
  onSend: (content: string, agentId?: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  agents: Agent[];
  selectedAgentId?: string;
  onAgentSelect: (agentId: string | undefined) => void;
};

export function ChatComposer(props: ChatComposerProps) {
  const [input, setInput] = createSignal('');
  const [isSending, setIsSending] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const content = input().trim();
    if (!content || props.disabled || isSending()) return;

    setIsSending(true);
    try {
      await props.onSend(content, props.selectedAgentId);
      setInput('');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      class="border-t border-gray-200 dark:border-gray-700 p-4"
    >
      <div class="flex items-end gap-3">
        {/* Agent picker */}
        <AgentPicker
          agents={props.agents}
          selectedAgentId={props.selectedAgentId}
          onSelect={props.onAgentSelect}
          disabled={props.disabled || isSending()}
        />

        {/* Text input */}
        <div class="flex-1">
          <textarea
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={props.disabled || isSending()}
            placeholder={props.placeholder || 'Type a message...'}
            rows={1}
            class="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 'min-height': '44px', 'max-height': '200px' }}
          />
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={props.disabled || isSending() || !input().trim()}
          class="flex-shrink-0 w-11 h-11 rounded-lg bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          <Show when={isSending()}>
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </Show>
          <Show when={!isSending()}>
            <Send class="w-4 h-4" />
          </Show>
        </button>
      </div>
      <p class="mt-2 text-xs text-text-tertiary">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}
