/**
 * In-app self-update contract (issue #456).
 *
 * The server can update a self-hosted, globally-installed OpenAidy
 * (`npm i -g @openaidy/app`) from the UI: it queries the npm registry for the
 * latest version, runs `npm install -g @openaidy/app@latest`, then restarts
 * itself via the `openaidy` CLI. Types here are the shared server/web contract.
 */

/**
 * Lifecycle of an update run, tracked in-memory on the server.
 *
 *  - `idle`       — no update in progress (fresh boot / after a completed one).
 *  - `installing` — `npm install -g @openaidy/app@latest` is running.
 *  - `restarting` — install succeeded; the server is handing off to a detached
 *                   `openaidy restart` and is about to go down.
 *  - `error`      — the install (or restart hand-off) failed; the server stays
 *                   up on the current version and `error` explains why.
 *
 * There is no `complete` state exposed by a live server: a successful update
 * ends with the process restarting, so the client observes success by the
 * server coming back on the new version (or the connection dropping then
 * reconnecting), not by polling for `complete`.
 */
export type UpdateStatus = 'idle' | 'installing' | 'restarting' | 'error';

/** Result of `GET /api/update/check`. */
export interface UpdateCheckResult {
  /** Currently-running version (semver, no `v` prefix). */
  currentVersion: string;
  /** Latest published version from the npm registry (semver, no `v` prefix). */
  latestVersion: string;
  /** True when `latestVersion` is strictly newer than `currentVersion`. */
  updateAvailable: boolean;
  /**
   * Whether this deployment can update itself in-place. Only a packaged global
   * install (`@openaidy/app`) can; a from-source / dev run cannot, and the UI
   * should guide the user to update manually instead of offering the button.
   */
  canSelfUpdate: boolean;
  /** Best-effort release-notes summary for `latestVersion`; omitted if unavailable. */
  releaseNotes?: string;
}

/** In-memory update state, returned by `GET /api/update/status` and `POST /api/update`. */
export interface UpdateState {
  status: UpdateStatus;
  /** Human-readable description of the current step. */
  message?: string;
  /** The version being installed (present once an update has been triggered). */
  newVersion?: string;
  /** Failure reason; present only when `status === 'error'`. */
  error?: string;
}
