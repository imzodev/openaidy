# Task 05: Frontend IPC Bridge

## Objective

Create a TypeScript bridge so the Solid.js frontend can call Tauri Rust commands (keychain, service status, window management) and handle events from the Tauri backend.

## Success Criteria

1. `@tauri-apps/api` is used in `apps/web` to call Rust commands
2. `src/lib/tauri-bridge.ts` exposes all Tauri IPC commands as typed async functions
3. Frontend can read/write credentials, get service status, and control the window
4. Tauri events (e.g., service crashed notification) flow to the frontend

## Reused Components

| Component      | Path                               | Purpose                            |
| -------------- | ---------------------------------- | ---------------------------------- |
| Solid.js app   | `apps/web/src/App.tsx`             | Already imported and used          |
| Addon loader   | `apps/web/src/lib/addon-loader.ts` | Works in WebView without changes   |
| TanStack Query | `@tanstack/solid-query`            | Already in `apps/web` package.json |

## Files to Create/Modify

```
apps/web/src/lib/                           ← NEW directory
apps/web/src/lib/tauri-bridge.ts           ← NEW: Tauri IPC bindings
apps/web/src/lib/keychain-bridge.ts        ← NEW: Keychain IPC bindings
apps/web/src/lib/service-bridge.ts         ← NEW: Service status + control
apps/web/src/lib/window-bridge.ts          ← NEW: Window control
apps/web/src/App.tsx                       ← MODIFY: Wire in Tauri context
apps/web/package.json                      ← ADD: @tauri-apps/api
```

## Implementation Steps

### Step 5.1: Install @tauri-apps/api in apps/web

```bash
cd /tmp/openaidy/apps/web
pnpm add @tauri-apps/api
```

Verify `package.json` now includes:

```json
"@tauri-apps/api": "^2",
```

### Step 5.2: Create tauri-bridge.ts

Create `apps/web/src/lib/tauri-bridge.ts`:

```typescript
/**
 * Tauri IPC Bridge
 *
 * Type-safe wrappers around Tauri invoke() calls.
 * All commands are defined in apps/desktop/src-tauri/src/commands.rs
 *
 * This file is loaded by the Solid.js app in BOTH browser (dev) and
 * Tauri WebView (prod). Commands gracefully no-op in browser mode.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@tauri-apps/api/core';

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
export function minimizeWindow(): void {
  const { getCurrentWindow } = require('@tauri-apps/api/window');
  getCurrentWindow().minimize();
}

/**
 * Maximize or restore the window.
 */
export async function toggleMaximize(): Promise<void> {
  const { getCurrentWindow } = require('@tauri-apps/api/window');
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
export function closeWindow(): void {
  const { getCurrentWindow } = require('@tauri-apps/api/window');
  getCurrentWindow().hide();
}

/**
 * Hide window to system tray (close button behavior).
 */
export function hideToTray(): void {
  const { getCurrentWindow } = require('@tauri-apps/api/window');
  getCurrentWindow().hide();
}

// ─── Environment Bridge ───────────────────────────────────────────────────────

/**
 * Read the current service port from the port file.
 * This is how the frontend knows where to connect.
 */
export async function getServicePort(): Promise<number> {
  // In Tauri: read from OPENAIDY_HOME/port via Rust command
  // In browser: use hardcoded dev port
  if (isTauri()) {
    const { readTextFile } = require('@tauri-apps/plugin-fs');
    const { homeDir } = require('@tauri-apps/api/path');
    const home = await homeDir();
    const portFile = `${home}/.config/openaidy/port`;
    const portStr = await readTextFile(portFile);
    return parseInt(portStr.trim(), 10);
  }
  // Fallback for browser dev mode
  return 3001;
}
```

### Step 5.3: Create a Tauri Provider for Solid.js

Create `apps/web/src/lib/tauri-provider.tsx`:

```typescript
/**
 * TauriProvider — wraps the app with Tauri-specific context.
 *
 * Provides:
 * - Service status polling (for status bar display)
 * - Tauri event listeners (service crashed, etc.)
 * - `isDesktop` flag for conditional rendering
 */

import {
  createContext,
  useContext,
  createSignal,
  onMount,
  onCleanup,
  type ParentComponent,
} from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getServiceStatus, type ServiceStatus } from './tauri-bridge';

interface TauriContextValue {
  isDesktop: boolean;
  serviceStatus: () => ServiceStatus | null;
  isConnected: () => boolean;
}

const TauriContext = createContext<TauriContextValue>();

export const TauriProvider: ParentComponent = (props) => {
  const [serviceStatus, setServiceStatus] = createSignal<ServiceStatus | null>(null);
  const [unlisten, setUnlisten] = createSignal<UnlistenFn[]>([]);

  onMount(async () => {
    if (!isTauri()) {
      return;
    }

    // Poll service status every 5 seconds
    const interval = setInterval(async () => {
      try {
        const status = await getServiceStatus();
        setServiceStatus(status);
      } catch (e) {
        console.warn('Failed to get service status:', e);
      }
    }, 5000);

    // Listen for service events
    const unlistenCrash = await listen('service-crashed', (event) => {
      console.error('Service crashed:', event.payload);
      setServiceStatus(null);
    });

    setUnlisten([...unlisten(), unlistenCrash, () => clearInterval(interval)]);
  });

  onCleanup(() => {
    for (const fn of unlisten()) {
      fn();
    }
  });

  const isConnected = () => {
    const s = serviceStatus();
    return s !== null && s.state === 'Running';
  };

  const value: TauriContextValue = {
    isDesktop: isTauri(),
    serviceStatus,
    isConnected,
  };

  return (
    <TauriContext.Provider value={value}>
      {props.children}
    </TauriContext.Provider>
  );
};

export function useTauri() {
  const ctx = useContext(TauriContext);
  if (!ctx) {
    throw new Error('useTauri must be used inside <TauriProvider>');
  }
  return ctx;
}
```

### Step 5.4: Wire into App.tsx

Modify `apps/web/src/App.tsx`:

```tsx
import { Router } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { TauriProvider } from './lib/tauri-provider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TauriProvider>
        <Router>{/* existing routes */}</Router>
      </TauriProvider>
    </QueryClientProvider>
  );
}

export default App;
```

### Step 5.5: Add Service Status Indicator (Desktop UI)

In the Solid.js app's layout or status bar, show a connection indicator when running in Tauri:

```tsx
// apps/web/src/components/DesktopStatusBar.tsx
import { useTauri } from '../lib/tauri-provider';
import { getServiceStatus, restartService } from '../lib/tauri-bridge';

export function DesktopStatusBar() {
  const { isDesktop, serviceStatus, isConnected } = useTauri();

  if (!isDesktop) return null;

  return (
    <div class="flex items-center gap-2 text-sm">
      <span
        class={`w-2 h-2 rounded-full ${
          isConnected() ? 'bg-green-500' : 'bg-red-500'
        }`}
        title={serviceStatus()?.state ?? 'Disconnected'}
      />
      <span class="text-gray-500">
        {isConnected()
          ? `Desktop (port ${serviceStatus()?.port})`
          : 'Service stopped'}
      </span>
      {!isConnected() && (
        <button
          onClick={async () => {
            try {
              await restartService();
            } catch (e) {
              console.error('Restart failed:', e);
            }
          }}
          class="text-blue-500 hover:underline"
        >
          Restart
        </button>
      )}
    </div>
  );
}
```

### Step 5.6: Detect Core Service URL

The frontend needs to know where to connect (in Tauri, it's `http://127.0.0.1:<port>`). Add a utility:

```typescript
// apps/web/src/lib/api-client.ts
import { getServicePort } from './tauri-bridge';

let _baseUrl: string | null = null;

export async function getApiBase(): Promise<string> {
  if (_baseUrl) return _baseUrl;

  // In Tauri, read port from file
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    const port = await getServicePort();
    _baseUrl = `http://127.0.0.1:${port}`;
  } else {
    // Browser dev mode: localhost:3001
    _baseUrl = 'http://localhost:3001';
  }

  return _baseUrl;
}

// Re-export the api client with dynamic base URL
export async function createApiClient() {
  const baseUrl = await getApiBase();
  return {
    baseUrl,
    async get<T>(path: string): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return res.json();
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
      return res.json();
    },
  };
}
```

## Existing Frontend HTTP Client

The Solid.js app already has a way to connect to the server (likely using `createApiClient()` or similar). The `getApiBase()` approach above is additive — it lets the existing client work in both browser and Tauri without modification by dynamically resolving the base URL.

## Reused Components

| Component                          | Role                    | Changes                        |
| ---------------------------------- | ----------------------- | ------------------------------ |
| `apps/web/src/App.tsx`             | Root component          | Add `TauriProvider` wrapper    |
| `apps/web/src/lib/addon-loader.ts` | Dynamic addon loading   | Works in WebView               |
| TanStack Query                     | Server state management | Already present                |
| `@tauri-apps/api`                  | Tauri JS bindings       | Add to `apps/web/package.json` |

## Risks & Mitigations

| Risk                                | Mitigation                                    |
| ----------------------------------- | --------------------------------------------- |
| Frontend calls Tauri API in browser | `isTauri()` guard + fallback values           |
| Port file not found                 | Show "Install desktop app" message in browser |
| Service status polling fails        | Silently update status, don't crash frontend  |
| Stale `isConnected()` check         | Use actual `serviceStatus().state` check      |
