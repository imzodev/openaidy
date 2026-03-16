import { createSignal, Show } from 'solid-js';
import { Send } from 'lucide-solid';

type ChatComposerProps = {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
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
      await props.onSend(content);
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
    <form onSubmit={handleSubmit} class="border-t border-gray-200 dark:border-gray-700 p-4">
      <div class="flex items-end gap-3">
        <div class="flex-1">
          <textarea
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={props.disabled || isSending()}
            placeholder={props.placeholder || 'Type a message...'}
            rows={1}
            class="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 'min-height': '44px', 'max-height': '200px' }}
          />
        </div>
        <button
          type="submit"
          disabled={props.disabled || isSending() || !input().trim()}
          class="flex-shrink-0 w-11 h-11 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
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
      <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}
