import type { Accessor } from 'solid-js';
import type { SessionMessage } from './api';

/**
 * Public state exposed by `useInfiniteMessages`.
 *
 * Split from the hook implementation so that consumers and tests can import
 * the type without dragging the implementation file along.
 */
export type InfiniteMessagesState = {
  messages: Accessor<SessionMessage[]>;
  total: Accessor<number>;
  /** True for the initial page load. False during `loadMore` and after. */
  isLoading: Accessor<boolean>;
  /** True only during a `loadMore` call. */
  isLoadingMore: Accessor<boolean>;
  /** User-visible error from the most recent fetch (initial or loadMore). */
  error: Accessor<string | undefined>;
  /** True when the server reports more pages exist. */
  hasMore: Accessor<boolean>;
  /** Fetch the next older page. No-op when already loading or no more pages. */
  loadMore: () => Promise<void>;
  /** Re-fetch the latest page and merge in any new tail messages. */
  refresh: () => Promise<void>;
};

/**
 * Options for `useInfiniteMessages`.
 */
export type UseInfiniteMessagesOptions = {
  /** Number of messages per "load more" page. */
  pageSize?: number;
  /** Number of messages in the initial page. */
  initialPageSize?: number;
};
