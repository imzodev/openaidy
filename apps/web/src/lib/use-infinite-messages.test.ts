import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSignal } from 'solid-js';
import { renderHook, cleanup } from '@solidjs/testing-library';
import { useInfiniteMessages } from './use-infinite-messages';
import * as wsApi from './ws-api';
import type { SessionMessage } from './api';

vi.mock('./ws-api', () => ({
  listMessages: vi.fn(),
}));

function makeMsg(
  id: string,
  createdAt: string,
  content = `body-${id}`,
): SessionMessage {
  return {
    id,
    sessionId: 'session-1',
    role: 'user',
    content,
    sequence: Number(id.replace(/\D/g, '')) || 0,
    createdAt,
  };
}

function mockedListMessages(
  responses: Record<
    string,
    | { items: SessionMessage[]; total: number; nextOffset: number | null }
    | Error
  >,
) {
  vi.mocked(wsApi.listMessages).mockImplementation(async (sid, opts = {}) => {
    const offset = opts.offset ?? 0;
    const key = `${sid}:${offset}`;
    const next = responses[key];
    if (!next) throw new Error(`Unexpected request: ${key}`);
    if (next instanceof Error) throw next;
    return next;
  });
}

/** Yield control so Solid's scheduler and any async fetches can settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useInfiniteMessages', () => {
  beforeEach(() => {
    vi.mocked(wsApi.listMessages).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('fetches the initial page on mount when a session is provided', async () => {
    mockedListMessages({
      'session-1:0': {
        items: [makeMsg('m1', '2024-01-01T10:00:00Z')],
        total: 25,
        nextOffset: null,
      },
    });

    const { result, cleanup } = renderHook(() => {
      const [sid] = createSignal<string | undefined>('session-1');
      return useInfiniteMessages(sid);
    });

    // Wait for the effect to fire and the async fetch to complete.
    await tick();

    expect(result.messages()).toHaveLength(1);
    expect(result.total()).toBe(25);
    expect(result.hasMore()).toBe(false);
    expect(result.isLoading()).toBe(false);

    cleanup();
  });

  it('loadMore fetches the next page and prepends it without duplicating', async () => {
    mockedListMessages({
      'session-1:0': {
        items: [
          makeMsg('m51', '2024-01-02T10:00:00Z'),
          makeMsg('m52', '2024-01-02T11:00:00Z'),
        ],
        total: 70,
        nextOffset: 2,
      },
      'session-1:2': {
        items: [
          makeMsg('m1', '2024-01-01T10:00:00Z'),
          makeMsg('m2', '2024-01-01T11:00:00Z'),
        ],
        total: 70,
        nextOffset: 4,
      },
    });

    const { result, cleanup } = renderHook(() => {
      const [sid] = createSignal<string | undefined>('session-1');
      return useInfiniteMessages(sid);
    });

    // Wait for initial fetch.
    await tick();
    expect(result.messages()).toHaveLength(2);

    await result.loadMore();

    const ids = result.messages().map((m) => m.id);
    // Oldest → newest after prepending
    expect(ids).toEqual(['m1', 'm2', 'm51', 'm52']);
    expect(result.total()).toBe(70);
    expect(result.hasMore()).toBe(true);
    expect(result.isLoadingMore()).toBe(false);

    // A second loadMore should fetch the next page
    await result.loadMore();
    expect(result.messages()).toHaveLength(4);
    expect(result.hasMore()).toBe(true);

    cleanup();
  });

  it('loadMore is a no-op when there are no more pages', async () => {
    mockedListMessages({
      'session-1:0': {
        items: [makeMsg('m1', '2024-01-01T10:00:00Z')],
        total: 1,
        nextOffset: null,
      },
    });

    const { result, cleanup } = renderHook(() => {
      const [sid] = createSignal<string | undefined>('session-1');
      return useInfiniteMessages(sid);
    });

    await tick();
    await result.loadMore();
    expect(vi.mocked(wsApi.listMessages)).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('does not refetch when switching to an already-loaded session', async () => {
    mockedListMessages({
      'session-1:0': {
        items: [makeMsg('m1', '2024-01-01T10:00:00Z')],
        total: 1,
        nextOffset: null,
      },
    });

    const { result, cleanup } = renderHook(() => {
      const [sid, setSid] = createSignal<string | undefined>('session-1');
      return { state: useInfiniteMessages(sid), setSid };
    });

    await tick();
    expect(vi.mocked(wsApi.listMessages)).toHaveBeenCalledTimes(1);

    // Toggling the signal to the same value should NOT trigger a refetch.
    result.setSid('session-1');
    await tick();
    expect(vi.mocked(wsApi.listMessages)).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('resets state when switching sessions', async () => {
    mockedListMessages({
      'session-1:0': {
        items: [makeMsg('s1-m1', '2024-01-01T10:00:00Z')],
        total: 1,
        nextOffset: null,
      },
      'session-2:0': {
        items: [
          makeMsg('s2-m1', '2024-02-01T10:00:00Z'),
          makeMsg('s2-m2', '2024-02-01T11:00:00Z'),
        ],
        total: 2,
        nextOffset: null,
      },
    });

    const { result, cleanup } = renderHook(() => {
      const [sid, setSid] = createSignal<string | undefined>('session-1');
      return { state: useInfiniteMessages(sid), setSid };
    });

    await tick();
    expect(result.state.messages().map((m) => m.id)).toEqual(['s1-m1']);

    result.setSid('session-2');
    await tick();
    expect(result.state.messages().map((m) => m.id)).toEqual([
      's2-m1',
      's2-m2',
    ]);
    expect(result.state.total()).toBe(2);

    cleanup();
  });

  it('discards stale responses when the session changes mid-flight', async () => {
    // Deferred promise that we control externally — lets session-1's request
    // stay pending while session-2's request resolves first.
    let resolveFirst: (value: unknown) => void = () => {};
    const firstCall = new Promise((res) => {
      resolveFirst = res;
    });

    vi.mocked(wsApi.listMessages).mockImplementation(async (sid) => {
      if (sid === 'session-1') {
        await firstCall;
        return {
          items: [makeMsg('stale', '2024-01-01T10:00:00Z')],
          total: 1,
          nextOffset: null,
        };
      }
      return {
        items: [makeMsg('fresh', '2024-02-01T10:00:00Z')],
        total: 1,
        nextOffset: null,
      };
    });

    const { result, cleanup } = renderHook(() => {
      const [sid, setSid] = createSignal<string | undefined>('session-1');
      return { state: useInfiniteMessages(sid), setSid };
    });

    // Let the initial effect fire (session-1 fetch starts, but is deferred).
    await tick();

    // Switch sessions before the first request resolves.
    result.setSid('session-2');

    // Wait for session-2's fetch to complete (it resolves immediately).
    await tick();
    expect(result.state.messages().map((m) => m.id)).toEqual(['fresh']);

    // Now let the stale session-1 request resolve.
    resolveFirst(undefined);

    // Wait for the stale response to be processed (should be discarded).
    await tick();
    // State must still be session-2's data.
    expect(result.state.messages().map((m) => m.id)).toEqual(['fresh']);

    cleanup();
  });

  it('captures fetch errors into the error signal', async () => {
    vi.mocked(wsApi.listMessages).mockRejectedValue(new Error('boom'));

    const { result, cleanup } = renderHook(() => {
      const [sid] = createSignal<string | undefined>('session-1');
      return useInfiniteMessages(sid);
    });

    await tick();

    expect(result.error()).toBe('boom');
    expect(result.isLoading()).toBe(false);

    cleanup();
  });
});
