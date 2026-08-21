/**
 * Tauri IPC Bridge
 *
 * Type-safe wrappers around Tauri invoke() calls.
 * All commands are defined in apps/desktop/src-tauri/src/commands.rs
 *
 * This file is loaded by the Solid.js app in BOTH browser (dev) and
 * Tauri WebView (prod). Commands gracefully no-op in browser mode.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// ─── Guards ──────────────────────────────────────────────────────────────────

function assertTauri(): void {
  if (!isTauri()) {
    throw new Error('Tauri API called in non-Tauri environment');
  }
}

// ─── Service Commands ────────────────────────────────────────────────────────

export interface ServiceStatus {
  state: string;
  port: number | null;
  restart_attempts: number;
  pid: number | null;
  openaidy_home: string;
}

export interface ServiceBridge {
  getStatus(): Promise<ServiceStatus>;
  restart(): Promise<number>; // returns port
  stop(): Promise<void>;
}

/**
 * Get current service status.
 * Works in: Tauri WebView only.
 */
export async function getServiceStatus(): Promise<ServiceStatus> {
  assertTauri();
  return invoke<ServiceStatus>('get_service_status');
}

/**
 * Restart the core service.
 * Works in: Tauri WebView only.
 */
export async function restartService(): Promise<number> {
  assertTauri();
  return invoke<number>('restart_service');
}

/**
 * Read the spawned server's own bootstrap-admin token back from disk, so
 * LoginScreen can pre-fill it — a desktop install has no separate "admin"
 * to hand the user a token out-of-band. Returns null outside Tauri, or if
 * the server hasn't created/persisted a token yet.
 */
export async function getBootstrapAdminToken(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('get_bootstrap_admin_token');
}

/**
 * Stop the core service.
 * Works in: Tauri WebView only.
 */
export async function stopService(): Promise<void> {
  assertTauri();
  return invoke('stop_service');
}

// ─── Keychain Commands ────────────────────────────────────────────────────────

export interface KeychainBridge {
  storeCredential(account: string, value: string): Promise<void>;
  getCredential(account: string): Promise<string>;
  deleteCredential(account: string): Promise<void>;
  listCredentials(): Promise<string[]>;
}

/**
 * Store a credential (API key) in the OS keychain.
 */
export async function storeCredential(
  account: string,
  value: string,
): Promise<void> {
  assertTauri();
  return invoke('store_credential', { account, value });
}

/**
 * Retrieve a credential from the OS keychain.
 */
export async function getCredential(account: string): Promise<string> {
  assertTauri();
  return invoke<string>('get_credential', { account });
}

/**
 * Delete a credential from the OS keychain.
 */
export async function deleteCredential(account: string): Promise<void> {
  assertTauri();
  return invoke('delete_credential', { account });
}

/**
 * List all stored credential account names.
 */
export async function listCredentials(): Promise<string[]> {
  assertTauri();
  return invoke<string[]>('list_credentials');
}

// ─── Window Commands ──────────────────────────────────────────────────────────

export interface WindowBridge {
  minimize(): void;
  maximize(): void;
  close(): void;
  hideToTray(): void;
}

/**
 * Minimize the window.
 */
export async function minimizeWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  getCurrentWindow().minimize();
}

/**
 * Maximize or restore the window.
 */
export async function toggleMaximize(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  const isMaximized = await win.isMaximized();
  if (isMaximized) {
    await win.unmaximize();
  } else {
    await win.maximize();
  }
}

/**
 * Close the window (app continues running in tray).
 */
export async function closeWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  getCurrentWindow().hide();
}

/**
 * Hide window to system tray (close button behavior).
 */
export async function hideToTray(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  getCurrentWindow().hide();
}

// ─── Environment Bridge ───────────────────────────────────────────────────────

/**
 * Get the port the spawned core service is actually listening on. Reuses
 * get_service_status (already the single source of truth ServiceManager
 * reports through) instead of reading a port file directly — the service's
 * port is picked dynamically per launch, so a file read is both redundant
 * and, on Windows, pointed at a path that doesn't exist there.
 */
export async function getServicePort(): Promise<number> {
  if (isTauri()) {
    const status = await getServiceStatus();
    if (status.port == null) {
      throw new Error('Core service has no port yet (not running)');
    }
    return status.port;
  }
  // Fallback for browser dev mode
  return 3001;
}

/**
 * Poll until the core service reports a listening port, or has given up
 * retrying after a crash. The Rust side starts the service asynchronously
 * in the background rather than blocking window creation on it (see
 * apps/desktop/src-tauri/src/lib.rs) — the window, and this app's JS, can
 * both be up well before the service actually has a port — so callers that
 * need a real API origin (see setApiBase in index.tsx) have to wait for it
 * here rather than assuming it's already available.
 */
export async function waitForServicePort(
  timeoutMs = 30_000,
  pollIntervalMs = 250,
): Promise<number> {
  if (!isTauri()) return 3001;

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getServiceStatus();
    if (status.state === 'Running' && status.port != null) {
      return status.port;
    }
    if (status.state === 'Crashed') {
      throw new Error(
        `Core service crashed on startup (after ${status.restart_attempts} restart attempt(s))`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the core service to start');
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// ─── Updater ──────────────────────────────────────────────────────────────────

/**
 * Check `updater.endpoints` (tauri.conf.json — the latest.json a tagged
 * release publishes, see release.yml) for a newer version. Returns `null`
 * in the browser build and when already up to date, so callers can treat
 * "nothing to show" as a single falsy case.
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  return check();
}

/**
 * Download and install an update found by {@link checkForUpdate}, then
 * relaunch so the new version actually takes effect — the updater plugin
 * only replaces the installed binary, it doesn't restart the process
 * itself. `onProgress` receives cumulative bytes downloaded once the total
 * content length is known (some update artifacts don't report one, in
 * which case it's never called).
 */
export async function installUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  assertTauri();
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null;
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded, total);
    }
  });
  await relaunch();
}
