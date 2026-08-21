# OpenAidy Desktop App — Architecture

## Design Principles

1. **Core immutability** — `apps/server` and `apps/web` are never modified by the desktop feature. They are composed, not changed.
2. **Desktop as a thin shell** — Tauri provides window management, tray, and IPC. All business logic lives in the core service.
3. **Service-first** — The server runs as a real OS service (systemd/LaunchAgent/etc), not just a subprocess of the Tauri process.
4. **Progressive enhancement** — The desktop app works in "embedded mode" (server spawned by Tauri) for development and simple use. "Service mode" (system service) is opt-in for power users.
5. **Same addon experience** — Addons are loaded and rendered identically whether the frontend is in a browser or a Tauri WebView.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User's Machine                                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Tauri Desktop Process                                             │  │
│  │                                                                   │  │
│  │   main.rs (Rust entry)                                            │  │
│  │    ├── ServiceManager (spawns/monitors apps/server)                │  │
│  │    ├── TrayManager (system tray icon + menu)                      │  │
│  │    ├── WindowManager (close-to-tray, state persistence)            │  │
│  │    ├── KeychainManager (OS credential storage)                     │  │
│  │    └── IPC Commands (exposed to frontend)                          │  │
│  │           └── Tauri IPC (invoke())                                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                      Tauri WebView (Chromium/WebKit)                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Solid.js SPA (apps/web)          ← no changes for desktop        │  │
│  │   ├── Router → /agents, /sessions, /addons/:id, /settings         │  │
│  │   ├── AddonLoader → import(`/addons/${id}/${entry}`)              │  │
│  │   ├── TanStack Query → server state                               │  │
│  │   └── TauriBridge → IPC calls to Rust backend                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                           localhost:<port>                               │
│                                    │                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Core Service (apps/server)          ← same binary as CLI/server   │  │
│  │                                                                   │  │
│  │   Fastify HTTP API                                               │  │
│  │   ├── /api/agents/*      (AgentRegistry + invocation)             │  │
│  │   ├── /api/sessions/*    (SessionMessageService)                  │  │
│  │   ├── /api/pulses/*      (PulseService + SchedulerService)        │  │
│  │   ├── /api/addons/*      (AddonService + manifest validation)     │  │
│  │   ├── /addons/<id>/...   (Static: addon bundle files)             │  │
│  │   ├── /api/providers/*   (ProviderRegistry)                        │  │
│  │   ├── /ws               (WebSocket for real-time)                 │  │
│  │   └── /health           (Health check)                            │  │
│  │                                                                   │  │
│  │   Services (in-process)                                           │  │
│  │   ├── ProviderRegistry    ← plugin-based, Hermes-style hooks      │  │
│  │   ├── AgentRegistry       ← YAML-defined agents                    │  │
│  │   ├── SessionMessageService  ← conversation state                   │  │
│  │   ├── PulseService        ← cron scheduling                       │  │
│  │   ├── AddonService        ← lifecycle + permissions               │  │
│  │   ├── ConfigService       ← openaidy.yaml                         │  │
│  │   └── SkillRegistry       ← builtin + user skills                 │  │
│  │                                                                   │  │
│  │   Data Layer                                                       │  │
│  │   ├── SQLite (default)  →  ~/.config/openaidy/openaidy.db        │  │
│  │   └── Postgres (optional) → user-configured DATABASE_URL          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  OS-Level                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Keychain / Credential Manager     ← API keys stored here          │  │
│  │  System Tray                        ← App icon + quick menu        │  │
│  │  Background Service (optional)      ← systemd / LaunchAgent        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## IPC Communication

### Rust → TypeScript (Tauri Events)

```
Rust Backend                          Frontend (Solid.js)
     │                                       │
     │  emit("service-crashed", payload)    │
     │ ──────────────────────────────────▶  │  listen() → update UI
     │                                       │
     │  emit("addon-installed", addonId)    │
     │ ──────────────────────────────────▶  │  listen() → refresh addon list
```

### TypeScript → Rust (invoke)

```
Frontend (Solid.js)                   Rust Backend
     │                                       │
     │  invoke("store_credential", {...})   │
     │ ──────────────────────────────────▶  │  keyring::store()
     │   ◀────────────────────────────────── │  Ok(())
     │                                       │
     │  invoke("get_service_status")         │
     │ ──────────────────────────────────▶  │  ServiceManager::status()
     │   ◀────────────────────────────────── │  ServiceStatus { state, port }
     │                                       │
     │  invoke("restart_service")            │
     │ ──────────────────────────────────▶  │  ServiceManager::stop(); start()
     │   ◀────────────────────────────────── │  Ok(port)
```

---

## Data Flow: App Startup

```
1. User launches OpenAidy (dock/taskbar/CLI)
   │
2. Tauri main() runs
   │
3. ServiceManager::start() called
   │  ├─ pick_free_port()
   │  ├─ locate_server_entry() → /apps/server/src/server.ts or dist/index.js
   │  ├─ build_server_env() → PORT, OPENAIDY_HOME, keychain creds, etc.
   │  └─ spawn server subprocess (tsx/server.ts)
   │
4. Poll until server binds to port (TCP connect check, 15s timeout)
   │
5. write_port_file(port) → ~/.config/openaidy/port
   │
6. setup_tray() → system tray icon + menu
   │
7. setup_close_to_tray() → window close → hide (not quit)
   │
8. Tauri WebView loads Solid.js SPA
   │  └─ In dev: http://localhost:5173 (Vite)
   │  └─ In prod: app://... (bundled dist)
   │
9. Solid.js App.mount()
   │
10. TauriProvider mounts
    │  ├─ Poll service status (getServiceStatus) every 5s
    │  └─ Listen for Tauri events (service-crashed, etc.)
    │
11. TanStack Query fetches /api/config, /api/agents, etc.
    │  └─ Uses getApiBase() → reads port file → http://127.0.0.1:PORT
    │
12. User sees full app UI with agent list, sessions, addons
```

---

## Data Flow: Addon Loading in Desktop

```
1. User navigates to /addons in Solid.js app
   │
2. TanStack Query calls GET /api/addons → ListAddonResponse
   │
3. For each enabled addon:
   │
4. AddonLoader.loadAddon(addon) called
   │
5. const addonUrl = `/addons/${addonId}/${manifest.entry}`;
   │  └─ This is served by apps/server at /addons/:id/dist/index.js
   │
6. const module = await import(addonUrl);
   │  └─ Tauri WebView fetch() → http://127.0.0.1:PORT/addons/...
   │
7. module[componentName] → Solid.js component
   │
8. Router registers route: /addon-id → component
   │
9. User navigates to /my-addon → addon component renders
   │
10. Addon calls runtime.invokeAgent("my-addon", input)
    │  └─ POST /api/addon-proxy/agents/my-addon/invoke
    │      ├─ JWT validated
    │      ├─ Permissions checked
    │      └─ Forwards to AgentRegistry
```

---

## File Map

```
apps/
├── desktop/                              ← NEW
│   ├── src-tauri/
│   │   ├── src/
│   │   │   ├── main.rs                   ← Rust entry (spawns service, setups tray)
│   │   │   ├── lib.rs                   ← (optional) library exports
│   │   │   ├── service.rs               ← ServiceManager (spawn + restart)
│   │   │   ├── service_install.rs        ← OS service registration
│   │   │   ├── keychain.rs               ← OS keychain CRUD
│   │   │   ├── tray.rs                  ← System tray setup
│   │   │   ├── window.rs                ← Window state, close-to-tray
│   │   │   └── commands.rs              ← Tauri IPC command handlers
│   │   ├── Cargo.toml
│   │   ├── build.rs
│   │   ├── tauri.conf.json
│   │   ├── capabilities/                ← Tauri capability permissions
│   │   └── icons/
│   │       ├── 32x32.png
│   │       ├── 128x128.png
│   │       ├── 128x128@2x.png
│   │       ├── icon.icns
│   │       └── icon.ico
│   ├── bundle/
│   │   ├── linux/
│   │   │   └── openaidy.service          ← systemd unit file
│   │   ├── macos/
│   │   │   ├── dev.openaidy.plist        ← LaunchAgent plist
│   │   │   └── entitlements.plist       ← macOS sandbox entitlements
│   │   └── windows/
│   │       ├── openaidy-task.xml         ← Scheduled task XML
│   │       └── installer.nsi             ← NSIS custom install/uninstall
│   ├── scripts/
│   │   └── openaidy-service.sh           ← Service wrapper (Linux/macOS)
│   │       openaidy-service.bat          ← Service wrapper (Windows)
│   ├── src/                             ← Web root (Tauri CLI scaffold)
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.ts
│   └── SPEC.md
│
apps/web/                                ← Existing (no changes)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── tauri-bridge.ts          ← NEW (IPC calls)
│   │   │   ├── tauri-provider.tsx        ← NEW (Solid context provider)
│   │   │   ├── keychain-bridge.ts       ← NEW (keychain IPC)
│   │   │   └── service-bridge.ts        ← NEW (service status)
│   │   ├── components/
│   │   │   └── DesktopStatusBar.tsx      ← NEW (status indicator)
│   │   ├── App.tsx                      ← MODIFY (wrap with TauriProvider)
│   │   └── ...
│   └── package.json                      ← MODIFY (add @tauri-apps/api)
│
apps/server/                             ← Existing (no changes)
│   └── src/
│       ├── server.ts                    ← Entry point (reads PORT env var)
│       ├── app.ts                       ← Full Fastify app (no changes)
│       ├── lib/env.ts                   ← Respects PORT, OPENAIDY_HOME, etc.
│       ├── routes/addons.ts             ← Serves /addons/<id>/... static files
│       ├── addons/service.ts            ← Addon lifecycle
│       ├── addons/proxy.ts              ← Addon proxy with permissions
│       └── ...
│
packages/                                ← Existing (no changes)
│   ├── config/                          ← Provider config schemas
│   ├── db/                              ← SQLite + Postgres adapters
│   └── ...
```

---

## Key Rust → TypeScript Types

```typescript
// apps/desktop/src-tauri/src/commands.rs → exposed via IPC

interface ServiceStatus {
  state: 'Idle' | 'Starting' | 'Running' | 'Crashed' | 'Stopping';
  port: number | null;
  restart_attempts: number;
  pid: number | null;
  openaidy_home: string;
}

// apps/desktop/src-tauri/src/keychain.rs → exposed via IPC
interface KeychainBridge {
  store_credential(account: string, value: string): Promise<void>;
  get_credential(account: string): Promise<string>;
  delete_credential(account: string): Promise<void>;
  list_credentials(): Promise<string[]>;
}

// apps/desktop/src-tauri/src/window.rs → exposed via IPC
interface WindowCommands {
  show_main_window(): void;
  minimize_window(): void;
  toggle_maximize(): Promise<void>;
  close_window(): void;
}
```

---

## Security Boundaries

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Tauri WebView (Solid.js SPA)                                           │
│  - Same-origin policy enforced by browser                                 │
│  - CSP: connect-src only to http://127.0.0.1:*                          │
│  - No access to filesystem, keychain, or subprocess directly              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │ IPC (invoke)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Tauri Rust Backend                                                     │
│  - Validates all IPC input                                               │
│  - keyring: credentials stored in OS keychain, never in memory long-term │
│  - ServiceManager: runs as user, not root                                │
│  - No arbitrary code execution                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │ spawn subprocess
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Core Service (Node.js)                                                  │
│  - Fastify: CORS enforced to app:// protocol (Tauri origin)               │
│  - JWT: addon tokens scoped to specific permissions                      │
│  - Addon proxy: validates permissions before agent invocation            │
│  - No filesystem access outside OPENAIDY_HOME                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Performance Budget

| Metric                         | Budget  | Justification                            |
| ------------------------------ | ------- | ---------------------------------------- |
| Tauri binary size              | < 15MB  | Sub-10MB is ideal; WebView adds overhead |
| Installer size (all platforms) | < 20MB  | Competitive with similar apps            |
| Cold startup (window)          | < 3s    | On SSD, average hardware                 |
| Cold startup (service)         | < 2s    | Node.js server startup                   |
| Idle memory (combined)         | < 250MB | Reasonable for a dev tool                |
| Restart after crash            | < 5s    | Includes detection + restart             |
