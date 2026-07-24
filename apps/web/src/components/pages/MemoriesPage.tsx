/**
 * MemoriesPage
 *
 * Agent master-detail view of persisted agent memories. The left rail lists
 * agents (with memory counts) plus an "All agents" entry; the main pane shows
 * that agent's memories as cards, ordered by importance. Supports full-text
 * search and full management (create / edit / delete) via MemoryModal.
 */

import { createSignal, createEffect, onMount, For, Show } from 'solid-js';
import { Brain, Plus, Search, X, Pencil, Trash2, Star } from 'lucide-solid';
import { Layout } from './Layout';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { MemoryModal } from './MemoryModal';
import {
  listMemories,
  listMemoryAgents,
  deleteMemory,
  type Memory,
  type MemoryAgentSummary,
} from '../../lib/api';

/** Read-only 1–5 star display for a memory's importance. */
function ImportanceStars(props: { value: number }) {
  return (
    <span
      class="inline-flex items-center gap-0.5"
      title={`Importance ${props.value}/5`}
    >
      <For each={[1, 2, 3, 4, 5]}>
        {(n) => (
          <Star
            class={`w-3.5 h-3.5 ${
              n <= props.value
                ? 'text-yellow-400'
                : 'text-gray-300 dark:text-gray-600'
            }`}
            fill={n <= props.value ? 'currentColor' : 'none'}
          />
        )}
      </For>
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function MemoriesPage() {
  const [agents, setAgents] = createSignal<MemoryAgentSummary[]>([]);
  const [total, setTotal] = createSignal(0);
  // null = "All agents"
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(
    null,
  );
  const [memories, setMemories] = createSignal<Memory[]>([]);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(true);
  const [isLoadingList, setIsLoadingList] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = createSignal(false);
  const [modalMode, setModalMode] = createSignal<'create' | 'edit'>('create');
  const [editing, setEditing] = createSignal<Memory | undefined>(undefined);

  // Delete-confirmation state
  const [deleteTarget, setDeleteTarget] = createSignal<Memory | null>(null);
  const [isDeleting, setIsDeleting] = createSignal(false);

  const agentName = (id: string) =>
    agents().find((a) => a.id === id)?.name ?? id;

  const loadAgents = async () => {
    const res = await listMemoryAgents();
    setAgents(res.items);
    setTotal(res.total);
  };

  const loadMemories = async () => {
    setIsLoadingList(true);
    setError(null);
    try {
      const agentId = selectedAgentId() ?? undefined;
      const q = searchQuery().trim();
      const res = await listMemories({
        ...(agentId ? { agentId } : {}),
        ...(q ? { q } : {}),
      });
      setMemories(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setIsLoadingList(false);
    }
  };

  const reload = () => Promise.all([loadAgents(), loadMemories()]);

  onMount(async () => {
    try {
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  });

  // Reload the list whenever the selected agent or search term changes.
  // A short debounce keeps full-text search from firing on every keystroke.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    // Track dependencies.
    selectedAgentId();
    searchQuery();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void loadMemories();
    }, 250);
  });

  const openCreate = () => {
    setModalMode('create');
    setEditing(undefined);
    setModalOpen(true);
  };

  const openEdit = (memory: Memory) => {
    setModalMode('edit');
    setEditing(memory);
    setModalOpen(true);
  };

  const handleSaved = () => {
    setModalOpen(false);
    void reload();
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget();
    if (!target) return;
    setIsDeleting(true);
    try {
      await deleteMemory(target.id);
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete memory');
    } finally {
      setIsDeleting(false);
    }
  };

  const isSearching = () => searchQuery().trim().length > 0;

  return (
    <Layout
      title="Memories"
      description="Browse and manage what your agents remember"
      actions={
        <button
          type="button"
          onClick={openCreate}
          disabled={agents().length === 0}
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus class="w-4 h-4" />
          New Memory
        </button>
      }
    >
      {/* Error */}
      <Show when={error()}>
        <div class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg">
          {error()}
        </div>
      </Show>

      {/* Loading (initial) */}
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-64">
          <p class="text-text-tertiary">Loading memories…</p>
        </div>
      </Show>

      <Show when={!isLoading()}>
        <div class="flex flex-col lg:flex-row gap-4">
          {/* Left rail: agents */}
          <aside class="lg:w-64 flex-shrink-0 space-y-1">
            <button
              type="button"
              onClick={() => setSelectedAgentId(null)}
              class={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedAgentId() === null
                  ? 'bg-primary/10 text-text-primary font-medium'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary'
              }`}
            >
              <span class="flex items-center gap-2">
                <Brain class="w-4 h-4" />
                All agents
              </span>
              <span class="text-xs text-text-tertiary">{total()}</span>
            </button>

            <For each={agents()}>
              {(agent) => (
                <button
                  type="button"
                  onClick={() => setSelectedAgentId(agent.id)}
                  class={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedAgentId() === agent.id
                      ? 'bg-primary/10 text-text-primary font-medium'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary'
                  }`}
                  title={agent.name}
                >
                  <span class="truncate">{agent.name}</span>
                  <span class="text-xs text-text-tertiary ml-2">
                    {agent.count}
                  </span>
                </button>
              )}
            </For>
          </aside>

          {/* Main pane: search + memory cards */}
          <div class="flex-1 min-w-0">
            {/* Search */}
            <div class="relative mb-4">
              <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                placeholder="Search memories…"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full pl-8 pr-8 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-primary placeholder:text-text-tertiary"
              />
              <Show when={searchQuery()}>
                <button
                  onClick={() => setSearchQuery('')}
                  class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary transition-colors"
                  aria-label="Clear search"
                >
                  <X class="w-3.5 h-3.5" />
                </button>
              </Show>
            </div>

            {/* List loading */}
            <Show when={isLoadingList()}>
              <div class="flex items-center justify-center h-40">
                <p class="text-text-tertiary text-sm">Loading…</p>
              </div>
            </Show>

            {/* Empty */}
            <Show when={!isLoadingList() && memories().length === 0}>
              <div class="flex items-center justify-center h-40">
                <div class="text-center">
                  <Brain class="w-10 h-10 mx-auto mb-3 text-text-tertiary" />
                  <p class="text-text-tertiary text-sm">
                    {isSearching()
                      ? 'No memories match your search'
                      : 'No memories yet'}
                  </p>
                  <Show when={!isSearching() && agents().length > 0}>
                    <button
                      type="button"
                      onClick={openCreate}
                      class="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      <Plus class="w-4 h-4" /> Add a memory
                    </button>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Cards */}
            <Show when={!isLoadingList() && memories().length > 0}>
              <div class="space-y-2">
                <For each={memories()}>
                  {(memory) => (
                    <div class="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:shadow-sm transition-shadow">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2 flex-wrap">
                            <ImportanceStars value={memory.importance} />
                            <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {memory.title}
                            </h3>
                          </div>
                          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words">
                            {memory.content}
                          </p>
                          <div class="mt-2 flex items-center gap-2 flex-wrap text-xs text-text-tertiary">
                            <Show when={selectedAgentId() === null}>
                              <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                {agentName(memory.agentId)}
                              </span>
                            </Show>
                            <For each={memory.tags}>
                              {(tag) => (
                                <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                  #{tag}
                                </span>
                              )}
                            </For>
                            <span>{formatDate(memory.updatedAt)}</span>
                          </div>
                        </div>

                        {/* Row actions */}
                        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => openEdit(memory)}
                            class="p-1.5 rounded text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-text-primary transition-colors"
                            title="Edit memory"
                            aria-label="Edit memory"
                          >
                            <Pencil class="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(memory)}
                            class="p-1.5 rounded text-text-tertiary hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Delete memory"
                            aria-label="Delete memory"
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Create / edit modal */}
      <MemoryModal
        isOpen={modalOpen()}
        mode={modalMode()}
        agents={agents()}
        defaultAgentId={selectedAgentId() ?? undefined}
        memory={editing()}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteTarget() !== null}
        title="Delete memory"
        body={`Delete "${deleteTarget()?.title ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        isPending={isDeleting()}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Layout>
  );
}
