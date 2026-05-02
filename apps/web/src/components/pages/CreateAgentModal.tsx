/**
 * CreateAgentModal
 *
 * Modal form for creating a new agent. Collects the minimal required
 * fields (id, name, model, system prompt) plus optional description and tags.
 */

import { createSignal, For, Show } from 'solid-js';
import { X, Plus } from 'lucide-solid';
import { Modal } from '../ui/Modal';
import {
  createAgent,
  type CreateAgentInput,
  type ProviderConfig,
} from '../../lib/api';

type Props = {
  isOpen: boolean;
  providers: ProviderConfig[];
  onClose: () => void;
  onCreated: (agent: CreateAgentInput) => void;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function CreateAgentModal(props: Props) {
  const [name, setName] = createSignal('');
  const [id, setId] = createSignal('');
  const [idTouched, setIdTouched] = createSignal(false);
  const [description, setDescription] = createSignal('');
  const [model, setModel] = createSignal('');
  const [systemPrompt, setSystemPrompt] = createSignal('');
  const [tagInput, setTagInput] = createSignal('');
  const [tags, setTags] = createSignal<string[]>([]);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const derivedId = () => (idTouched() ? id() : slugify(name()));

  const allModels = (): { label: string; value: string }[] => {
    const out: { label: string; value: string }[] = [];
    for (const p of props.providers) {
      for (const m of p.models ?? []) {
        if (m.enabled !== false) {
          out.push({
            label: `${m.name} (${p.name})`,
            value: `${p.id}/${m.id}`,
          });
        }
      }
    }
    return out;
  };

  const isValid = () =>
    name().trim().length > 0 &&
    derivedId().length > 0 &&
    model().length > 0 &&
    systemPrompt().trim().length > 0;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!idTouched()) {
      setId(slugify(value));
    }
  };

  const handleIdChange = (value: string) => {
    setIdTouched(true);
    setId(value);
  };

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

  const reset = () => {
    setName('');
    setId('');
    setIdTouched(false);
    setDescription('');
    setModel('');
    setSystemPrompt('');
    setTagInput('');
    setTags([]);
    setError(null);
  };

  const handleClose = () => {
    reset();
    props.onClose();
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!isValid()) return;

    setIsSubmitting(true);
    setError(null);

    const input: CreateAgentInput = {
      id: derivedId(),
      name: name().trim(),
      enabled: true,
      systemPrompt: systemPrompt().trim(),
      model: model(),
      description: description().trim() || undefined,
      tags: tags().length > 0 ? tags() : undefined,
    };

    try {
      await createAgent(input);
      props.onCreated(input);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleClose}
      title="New Agent"
      size="lg"
    >
      <form onSubmit={handleSubmit} class="space-y-5">
        {/* Error banner */}
        <Show when={error()}>
          <div class="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg">
            {error()}
          </div>
        </Show>

        {/* Name + ID row */}
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name()}
              onInput={(e) => handleNameChange(e.currentTarget.value)}
              placeholder="My Assistant"
              class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              required
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ID <span class="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={derivedId()}
              onInput={(e) => handleIdChange(e.currentTarget.value)}
              placeholder="my-assistant"
              class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              required
            />
            <p class="mt-1 text-xs text-gray-400">
              Auto-generated from name. Must be unique.
            </p>
          </div>
        </div>

        {/* Description */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Description
          </label>
          <input
            type="text"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="A short description of what this agent does"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>

        {/* Model */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Model <span class="text-red-500">*</span>
          </label>
          <Show
            when={allModels().length > 0}
            fallback={
              <input
                type="text"
                value={model()}
                onInput={(e) => setModel(e.currentTarget.value)}
                placeholder="openai/gpt-4o-mini"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                required
              />
            }
          >
            <select
              value={model()}
              onChange={(e) => setModel(e.currentTarget.value)}
              class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              required
            >
              <option value="" disabled>
                Select a model…
              </option>
              <For each={allModels()}>
                {(m) => <option value={m.value}>{m.label}</option>}
              </For>
            </select>
          </Show>
        </div>

        {/* System Prompt */}
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            System Prompt <span class="text-red-500">*</span>
          </label>
          <textarea
            value={systemPrompt()}
            onInput={(e) => setSystemPrompt(e.currentTarget.value)}
            placeholder="You are a helpful assistant…"
            rows={5}
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            required
          />
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
            onClick={handleClose}
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
            <Show when={isSubmitting()} fallback={<Plus class="w-4 h-4" />}>
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
            {isSubmitting() ? 'Creating…' : 'Create Agent'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
