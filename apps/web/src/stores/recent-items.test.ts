import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initRecentItems,
  recordRecentSession,
  recordRecentAgent,
  recentSessionsSignal,
  recentAgentsSignal,
  clearRecentItems,
} from './recent-items';

const STORAGE_KEY = 'openaidy_recent_items';

const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  clearRecentItems();
});

describe('recent-items store', () => {
  it('starts empty', () => {
    initRecentItems();
    expect(recentSessionsSignal()).toEqual([]);
    expect(recentAgentsSignal()).toEqual([]);
  });

  it('records and persists a session visit', () => {
    recordRecentSession({ id: 's1', title: 'Project Alpha' });
    initRecentItems();
    expect(recentSessionsSignal()).toEqual([
      { id: 's1', title: 'Project Alpha' },
    ]);
    const stored = JSON.parse(store.get(STORAGE_KEY) ?? '{}');
    expect(stored.sessions[0]).toEqual({
      id: 's1',
      title: 'Project Alpha',
    });
  });

  it('moves a re-visited session to the top of the list', () => {
    recordRecentSession({ id: 's1', title: 'Alpha' });
    recordRecentSession({ id: 's2', title: 'Beta' });
    recordRecentSession({ id: 's1', title: 'Alpha (renamed)' });
    const ids = recentSessionsSignal().map((s) => s.id);
    expect(ids[0]).toBe('s1');
    expect(ids).toEqual(['s1', 's2']);
    expect(recentSessionsSignal()[0].title).toBe('Alpha (renamed)');
  });

  it('keeps at most 5 items per category', () => {
    for (let i = 1; i <= 7; i++) {
      recordRecentSession({ id: `s${i}`, title: `Session ${i}` });
    }
    expect(recentSessionsSignal()).toHaveLength(5);
    // The newest should be s7, oldest in-window should be s3.
    expect(recentSessionsSignal()[0].id).toBe('s7');
    expect(recentSessionsSignal()[4].id).toBe('s3');
  });

  it('tracks agents independently from sessions', () => {
    recordRecentSession({ id: 's1', title: 'Alpha' });
    recordRecentAgent({ id: 'a1', name: 'Coder' });
    expect(recentSessionsSignal()).toHaveLength(1);
    expect(recentAgentsSignal()).toHaveLength(1);
    expect(recentAgentsSignal()[0].name).toBe('Coder');
  });

  it('rehydrates from localStorage on init', () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        sessions: [{ id: 's1', title: 'Persisted' }],
        agents: [{ id: 'a1', name: 'Persisted Agent' }],
      }),
    );
    initRecentItems();
    expect(recentSessionsSignal()[0].title).toBe('Persisted');
    expect(recentAgentsSignal()[0].name).toBe('Persisted Agent');
  });

  it('survives malformed JSON in localStorage', () => {
    store.set(STORAGE_KEY, '{not json');
    initRecentItems();
    expect(recentSessionsSignal()).toEqual([]);
    expect(recentAgentsSignal()).toEqual([]);
  });
});
