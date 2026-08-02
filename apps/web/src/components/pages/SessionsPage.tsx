import {
  createSignal,
  Show,
  For,
  createEffect,
  onCleanup,
  createMemo,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import {
  MessageSquare,
  Plus,
  Trash2,
  Clock,
  Search,
  X,
  FileText,
  AlignLeft,
  Filter,
  Zap,
  Star,
  Pencil,
  Check,
  Archive,
  ArchiveRestore,
} from 'lucide-solid';
import { searchSessions, listArchivedSessions } from '../../lib/api';
import type { Session } from '../../lib/api';
import type { SessionSearchResult, UsageTotals } from '../../lib/types';
import {
  formatTokensCompact,
  formatCost,
  formatNumber,
} from '../../lib/usage-format';

type SessionsPageProps = {
  sessions: Session[];
  selectedSessionId: string | undefined;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession?: (id: string) => void;
  onRenameSession?: (id: string, title: string) => void | Promise<void>;
  onToggleFavorite?: (id: string, favorited: boolean) => void | Promise<void>;
  onArchiveSession?: (id: string) => void | Promise<void>;
  onUnarchiveSession?: (id: string) => void | Promise<void>;
  isLoading?: boolean;
  /** Per-session usage totals keyed by session id (absent = no usage yet). */
  usageBySession?: Record<string, UsageTotals>;
};

// Sessions created on behalf of an addon aren't given a distinct `type` —
// they're plain 'chat' sessions tagged only by this title convention (see
// AddonProxyAgentService.invoke's `sessionTitle`).
const ADDON_SESSION_TITLE_PREFIX = 'addon:';

type SessionCategory = 'chat' | 'task' | 'subtask' | 'addon';
type SessionView = 'active' | 'archived';

const CATEGORY_LABELS: Record<SessionCategory, string> = {
  chat: 'Chat',
  task: 'Tasks',
  subtask: 'Subtasks',
  addon: 'Addons',
};

function categorizeSession(session: Session): SessionCategory {
  if (session.type === 'task') return 'task';
  if (session.type === 'subtask') return 'subtask';
  if (session.title?.startsWith(ADDON_SESSION_TITLE_PREFIX)) return 'addon';
  return 'chat';
}

// Most recent activity first. Falls back to createdAt for legacy sessions that
// don't have an updatedAt (e.g. in-memory backend records).
function lastActivityMs(session: Session): number {
  const ts = session.updatedAt ?? session.createdAt;
  return ts ? new Date(ts).getTime() : 0;
}

const isFavorite = (session: Session): boolean => !!session.favoritedAt;

export function SessionsPage(props: SessionsPageProps) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResults, setSearchResults] = createSignal<
    SessionSearchResult[] | null
  >(null);
  const [isSearching, setIsSearching] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);
  // Initial view is chat-only; task/subtask/addon sessions are opt-in.
  const [activeCategories, setActiveCategories] = createSignal<
    SessionCategory[]
  >(['chat']);
  const [view, setView] = createSignal<SessionView>('active');
  // Inline rename state — id of the session being renamed and its draft title.
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal('');

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Archived sessions are fetched on demand — only when the Archived tab is
  // active — so the common (active) view stays a single request. Shares the
  // ['sessions', 'archived'] key that App's mutations invalidate.
  const archivedQuery = createQuery(() => ({
    queryKey: ['sessions', 'archived'],
    queryFn: listArchivedSessions,
    enabled: view() === 'archived',
  }));

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const result = await searchSessions(query.trim(), {
        limit: 20,
        currentSessionId: props.selectedSessionId,
      });
      setSearchResults(result.items);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Debounced search on query change
  createEffect(() => {
    const query = searchQuery();
    if (debounceTimer) clearTimeout(debounceTimer);

    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceTimer = setTimeout(() => {
      performSearch(query);
    }, 300);
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults(null);
    setSearchError(null);
  };

  const handleSelectSearchResult = (session: SessionSearchResult) => {
    props.onSelectSession(session.id);
    // Optionally clear search after selection
    clearSearch();
  };

  const isSearching_ = () => isSearching();
  const hasSearchResults = () => searchResults() !== null;
  const searchResults_ = () => searchResults() ?? [];

  // The list to render depends on the active/archived toggle. Active sessions
  // come from props (App's ['sessions'] query); archived ones are fetched here.
  const viewSessions = (): Session[] =>
    view() === 'archived' ? (archivedQuery.data?.items ?? []) : props.sessions;

  // Active view: favorites first, then most-recent activity. Archived view:
  // most-recently-archived (falls back to activity) first, no favorite bump.
  const sortedSessions = createMemo(() => {
    const list = [...viewSessions()];
    if (view() === 'archived') {
      return list.sort((a, b) => {
        const at = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
        const bt = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
        return (bt || lastActivityMs(b)) - (at || lastActivityMs(a));
      });
    }
    return list.sort((a, b) => {
      const favDiff = Number(isFavorite(b)) - Number(isFavorite(a));
      if (favDiff !== 0) return favDiff;
      return lastActivityMs(b) - lastActivityMs(a);
    });
  });

  const sessions_ = () =>
    sortedSessions().filter((s) =>
      activeCategories().includes(categorizeSession(s)),
    );

  const isViewLoading = () =>
    view() === 'archived' ? archivedQuery.isLoading : !!props.isLoading;

  // Usage badge data for a card — only when the session has recorded tokens,
  // so brand-new / empty sessions don't show a "0 tokens" badge.
  const usageFor = (session: Session): UsageTotals | undefined => {
    const usage = props.usageBySession?.[session.id];
    return usage && usage.totalTokens > 0 ? usage : undefined;
  };

  const toggleCategory = (category: SessionCategory) => {
    setActiveCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  };

  const startRename = (session: Session) => {
    setEditingId(session.id);
    setEditValue(session.title);
  };

  const commitRename = (session: Session) => {
    const next = editValue().trim();
    if (next && next !== session.title) {
      void props.onRenameSession?.(session.id, next);
    }
    setEditingId(null);
  };

  return (
    <div class="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 dark:bg-gray-900">
      <div class="w-full py-6 px-4 sm:px-6">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-2xl font-bold text-text-primary">Sessions</h1>
          <button
            onClick={props.onCreateSession}
            class="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Plus class="w-4 h-4" />
            New Session
          </button>
        </div>

        {/* Search bar */}
        <div class="mb-4">
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search sessions by title or message content..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full pl-8 pr-8 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-primary placeholder:text-text-tertiary"
            />
            <Show when={searchQuery()}>
              <button
                onClick={clearSearch}
                class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary transition-colors"
                title="Clear search"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </Show>
          </div>
          <Show when={isSearching_()}>
            <div class="mt-2 text-xs text-text-tertiary">Searching...</div>
          </Show>
          <Show when={searchError()}>
            <div class="mt-2 text-xs text-red-500">{searchError()}</div>
          </Show>
        </div>

        {/* Search results */}
        <Show when={hasSearchResults()}>
          <div class="mb-4">
            <p class="text-sm text-text-secondary mb-2">
              {searchResults_().length > 0
                ? `${searchResults_().length} result${searchResults_().length === 1 ? '' : 's'} for "${searchQuery()}"`
                : `No results for "${searchQuery()}"`}
            </p>
            <div class="grid gap-3">
              <For each={searchResults_()}>
                {(result) => (
                  <div
                    class="min-w-0 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-primary/50 transition-all cursor-pointer"
                    onClick={() => handleSelectSearchResult(result)}
                  >
                    <div class="flex items-start gap-3">
                      <div class="mt-0.5">
                        <Show
                          when={result.matchType === 'title'}
                          fallback={
                            <FileText class="w-4 h-4 text-blue-500 dark:text-blue-400" />
                          }
                        >
                          <AlignLeft class="w-4 h-4 text-green-500 dark:text-green-400" />
                        </Show>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <h3 class="font-medium text-text-primary truncate text-sm">
                            {result.title}
                          </h3>
                          <span
                            class={`shrink-0 text-xs px-1.5 py-0.5 rounded ${
                              result.matchType === 'title'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}
                          >
                            {result.matchType === 'title' ? 'title' : 'content'}
                          </span>
                        </div>
                        <div class="flex items-center gap-2 text-xs text-text-tertiary mb-1">
                          <Clock class="w-3 h-3" />
                          <span>{formatDate(result.createdAt)}</span>
                        </div>
                        <Show when={result.snippet}>
                          <p class="text-xs text-text-secondary line-clamp-2 italic">
                            "...{result.snippet}..."
                          </p>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Default session list (shown when not searching) */}
        <Show when={!hasSearchResults()}>
          {/* Active / Archived toggle */}
          <div class="inline-flex items-center gap-1 mb-4 p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <For each={['active', 'archived'] as SessionView[]}>
              {(v) => (
                <button
                  onClick={() => setView(v)}
                  class={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                    view() === v
                      ? 'bg-white dark:bg-gray-700 text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {v}
                </button>
              )}
            </For>
          </div>

          {/* Category filter */}
          <div class="flex items-center gap-2 flex-wrap mb-4">
            <Filter class="w-4 h-4 text-text-tertiary" />
            <For each={Object.keys(CATEGORY_LABELS) as SessionCategory[]}>
              {(category) => (
                <button
                  onClick={() => toggleCategory(category)}
                  class={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    activeCategories().includes(category)
                      ? 'bg-primary/10 text-primary border border-primary/50'
                      : 'bg-gray-100 text-gray-500 border border-transparent dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {CATEGORY_LABELS[category]}
                </button>
              )}
            </For>
          </div>

          <Show when={isViewLoading()}>
            <div class="text-center py-12">
              <div class="animate-pulse text-text-tertiary">
                Loading sessions...
              </div>
            </div>
          </Show>

          <Show
            when={
              !isViewLoading() &&
              sessions_().length === 0 &&
              viewSessions().length === 0
            }
          >
            <div class="text-center py-12">
              <Show
                when={view() === 'archived'}
                fallback={
                  <>
                    <MessageSquare class="w-12 h-12 mx-auto mb-4 text-text-muted" />
                    <h3 class="text-lg font-medium text-text-primary mb-2">
                      No sessions yet
                    </h3>
                    <p class="text-text-secondary mb-4">
                      Create a new session to start chatting with agents
                    </p>
                    <button
                      onClick={props.onCreateSession}
                      class="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors"
                    >
                      Create Session
                    </button>
                  </>
                }
              >
                <Archive class="w-12 h-12 mx-auto mb-4 text-text-muted" />
                <h3 class="text-lg font-medium text-text-primary mb-2">
                  No archived sessions
                </h3>
                <p class="text-text-secondary">
                  Sessions you archive will appear here.
                </p>
              </Show>
            </div>
          </Show>

          <Show
            when={
              !isViewLoading() &&
              sessions_().length === 0 &&
              viewSessions().length > 0
            }
          >
            <div class="text-center py-12">
              <Filter class="w-12 h-12 mx-auto mb-4 text-text-muted" />
              <h3 class="text-lg font-medium text-text-primary mb-2">
                No sessions match the current filter
              </h3>
              <p class="text-text-secondary mb-4">
                Enable another category above to see more sessions.
              </p>
            </div>
          </Show>

          <Show when={!isViewLoading() && sessions_().length > 0}>
            <div class="grid gap-4">
              <For each={sessions_()}>
                {(session) => (
                  <div
                    class={`min-w-0 p-4 rounded-lg border transition-all cursor-pointer ${
                      props.selectedSessionId === session.id
                        ? 'border-primary bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                    onClick={() => {
                      if (editingId() === session.id) return;
                      props.onSelectSession(session.id);
                    }}
                  >
                    <div class="flex items-start justify-between gap-4">
                      <div class="flex-1 min-w-0">
                        <Show
                          when={editingId() === session.id}
                          fallback={
                            <h3 class="flex items-center gap-1.5 font-medium text-text-primary truncate">
                              <Show when={isFavorite(session)}>
                                <Star class="w-3.5 h-3.5 shrink-0 fill-amber-400 text-amber-400" />
                              </Show>
                              <span class="truncate">{session.title}</span>
                            </h3>
                          }
                        >
                          <input
                            type="text"
                            value={editValue()}
                            onClick={(e) => e.stopPropagation()}
                            onInput={(e) => setEditValue(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(session);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            onBlur={() => commitRename(session)}
                            ref={(el) => setTimeout(() => el.focus(), 0)}
                            class="w-full px-2 py-1 text-sm font-medium bg-white dark:bg-gray-900 border border-primary/60 rounded focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-primary"
                          />
                        </Show>
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-text-tertiary">
                          <span class="inline-flex items-center gap-1.5">
                            <Clock class="w-3.5 h-3.5" />
                            {formatDate(session.updatedAt ?? session.createdAt)}
                          </span>
                          <Show when={usageFor(session)}>
                            {(usage) => (
                              <span
                                class="inline-flex items-center gap-1.5"
                                title={`${formatNumber(usage().totalTokens)} tokens across ${usage().runCount} run(s)`}
                              >
                                <Zap class="w-3.5 h-3.5" />
                                {formatTokensCompact(usage().totalTokens)}{' '}
                                tokens
                                <Show when={usage().hasCost}>
                                  <span aria-hidden="true">·</span>
                                  {formatCost(usage().cost, usage().hasCost)}
                                </Show>
                              </span>
                            )}
                          </Show>
                        </div>
                      </div>
                      <div class="flex items-center gap-1">
                        <Show when={view() === 'active'}>
                          <Show when={props.onToggleFavorite}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void props.onToggleFavorite?.(
                                  session.id,
                                  !isFavorite(session),
                                );
                              }}
                              class={`p-1.5 rounded-lg transition-colors ${
                                isFavorite(session)
                                  ? 'text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                  : 'text-text-tertiary hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                              }`}
                              title={
                                isFavorite(session)
                                  ? 'Remove from favorites'
                                  : 'Add to favorites'
                              }
                            >
                              <Star
                                class={`w-4 h-4 ${isFavorite(session) ? 'fill-amber-400' : ''}`}
                              />
                            </button>
                          </Show>
                          <Show when={props.onRenameSession}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (editingId() === session.id) {
                                  commitRename(session);
                                } else {
                                  startRename(session);
                                }
                              }}
                              class="p-1.5 text-text-tertiary hover:text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                              title="Rename session"
                            >
                              <Show
                                when={editingId() === session.id}
                                fallback={<Pencil class="w-4 h-4" />}
                              >
                                <Check class="w-4 h-4" />
                              </Show>
                            </button>
                          </Show>
                          <Show when={props.onArchiveSession}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void props.onArchiveSession?.(session.id);
                              }}
                              class="p-1.5 text-text-tertiary hover:text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                              title="Archive session"
                            >
                              <Archive class="w-4 h-4" />
                            </button>
                          </Show>
                        </Show>
                        <Show
                          when={
                            view() === 'archived' && props.onUnarchiveSession
                          }
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void props.onUnarchiveSession?.(session.id);
                            }}
                            class="p-1.5 text-text-tertiary hover:text-primary hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                            title="Unarchive session"
                          >
                            <ArchiveRestore class="w-4 h-4" />
                          </button>
                        </Show>
                        <Show when={props.onDeleteSession}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onDeleteSession?.(session.id);
                            }}
                            class="p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="Delete session"
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
