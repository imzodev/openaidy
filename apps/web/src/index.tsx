/* @refresh reload */
import { render } from 'solid-js/web';
import { createSignal, Show, type JSX } from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import './index.css';
import App from './App.tsx';
import { setApiBase } from './lib/api';
import { waitForServicePort } from './lib/tauri-bridge';
import {
  installStaleBuildRecovery,
  clearStaleBuildGuard,
} from './lib/stale-build-recovery';

// Harmless no-op in the desktop build: the frontend is bundled statically
// into the app at build time there, so a live server can never swap out
// assets/ under a running tab the way it can for a browser deployment.
installStaleBuildRecovery();

// ============================================================================
// Addon System Initialization
// ============================================================================

/**
 * Initialize the addon system before app render
 * This sets up error handlers and development mode for addons
 */
async function initializeAddonSystem(): Promise<void> {
  // Set up global error handler for addon errors
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      console.error('[Addon System] Uncaught error:', event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error(
        '[Addon System] Unhandled promise rejection:',
        event.reason,
      );
    });
  }

  // Development mode configuration
  if (import.meta.env.DEV) {
    console.info('[Addon System] Running in development mode');
  }
}

// Initialize addon system
initializeAddonSystem().catch((err) => {
  console.error('[Addon System] Failed to initialize:', err);
});

// ============================================================================
// Application Bootstrap
// ============================================================================

/**
 * In the desktop (Tauri) build, the core service starts asynchronously in
 * the background rather than blocking window creation (see
 * apps/desktop/src-tauri/src/lib.rs) — so the window, and this script, can
 * both be up well before the service has a port to talk to. Gate rendering
 * the real app on that instead of showing a blank window for however long
 * that takes (or, on a hard failure, forever) — and resolve the API/WS
 * origin (see setApiBase) before anything downstream tries to use it.
 * No-ops immediately in the browser build.
 */
function DesktopStartupGate(props: { children: JSX.Element }): JSX.Element {
  const runningInTauri = isTauri();
  const [ready, setReady] = createSignal(!runningInTauri);
  const [error, setError] = createSignal<string | undefined>();

  if (runningInTauri) {
    waitForServicePort()
      .then((port) => {
        setApiBase(`http://127.0.0.1:${port}`);
        setReady(true);
      })
      .catch((err: unknown) => {
        console.error('[tauri] core service failed to start:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  return (
    <Show when={ready()} fallback={<StartupScreen error={error()} />}>
      {props.children}
    </Show>
  );
}

function StartupScreen(props: { error?: string }): JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
      }}
      class="text-text-secondary"
    >
      <Show
        when={!props.error}
        fallback={
          <div
            style={{
              'max-width': '28rem',
              'text-align': 'center',
              padding: '0 1.5rem',
            }}
          >
            <p
              class="text-red-500"
              style={{ 'font-weight': 500, 'margin-bottom': '0.5rem' }}
            >
              OpenAidy couldn't start
            </p>
            <p style={{ 'font-size': '0.875rem', opacity: 0.8 }}>
              {props.error}
            </p>
          </div>
        }
      >
        <p style={{ 'font-size': '0.875rem', opacity: 0.8 }}>
          Starting OpenAidy…
        </p>
      </Show>
    </div>
  );
}

const root = document.getElementById('root');

render(
  () => (
    <DesktopStartupGate>
      <App />
    </DesktopStartupGate>
  ),
  root!,
);
clearStaleBuildGuard();
