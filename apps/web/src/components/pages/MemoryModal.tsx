/**
 * MemoryModal
 *
 * Create or edit an agent memory. Collects title, content, tags and an
 * importance score (1–5, picked via clickable stars). In create mode the
 * owning agent is chosen from a dropdown; in edit mode the agent is fixed.
 */

import { createSignal, createEffect, For, Show } from 'solid-js';
import { X, Plus, Star } from 'lucide-solid';
import { Modal } from '../ui/Modal';
import {
  createMemory,
  updateMemory,
  type Memory,
  type MemoryAgentSummary,
} from '../../lib/api';

type Props = {
  isOpen: boolean;
  mode: 'create' | 'edit';
  agents: MemoryAgentSummary[];
  defaultAgentId?: string;
  memory?: Memory;
  onClose: () => void;
  onSaved: () => void;
};

export function MemoryModal(props: Props) {
  const [agentId, setAgentId] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [content, setContent] = createSignal('');
  const [tagInput, setTagInput] = createSignal('');
  const [tags, setTags] = createSignal<string[]>([]);
  const [importance, setImportance] = createSignal(3);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // (Re)initialise fields whenever the modal opens or its target changes.
  createEffect(() => {
    if (!props.isOpen) return;
    if (props.mode === 'edit' && props.memory) {
      setAgentId(props.memory.agentId);
      setTitle(props.memory.title);
      setContent(props.memory.content);
      setTags([...props.memory.tags]);
      setImportance(props.memory.importance);
    } else {
      setAgentId(props.defaultAgentId ?? props.agents[0]?.id ?? '');
      setTitle('');
      setContent('');
      setTags([]);
      setImportance(3);
    }
    setTagInput('');
    setError(null);
  });

  const addTag = () => {
    const t = tagInput().trim();
    if (t && !tags().includes(t)) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) =>
    setTags((prev) => prev.filter((t) => t !== tag));

  const handleTagKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  };

  const isValid = () =>
    title().trim().length > 0 &&
    content().trim().length > 0 &&
    (props.mode === 'edit' || agentId().length > 0);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!isValid()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      if (props.mode === 'edit' && props.memory) {
        await updateMemory(props.memory.id, {
          title: title().trim(),
          content: content().trim(),
          tags: tags(),
          importance: importance(),
        });
      } else {
        await createMemory({
          agentId: agentId(),
          title: title().trim(),
          content: content().trim(),
          tags: tags(),
          importance: importance(),
        });
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={props.mode === 'edit' ? 'Edit Memory' : 'New Memory'}
      size="lg"
    >
      <form onSubmit={handleSubmit} class="space-y-5">
        {/* Error banner */}
        <Show when={error()}>
          <div class="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg">
            {error()}
          </div>
        </Show>

        {/* Agent (create only) */}
        <Show when={props.mode === 'create'}>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Agent <span class="text-red-500">*</span>
            </label>
            <select
              value={agentId()}
              onChange={(e) => setAgentId(e.currentTarget.value)}
              class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              required
            >
              <option value="" disabled>
                Select an agent…
              </option>
              <For each={props.agents}>
                {(agent) => <option value={agent.id}>{agent.name}</option>}
              </For>
            </select>
          </div>
        </Show>

        {/* Title */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Title <span class="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder="Short, memorable title"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            required
          />
        </div>

        {/* Content */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Content <span class="text-red-500">*</span>
          </label>
          <textarea
            value={content()}
            onInput={(e) => setContent(e.currentTarget.value)}
            placeholder="What should the agent remember?"
            rows={5}
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            required
          />
        </div>

        {/* Importance (clickable stars) */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Importance
          </label>
          <div class="flex items-center gap-1">
            <For each={[1, 2, 3, 4, 5]}>
              {(n) => (
                <button
                  type="button"
                  onClick={() => setImportance(n)}
                  aria-label={`Set importance to ${n}`}
                  class={`p-0.5 rounded transition-transform hover:scale-110 ${
                    n <= importance()
                      ? 'text-yellow-400'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}
                >
                  <Star
                    class="w-6 h-6"
                    fill={n <= importance() ? 'currentColor' : 'none'}
                  />
                </button>
              )}
            </For>
            <span class="ml-2 text-xs text-gray-400">{importance()}/5</span>
          </div>
        </div>

        {/* Tags */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Tags
          </label>
          <div class="flex flex-wrap gap-1.5 mb-2">
            <For each={tags()}>
              {(tag) => (
                <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X class="w-3 h-3" />
                  </button>
                </span>
              )}
            </For>
          </div>
          <div class="flex gap-2">
            <input
              type="text"
              value={tagInput()}
              onInput={(e) => setTagInput(e.currentTarget.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Add tag and press Enter"
              class="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
            <button
              type="button"
              onClick={addTag}
              class="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Plus class="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div class="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={props.onClose}
            disabled={isSubmitting()}
            class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid() || isSubmitting()}
            class="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Show when={isSubmitting()}>
              <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                />
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
            </Show>
            {isSubmitting()
              ? 'Saving…'
              : props.mode === 'edit'
                ? 'Save Changes'
                : 'Create Memory'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
