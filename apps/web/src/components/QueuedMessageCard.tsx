import { Show, createSignal } from 'solid-js';
import { Clock, Pencil, X, Check } from 'lucide-solid';
import type { QueuedMessage } from '../lib/types';

type QueuedMessageCardProps = {
  message: QueuedMessage;
  /** 1-based position in the queue, shown to convey send order. */
  position: number;
  onEdit: (id: string, content: string) => void;
  onRemove: (id: string) => void;
};

/**
 * A single queued user message awaiting send. Distinct dashed styling and a
 * "Queued" badge separate it from sent messages; supports inline edit and
 * removal before it is dispatched.
 */
export function QueuedMessageCard(props: QueuedMessageCardProps) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal(props.message.content);
  let textareaRef: HTMLTextAreaElement | undefined;

  const startEdit = () => {
    setDraft(props.message.content);
    setEditing(true);
    // Focus once the textarea is rendered.
    queueMicrotask(() => textareaRef?.focus());
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(props.message.content);
  };

  const saveEdit = () => {
    const next = draft().trim();
    if (!next) {
      // Editing to empty is treated as removal — nothing useful to send.
      props.onRemove(props.message.id);
      return;
    }
    props.onEdit(props.message.id, next);
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div
      class="rounded-lg border border-dashed border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10 p-3"
      data-queued-message-id={props.message.id}
    >
      <div class="flex items-center gap-2 mb-1.5">
        <Clock class="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
        <span class="text-xs font-medium text-text-tertiary">
          Queued · #{props.position}
        </span>
        <Show when={!editing()}>
          <div class="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={startEdit}
              class="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
              aria-label="Edit queued message"
              title="Edit"
            >
              <Pencil class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => props.onRemove(props.message.id)}
              class="p-1 rounded text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              aria-label="Remove queued message"
              title="Remove"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </Show>
      </div>

      <Show
        when={editing()}
        fallback={
          <p class="text-sm text-text-secondary whitespace-pre-wrap break-words">
            {props.message.content}
          </p>
        }
      >
        <textarea
          ref={textareaRef}
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          class="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent max-h-32 overflow-y-auto"
          aria-label="Edit queued message text"
        />
        <div class="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={cancelEdit}
            class="px-2.5 py-1 text-xs rounded-lg text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={saveEdit}
            class="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-primary hover:bg-primary-hover text-white transition-colors"
          >
            <Check class="w-3 h-3" />
            Save
          </button>
        </div>
      </Show>
    </div>
  );
}
