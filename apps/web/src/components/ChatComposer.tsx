import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Send, ListPlus } from 'lucide-solid';
import { AgentPicker } from './AgentPicker';
import type { Agent } from '../lib/api';

type ChatComposerProps = {
  onSend: (content: string, agentId?: string) => Promise<void>;
  /** Hard-disable the composer (e.g. no session / disconnected). */
  disabled?: boolean;
  /**
   * The agent is currently responding. The composer stays usable; submitting
   * queues the message instead of sending it immediately.
   */
  isStreaming?: boolean;
  placeholder?: string;
  agents: Agent[];
  selectedAgentId?: string;
  onAgentSelect: (agentId: string | undefined) => void;
  /** Called when the component mounts, passing a focus function */
  onInputReady?: (focus: () => void) => void;
};

export function ChatComposer(props: ChatComposerProps) {
  const [input, setInput] = createSignal('');
  const [isSending, setIsSending] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  // Queue mode: usable composer, but submitting enqueues for later send.
  const isQueueing = () => !!props.isStreaming && !props.disabled;

  // Expose focus function to parent via callback when textarea is mounted
  onMount(() => {
    if (props.onInputReady) {
      props.onInputReady(() => textareaRef?.focus());
    }
    onCleanup(() => {
      textareaRef = undefined; // Clear ref on unmount to prevent stale closures
    });
  });

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

  const placeholder = () =>
    isQueueing()
      ? 'Queue a follow-up message…'
      : props.placeholder || 'Type a message...';

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const setRef = (el: HTMLTextAreaElement | undefined) => {
    textareaRef = el;
  };

  return (
    <form
      onSubmit={handleSubmit}
      class="border-t border-gray-200 dark:border-gray-700 p-4"
    >
      <div class="flex items-center gap-3">
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
            ref={setRef}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={props.disabled || isSending()}
            placeholder={placeholder()}
            rows={1}
            class="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-2 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-10 max-h-32 overflow-y-auto mt-1"
          />
        </div>

        {/* Send / queue button */}
        <button
          type="submit"
          disabled={props.disabled || isSending() || !input().trim()}
          class="flex-shrink-0 w-10 h-10 rounded-lg bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
          aria-label={isQueueing() ? 'Queue message' : 'Send message'}
          title={
            isQueueing()
              ? 'Agent is responding — your message will be queued'
              : 'Send message'
          }
        >
          <Show when={isSending()}>
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </Show>
          <Show when={!isSending()}>
            <Show when={isQueueing()} fallback={<Send class="w-4 h-4" />}>
              <ListPlus class="w-4 h-4" />
            </Show>
          </Show>
        </button>
      </div>
      <p class="mt-2 text-xs text-text-tertiary">
        <Show
          when={isQueueing()}
          fallback="Press Enter to send, Shift+Enter for new line"
        >
          Agent is responding — Enter queues your message, sent when it finishes
        </Show>
      </p>
    </form>
  );
}
