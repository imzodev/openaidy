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
  // Below Tailwind's `md` (768px) we use the mobile layout: the agent picker
  // moves to a chip above the input, and the send button is merged into the
  // input pill — reclaiming horizontal room for typing. Defaults to desktop
  // when matchMedia is unavailable (e.g. jsdom under test).
  const [isMobile, setIsMobile] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  // Queue mode: usable composer, but submitting enqueues for later send.
  const isQueueing = () => !!props.isStreaming && !props.disabled;

  // Expose focus function to parent via callback when textarea is mounted
  onMount(() => {
    if (props.onInputReady) {
      props.onInputReady(() => textareaRef?.focus());
    }

    const mq = window.matchMedia?.('(max-width: 767px)');
    if (mq) {
      const update = () => setIsMobile(mq.matches);
      update();
      mq.addEventListener?.('change', update);
      onCleanup(() => mq.removeEventListener?.('change', update));
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

  const inputDisabled = () => props.disabled || isSending();
  const sendDisabled = () => props.disabled || isSending() || !input().trim();
  const sendAriaLabel = () => (isQueueing() ? 'Queue message' : 'Send message');
  const sendTitle = () =>
    isQueueing()
      ? 'Agent is responding — your message will be queued'
      : 'Send message';

  // Send-button inner content (spinner while sending, else queue/send icon).
  const sendIcon = () => (
    <Show
      when={isSending()}
      fallback={
        <Show when={isQueueing()} fallback={<Send class="w-4 h-4" />}>
          <ListPlus class="w-4 h-4" />
        </Show>
      }
    >
      <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
    </Show>
  );

  return (
    <form
      onSubmit={handleSubmit}
      class="border-t border-gray-200 dark:border-gray-700 px-3 py-2 md:p-4"
    >
      <Show
        when={isMobile()}
        fallback={
          /* ── Desktop / tablet (≥ md): [picker] [input] [send] ── */
          <div class="flex items-center gap-3">
            <AgentPicker
              agents={props.agents}
              selectedAgentId={props.selectedAgentId}
              onSelect={props.onAgentSelect}
              disabled={inputDisabled()}
            />

            <div class="flex-1">
              <textarea
                ref={setRef}
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                disabled={inputDisabled()}
                placeholder={placeholder()}
                rows={1}
                class="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-2 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-10 max-h-32 overflow-y-auto mt-1"
              />
            </div>

            <button
              type="submit"
              disabled={sendDisabled()}
              class="flex-shrink-0 w-10 h-10 rounded-lg bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
              aria-label={sendAriaLabel()}
              title={sendTitle()}
            >
              {sendIcon()}
            </button>
          </div>
        }
      >
        {/* ── Mobile (< md): one compact row — agent icon, input, send — in a
            single pill, so the chat scrollback keeps the vertical space. The
            agent is icon-only (its name shows in the picker sheet), and the
            keyboard hint below is hidden. ── */}
        <div class="flex items-end gap-1.5 rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-1 focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent">
          <AgentPicker
            variant="icon"
            agents={props.agents}
            selectedAgentId={props.selectedAgentId}
            onSelect={props.onAgentSelect}
            disabled={inputDisabled()}
          />
          <textarea
            ref={setRef}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={inputDisabled()}
            placeholder={placeholder()}
            rows={1}
            class="flex-1 min-w-0 resize-none bg-transparent py-1 text-text-primary placeholder-text-tertiary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed min-h-8 max-h-32 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={sendDisabled()}
            class="flex-shrink-0 w-8 h-8 rounded-full bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
            aria-label={sendAriaLabel()}
            title={sendTitle()}
          >
            {sendIcon()}
          </button>
        </div>
      </Show>

      {/* Keyboard hint — desktop only; hidden on mobile to maximize chat space. */}
      <p class="mt-2 text-xs text-text-tertiary hidden md:block">
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
