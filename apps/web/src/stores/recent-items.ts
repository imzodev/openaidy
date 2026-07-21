/**
 * Recent items store
 *
 * Lightweight localStorage-backed tracking for the most-recently-touched
 * sessions and agents, surfaced in the command palette. We deliberately do
 * NOT query the existing API for this: (a) the palette must work before
 * sessions/agents finish loading, (b) it survives across sessions of
 * inactivity even after the in-memory list is gone, and (c) it stays
 * decoupled from API caching state.
 */

import { createSignal } from 'solid-js';

export type RecentSession = {
  id: string;
  title: string;
};

export type RecentAgent = {
  id: string;
  name: string;
};

const STORAGE_KEY = 'openaidy_recent_items';
const MAX_ITEMS = 5;

type StoredState = {
  sessions: RecentSession[];
  agents: RecentAgent[];
};

const EMPTY_STATE: StoredState = { sessions: [], agents: [] };

function readState(): StoredState {
  if (typeof localStorage === 'undefined') return { ...EMPTY_STATE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeState(state: StoredState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be full or disabled (private mode); silently ignore.
  }
}

function pushRecent<T extends { id: string }>(list: T[], item: T): T[] {
  const filtered = list.filter((entry) => entry.id !== item.id);
  return [item, ...filtered].slice(0, MAX_ITEMS);
}

const [recentSessions, setRecentSessionsInternal] = createSignal<
  RecentSession[]
>([]);
const [recentAgents, setRecentAgentsInternal] = createSignal<RecentAgent[]>([]);

/**
 * Initialise the store from localStorage. Safe to call once on app mount; if
 * called again, the in-memory signals are reset to the latest stored value
 * (so HMR / test re-mounts don't lose state).
 */
export function initRecentItems(): void {
  const state = readState();
  setRecentSessionsInternal(state.sessions);
  setRecentAgentsInternal(state.agents);
}

/** Reactive accessor for the most recently visited sessions (newest first). */
export function recentSessionsSignal() {
  return recentSessions();
}

/** Reactive accessor for the most recently visited agents (newest first). */
export function recentAgentsSignal() {
  return recentAgents();
}

/** Record a session visit and persist. De-duplicates by id. */
export function recordRecentSession(item: RecentSession): void {
  const next = pushRecent(recentSessions(), item);
  setRecentSessionsInternal(next);
  writeState({ sessions: next, agents: recentAgents() });
}

/** Record an agent visit and persist. De-duplicates by id. */
export function recordRecentAgent(item: RecentAgent): void {
  const next = pushRecent(recentAgents(), item);
  setRecentAgentsInternal(next);
  writeState({ sessions: recentSessions(), agents: next });
}

/** Test/utility helper: wipe both lists. */
export function clearRecentItems(): void {
  setRecentSessionsInternal([]);
  setRecentAgentsInternal([]);
  writeState({ ...EMPTY_STATE });
}
