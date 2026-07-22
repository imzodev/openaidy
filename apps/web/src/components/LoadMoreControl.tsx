import { Show } from 'solid-js';
import { ArrowUp, Loader } from 'lucide-solid';

export type LoadMoreControlProps = {
  hasMore: boolean;
  isLoadingMore: boolean;
  total: number | undefined;
  loaded: number;
  onLoadMore: () => void;
};

/**
 * Pinned at the top of the message list. Three states:
 *   - hasMore + idle:  "Load more messages" button (clicking triggers fetch;
 *     also auto-triggered by scrolling to the top in ChatView)
 *   - isLoadingMore:   skeleton/spinner row
 *   - no more pages:   small "End of history" banner with `total` count
 */
export function LoadMoreControl(props: LoadMoreControlProps) {
  return (
    <Show
      when={props.hasMore || props.isLoadingMore}
      fallback={
        <Show when={(props.total ?? 0) > 0}>
          <div
            class="text-center text-xs text-text-tertiary py-2"
            data-testid="end-of-history"
          >
            Start of conversation · {props.total} message
            {props.total === 1 ? '' : 's'}
          </div>
        </Show>
      }
    >
      <div class="flex flex-col items-center gap-2 py-2">
        <Show
          when={!props.isLoadingMore}
          fallback={
            <div
              class="inline-flex items-center gap-2 text-xs text-text-tertiary"
              data-testid="loading-more"
            >
              <Loader class="w-3.5 h-3.5 animate-spin" />
              Loading older messages…
            </div>
          }
        >
          <button
            type="button"
            onClick={() => props.onLoadMore()}
            class="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary border border-gray-200 dark:border-gray-700 rounded-full px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            data-testid="load-more"
          >
            <ArrowUp class="w-3.5 h-3.5" />
            Load older messages
          </button>
          <Show when={props.total !== undefined}>
            <span class="text-[10px] text-text-tertiary">
              Showing {props.loaded} of {props.total}
            </span>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
