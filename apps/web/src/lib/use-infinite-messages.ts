/**
 * useInfiniteMessages
 *
 * Paged message loader for the chat view. Owns the messages array for one
 * session and exposes a `loadMore()` action for "load older history".
 *
 * Responsibilities:
 *  - Reset and re-fetch when the session id changes
 *  - Fetch the initial 50-message page
 *  - Expose `loadMore()` to fetch the previous page (20 messages)
 *  - De-duplicate messages by id so a concurrent WS event arriving during
 *    a "load older" fetch doesn't double-render
 *  - Track loading / error / "has more" state for the UI
 *  - Expose `total` so the UI can render an end-of-history affordance
 *
 * Scroll preservation is handled by the consumer (ChatView) — it watches
 * the leading message id; when it changes (prepend happened) the consumer
 * snapshots scrollHeight before and adjusts scrollTop after the next frame.
 *
 * Public types live in `./use-infinite-messages.types.ts` so consumers can
 * import the contract without pulling in the implementation.
 */

import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';
import { listMessages } from './ws-api';
import type { SessionMessage, ApiError } from './api';
import type {
  InfiniteMessagesState,
  UseInfiniteMessagesOptions,
} from './use-infinite-messages.types';

export type {
  InfiniteMessagesState,
  UseInfiniteMessagesOptions,
} from './use-infinite-messages.types';

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_INITIAL_PAGE_SIZE = 50;

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (isApiError(value)) return value.error;
  if (typeof value === 'string') return value;
  return 'Failed to load messages.';
}

function mergePrepend(
  existing: SessionMessage[],
  incoming: SessionMessage[],
): SessionMessage[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((m) => m.id));
  const fresh = incoming.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return existing;
  return [...fresh, ...existing];
}

function mergeAppend(
  existing: SessionMessage[],
  message: SessionMessage,
): SessionMessage[] {
  if (existing.some((m) => m.id === message.id)) return existing;
  return [...existing, message];
}

export function useInfiniteMessages(
  sessionId: Accessor<string | undefined>,
  options: UseInfiniteMessagesOptions = {},
): InfiniteMessagesState {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const initialPageSize = options.initialPageSize ?? DEFAULT_INITIAL_PAGE_SIZE;

  const [messages, setMessages] = createSignal<SessionMessage[]>([]);
  const [total, setTotal] = createSignal(0);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>(undefined);
  const [nextOffset, setNextOffset] = createSignal<number | null>(null);
  const [hasMore, setHasMore] = createSignal(false);

  // Tracks which session id the in-flight request (if any) belongs to, so we
  // can discard stale responses when the user switches sessions.
  let inflightFor: string | undefined;
  // Tracks the session id the current `messages` was loaded for. Backed by
  // a signal so the createEffect below can read it reactively without
  // re-entering the fetcher.
  const [loadedFor, setLoadedFor] = createSignal<string | undefined>(undefined);

  async function fetchPage(
    sid: string,
    mode: 'initial' | 'more',
    offset: number,
  ): Promise<void> {
    inflightFor = sid;
    if (mode === 'initial') {
      setIsLoading(true);
      setError(undefined);
    } else {
      setIsLoadingMore(true);
    }
    try {
      const page = await listMessages(sid, {
        limit: mode === 'initial' ? initialPageSize : pageSize,
        offset,
      });
      if (inflightFor !== sid) return; // stale — user switched sessions
      const items = 'items' in page ? page.items : [];
      const pageTotal = 'total' in page ? page.total : items.length;
      const pageNextOffset = 'nextOffset' in page ? page.nextOffset : null;
      if (mode === 'initial') {
        setMessages(items);
      } else {
        setMessages((current) => mergePrepend(current, items));
      }
      setTotal(pageTotal);
      setNextOffset(pageNextOffset);
      setHasMore(pageNextOffset !== null);
      setLoadedFor(sid);
    } catch (err) {
      if (inflightFor !== sid) return;
      setError(errorMessage(err));
    } finally {
      if (inflightFor === sid) {
        if (mode === 'initial') setIsLoading(false);
        else setIsLoadingMore(false);
      }
    }
  }

  function resetForSession(sid: string | undefined): void {
    inflightFor = sid;
    setLoadedFor(sid);
    setMessages([]);
    setTotal(0);
    setNextOffset(null);
    setHasMore(false);
    setError(undefined);
    setIsLoading(false);
    setIsLoadingMore(false);
  }

  // React to session id changes: reset state, then fetch the initial page.
  // We read only `sessionId()` here so the effect re-fires exactly when the
  // session id changes; reading `messages()` would create a feedback loop
  // (messages change → effect → fetch → messages change again).
  createEffect(() => {
    const sid = sessionId();
    if (sid === loadedFor()) return;
    resetForSession(sid);
    if (sid) void fetchPage(sid, 'initial', 0);
  });

  async function loadMore(): Promise<void> {
    const sid = sessionId();
    if (!sid) return;
    if (isLoadingMore() || isLoading()) return;
    const offset = nextOffset();
    if (offset === null) return;
    await fetchPage(sid, 'more', offset);
  }

  async function refresh(): Promise<void> {
    const sid = sessionId();
    if (!sid) return;
    try {
      const page = await listMessages(sid, {
        limit: initialPageSize,
        offset: 0,
      });
      if (inflightFor !== sid && loadedFor() !== sid) return;
      if (!('items' in page)) return;
      // Merge tail: keep older prepended messages, append any new tail
      // messages that don't yet exist locally.
      const incoming = page.items;
      setMessages((current) => {
        const firstExistingId = incoming[0]?.id;
        const tailStart =
          firstExistingId !== undefined
            ? current.findIndex((m) => m.id === firstExistingId)
            : -1;
        if (tailStart === -1) return incoming;
        const newTail = incoming.slice(current.length - tailStart);
        let next = current;
        for (const msg of newTail) {
          next = mergeAppend(next, msg);
        }
        return next;
      });
      setTotal(page.total);
      setNextOffset(page.nextOffset);
      setHasMore(page.nextOffset !== null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  onCleanup(() => {
    inflightFor = undefined;
  });

  return {
    messages,
    total,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}
