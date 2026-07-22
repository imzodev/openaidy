/**
 * Update-notice store (issue #456)
 *
 * Tracks whether a newer OpenAidy version is available so the Settings sidebar
 * item can show a badge, and remembers which version the user has dismissed so
 * the badge doesn't nag after they've acknowledged it.
 *
 * Two kinds of state:
 *  - `dismissedVersion` is persisted to localStorage — a dismissal must survive
 *    reloads, otherwise the badge reappears on every page load.
 *  - `availableVersion` and `updateInProgress` are in-memory only. The latest
 *    version is re-derived from a fresh `/api/update/check` on each boot, and an
 *    in-progress flag must NOT survive a restart (the server going down IS the
 *    successful end of an update — a stale `true` would wedge the UI).
 */

import { createSignal, untrack } from 'solid-js';
import type { UpdateCheckResult } from '@openaidy/shared-types';

const STORAGE_KEY = 'openaidy_update_dismissed';

function readDismissed(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

function writeDismissed(version: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (version) localStorage.setItem(STORAGE_KEY, version);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be full or disabled (private mode); silently ignore.
  }
}

const [availableVersion, setAvailableVersion] = createSignal<string | null>(
  null,
);
const [dismissedVersion, setDismissedVersion] = createSignal<string | null>(
  null,
);
const [updateInProgress, setUpdateInProgressInternal] = createSignal(false);

/** Hydrate the dismissed version from localStorage. Call once on app mount. */
export function initUpdateNotice(): void {
  setDismissedVersion(readDismissed());
}

/**
 * Record the result of an update check. When an update is available the newest
 * version is remembered (drives the badge); otherwise the badge state clears.
 */
export function recordUpdateCheck(result: UpdateCheckResult): void {
  setAvailableVersion(result.updateAvailable ? result.latestVersion : null);
}

/** The newest available version, or null when up to date / not yet checked. */
export function availableUpdateVersion(): string | null {
  return availableVersion();
}

/**
 * Whether the Settings sidebar badge should show: an update is available and
 * it isn't the version the user already dismissed.
 */
export function updateBadgeVisible(): boolean {
  const available = availableVersion();
  return available != null && available !== dismissedVersion();
}

/** Dismiss the badge for the currently-available version (persisted). */
export function dismissUpdate(): void {
  untrack(() => {
    const available = availableVersion();
    if (!available) return;
    setDismissedVersion(available);
    writeDismissed(available);
  });
}

/** Whether an update is currently being installed (in-memory only). */
export { updateInProgress };

export function setUpdateInProgress(value: boolean): void {
  setUpdateInProgressInternal(value);
}

/** Test/utility helper: reset all state and clear persistence. */
export function resetUpdateNotice(): void {
  setAvailableVersion(null);
  setDismissedVersion(null);
  setUpdateInProgressInternal(false);
  writeDismissed(null);
}
