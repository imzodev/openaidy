import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { cleanup } from '@solidjs/testing-library';
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

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const [sid] = createSignal<string | undefined>('session-1');
        const state = useInfiniteMessages(sid);
        queueMicrotask(() => {
          expect(state.messages()).toHaveLength(1);
          expect(state.total()).toBe(25);
          expect(state.hasMore()).toBe(false);
          expect(state.isLoading()).toBe(false);
          dispose();
          resolve();
        });
      });
    });
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

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [sid] = createSignal<string | undefined>('session-1');
        const state = useInfiniteMessages(sid);
        queueMicrotask(async () => {
          try {
            await state.loadMore();
            const ids = state.messages().map((m) => m.id);
            // Oldest → newest after prepending
            expect(ids).toEqual(['m1', 'm2', 'm51', 'm52']);
            expect(state.total()).toBe(70);
            expect(state.hasMore()).toBe(true);
            expect(state.isLoadingMore()).toBe(false);
            // A second loadMore should fetch the next page
            await state.loadMore();
            expect(state.messages()).toHaveLength(4);
            expect(state.hasMore()).toBe(true);
            dispose();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  });

  it('loadMore is a no-op when there are no more pages', async () => {
    mockedListMessages({
      'session-1:0': {
        items: [makeMsg('m1', '2024-01-01T10:00:00Z')],
        total: 1,
        nextOffset: null,
      },
    });

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const [sid] = createSignal<string | undefined>('session-1');
        const state = useInfiniteMessages(sid);
        queueMicrotask(async () => {
          await state.loadMore();
          expect(vi.mocked(wsApi.listMessages)).toHaveBeenCalledTimes(1);
          dispose();
          resolve();
        });
      });
    });
  });

  it('does not refetch when switching to an already-loaded session', async () => {
    mockedListMessages({
      'session-1:0': {
        items: [makeMsg('m1', '2024-01-01T10:00:00Z')],
        total: 1,
        nextOffset: null,
      },
    });

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const [sid, setSid] = createSignal<string | undefined>('session-1');
        useInfiniteMessages(sid);
        queueMicrotask(() => {
          // Force a re-render by toggling the signal without changing value
          // — Solid effects re-fire only when the dependency's value changes,
          // but we want to be sure no extra fetches happen when the id is
          // identical.
          setSid('session-1');
          // Wait another tick.
          setTimeout(() => {
            expect(vi.mocked(wsApi.listMessages)).toHaveBeenCalledTimes(1);
            dispose();
            resolve();
          }, 50);
        });
      });
    });
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

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [sid, setSid] = createSignal<string | undefined>('session-1');
        const state = useInfiniteMessages(sid);
        queueMicrotask(() => {
          try {
            expect(state.messages().map((m) => m.id)).toEqual(['s1-m1']);
            setSid('session-2');
            queueMicrotask(() => {
              expect(state.messages().map((m) => m.id)).toEqual([
                's2-m1',
                's2-m2',
              ]);
              expect(state.total()).toBe(2);
              dispose();
              resolve();
            });
          } catch (err) {
            reject(err);
          }
        });
      });
    });
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

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        const [sid, setSid] = createSignal<string | undefined>('session-1');
        const state = useInfiniteMessages(sid);

        // After the initial effect fires (fetching session-1), switch
        // sessions so session-2's fast response lands first.
        queueMicrotask(() => {
          setSid('session-2');

          // Wait for session-2's fetch to resolve and its signals to settle.
          queueMicrotask(() => {
            try {
              // Now let the stale session-1 request resolve.
              resolveFirst(undefined);

              // Wait for the stale response to be processed (should be
              // discarded because inflightFor is now 'session-2').
              queueMicrotask(() => {
                expect(state.messages().map((m) => m.id)).toEqual(['fresh']);
                dispose();
                resolve();
              });
            } catch (err) {
              reject(err);
            }
          });
        });
      });
    });
  });

  it('captures fetch errors into the error signal', async () => {
    vi.mocked(wsApi.listMessages).mockRejectedValue(new Error('boom'));

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const [sid] = createSignal<string | undefined>('session-1');
        const state = useInfiniteMessages(sid);
        queueMicrotask(() => {
          expect(state.error()).toBe('boom');
          expect(state.isLoading()).toBe(false);
          dispose();
          resolve();
        });
      });
    });
  });
});
