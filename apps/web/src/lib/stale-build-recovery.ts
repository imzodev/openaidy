/**
 * Recovers from a stale build after a server update/restart, once the app
 * is already running. Complements the inline script in index.html, which
 * handles the initial entry script itself failing to load — this instead
 * catches Vite's documented `vite:preloadError` event, fired when a later
 * dynamically-imported route/chunk 404s because the server's assets/
 * directory has since been replaced by a newer build.
 *
 * Uses the same sessionStorage guard key as index.html's inline script so
 * either failure counts toward the same one-time reload budget.
 */

const GUARD_KEY = 'openaidy_stale_build_reload';

export function installStaleBuildRecovery(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    if (sessionStorage.getItem(GUARD_KEY)) {
      console.error(
        '[stale-build] dynamic import failed — already reloaded once this session, not retrying',
      );
      return;
    }
    sessionStorage.setItem(GUARD_KEY, '1');
    console.warn(
      '[stale-build] dynamic import failed — reloading to pick up the current build',
    );
    window.location.reload();
  });
}

/**
 * Clear the reload guard once the app has rendered successfully, so a
 * separate stale-build incident later in the same long-lived tab (e.g. a
 * second deploy while the tab stayed open) can still self-heal once more.
 */
export function clearStaleBuildGuard(): void {
  sessionStorage.removeItem(GUARD_KEY);
}
