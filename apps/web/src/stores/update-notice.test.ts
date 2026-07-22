import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UpdateCheckResult } from '@openaidy/shared-types';
import {
  initUpdateNotice,
  recordUpdateCheck,
  availableUpdateVersion,
  updateBadgeVisible,
  dismissUpdate,
  updateInProgress,
  setUpdateInProgress,
  resetUpdateNotice,
} from './update-notice';

const STORAGE_KEY = 'openaidy_update_dismissed';

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

function check(
  updateAvailable: boolean,
  latestVersion = '0.4.0',
): UpdateCheckResult {
  return {
    currentVersion: '0.3.8',
    latestVersion,
    updateAvailable,
    canSelfUpdate: true,
  };
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  resetUpdateNotice();
});

describe('update-notice store', () => {
  it('starts with no badge and no available version', () => {
    initUpdateNotice();
    expect(availableUpdateVersion()).toBeNull();
    expect(updateBadgeVisible()).toBe(false);
  });

  it('shows the badge when an update is available', () => {
    recordUpdateCheck(check(true, '0.4.0'));
    expect(availableUpdateVersion()).toBe('0.4.0');
    expect(updateBadgeVisible()).toBe(true);
  });

  it('hides the badge when already up to date', () => {
    recordUpdateCheck(check(false));
    expect(availableUpdateVersion()).toBeNull();
    expect(updateBadgeVisible()).toBe(false);
  });

  it('hides the badge for a dismissed version and persists the dismissal', () => {
    recordUpdateCheck(check(true, '0.4.0'));
    dismissUpdate();
    expect(updateBadgeVisible()).toBe(false);
    expect(store.get(STORAGE_KEY)).toBe('0.4.0');
  });

  it('re-shows the badge when a newer version than the dismissed one appears', () => {
    recordUpdateCheck(check(true, '0.4.0'));
    dismissUpdate();
    expect(updateBadgeVisible()).toBe(false);

    // A newer release lands — the old dismissal must not suppress it.
    recordUpdateCheck(check(true, '0.5.0'));
    expect(updateBadgeVisible()).toBe(true);
  });

  it('hydrates a persisted dismissal on init', () => {
    store.set(STORAGE_KEY, '0.4.0');
    initUpdateNotice();
    recordUpdateCheck(check(true, '0.4.0'));
    expect(updateBadgeVisible()).toBe(false);
  });

  it('tracks in-progress state (in-memory only)', () => {
    expect(updateInProgress()).toBe(false);
    setUpdateInProgress(true);
    expect(updateInProgress()).toBe(true);
    // Not persisted — nothing written to localStorage.
    expect(store.has(STORAGE_KEY)).toBe(false);
  });
});
