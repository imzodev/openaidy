import { For, Show, createMemo } from 'solid-js';
import { MessageSquare, Star } from 'lucide-solid';
import type { Session } from '../lib/api';

type SessionListProps = {
  sessions: Session[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onToggleFavorite?: (id: string, favorited: boolean) => void | Promise<void>;
  isLoading?: boolean;
  isCollapsed: boolean;
  /** Highlight the selected session (only meaningful while the chat view is open). */
  isActiveView: boolean;
  /** How many recent (non-favorite) sessions to show. */
  recentLimit?: number;
};

// Most recent activity first. Falls back to createdAt for legacy sessions that
// don't have an updatedAt (e.g. in-memory backend records).
function lastActivityMs(session: Session): number {
  const ts = session.updatedAt ?? session.createdAt;
  return ts ? new Date(ts).getTime() : 0;
}

const isFavorite = (session: Session): boolean => !!session.favoritedAt;

/**
 * Sidebar quick-access list: user-curated Favorites on top, then the most
 * recently-active sessions (excluding favorites, so nothing appears twice).
 * Two questions, two sections — recency is automatic, favorites are deliberate.
 * Hidden when the sidebar is collapsed (it's a text list, not an icon rail).
 */
export function SessionList(props: SessionListProps) {
  const favorites = createMemo(() =>
    [...props.sessions]
      .filter(isFavorite)
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
  );

  const recent = createMemo(() =>
    [...props.sessions]
      .filter((s) => !isFavorite(s))
      .sort((a, b) => lastActivityMs(b) - lastActivityMs(a))
      .slice(0, props.recentLimit ?? 5),
  );

  const renderItem = (session: Session) => (
    <li>
      <div
        onClick={() => props.onSelect(session.id)}
        class={`w-full text-left h-8 px-2.5 rounded-md transition-colors group flex items-center gap-2.5 cursor-pointer text-[13px] ${
          props.isActiveView && props.selectedId === session.id
            ? 'bg-blue-600 text-white [&_svg]:text-white/90'
            : 'hover:bg-fill text-text-secondary hover:text-text-primary'
        }`}
        title={session.title}
      >
        <MessageSquare
          class="w-4 h-4 flex-shrink-0 text-text-muted"
          stroke-width={1.75}
        />
        <span class="truncate flex-1">{session.title}</span>
        <Show when={props.onToggleFavorite}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void props.onToggleFavorite?.(session.id, !isFavorite(session));
            }}
            class={`p-0.5 transition-opacity ${
              isFavorite(session)
                ? 'text-amber-400'
                : 'opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-amber-400'
            }`}
            aria-label={
              isFavorite(session) ? 'Remove from favorites' : 'Add to favorites'
            }
          >
            <Star
              class={`w-3.5 h-3.5 ${isFavorite(session) ? 'fill-amber-400' : ''}`}
            />
          </button>
        </Show>
      </div>
    </li>
  );

  // The quick-access list is a text list; collapsed rail shows nav icons only.
  return (
    <Show when={!props.isCollapsed}>
      <div class="flex flex-col">
        <Show when={props.isLoading}>
          <div class="px-4 py-2 text-xs text-text-tertiary">
            Loading sessions...
          </div>
        </Show>

        <Show when={!props.isLoading && favorites().length > 0}>
          <h3 class="px-4 pt-3 pb-1 text-[11px] font-semibold text-text-muted flex items-center gap-1">
            <Star class="w-3 h-3 fill-amber-400 text-amber-400" />
            Favorites
          </h3>
          <ul class="space-y-px px-2 mb-1">
            <For each={favorites()}>{renderItem}</For>
          </ul>
        </Show>

        <Show when={!props.isLoading && recent().length > 0}>
          <h3 class="px-4 pt-3 pb-1 text-[11px] font-semibold text-text-muted">
            Recent
          </h3>
          <ul class="space-y-px px-2">
            <For each={recent()}>{renderItem}</For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
