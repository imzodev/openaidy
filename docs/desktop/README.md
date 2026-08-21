# OpenAidy Desktop App — Implementation Plan

## Context

OpenAidy currently ships as a CLI + web frontend. The goal is to produce native desktop installers (`.deb`, `.dmg`, `.exe`) that reuse the existing `apps/server` core and `apps/web` frontend without modification.

**Architectural principle:** The core is a Node.js HTTP server. CLI, desktop shell, and web are different clients that invoke it. Desktop is a Tauri WebView wrapping the existing Solid.js SPA.

---

## Directory Structure

```
docs/desktop/
├── README.md                          ← This file (overview + architecture)
├── SPEC.md                            ← Product spec (what the desktop app does)
├── ARCHITECTURE.md                    ← Technical architecture decisions
└── tasks/                             ← Implementation tasks
    ├── 01-tauri-shell-setup.md
    ├── 02-core-service-integration.md
    ├── 03-service-spawning-manager.md
    ├── 04-credential-storage.md
    ├── 05-frontend-IPC-bridge.md
    ├── 06-system-tray.md
    ├── 07-window-management.md
    ├── 08-os-service-installation.md
    ├── 09-installer-configuration.md
    ├── 10-verification-testing.md
    └── DEPENDENCIES.md                ← Consolidated dependency list
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Desktop App (Tauri)                     │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  WebView (embedded Chromium / WebKit)                 │  │
│  │                                                        │  │
│  │  Solid.js SPA (apps/web)          ← reused as-is     │  │
│  │  • Router + AddonLoader                                │  │
│  │  • All existing components                            │  │
│  │  • Communicates with core via HTTP                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│                           ▼                                  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Core Service (apps/server) — spawned as subprocess   │  │
│  │                                                        │  │
│  │  Fastify HTTP API (:port)                             │  │
│  │  ├── /api/agents, /api/sessions, /api/pulses          │  │
│  │  ├── /api/addons/*  (addon bundles served here)      │  │
│  │  ├── /api/providers                                     │  │
│  │  └── /ws  (WebSocket)                                  │  │
│  │                                                        │  │
│  │  Providers  │  Agents  │  Sessions  │  Addons        │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│  ┌───────────────────────┴───────────────────────────────┐  │
│  │  Tauri Rust Backend (apps/desktop/src-tauri/)         │  │
│  │                                                        │  │
│  │  service.rs     → spawn + monitor apps/server         │  │
│  │  keychain.rs    → OS credential storage               │  │
│  │  tray.rs        → system tray icon + menu             │  │
│  │  commands.rs    → IPC commands exposed to frontend    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Background Service (persistent, survives window close)    │
│                                                              │
│  Linux   →  systemd user service  (~/.config/systemd/)    │
│  macOS   →  LaunchAgent plist     (~/Library/LaunchAgents/)│
│  Windows →  Windows Service        (installed by NSIS)     │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

| Decision                | Choice                              | Rationale                                                                          |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| **Desktop framework**   | Tauri 2.x                           | Native Rust backend, WebView for UI, minimal footprint                             |
| **UI rendering**        | Reuse `apps/web`                    | Solid.js SPA served by core, loaded in Tauri WebView                               |
| **Service lifecycle**   | Spawned by Tauri (not installer)    | App controls when server starts/stops, works dev + prod                            |
| **Credential storage**  | OS Keychain (tauri-plugin-keychain) | API keys stored securely, not in env vars or config files                          |
| **Service persistence** | Optional background service         | User can choose to run on login as a tray app                                      |
| **Addon rendering**     | Works identically to browser        | `import()` dynamically loads from `/addons/*` on the core service                  |
| **Database**            | No changes initially                | Keeps existing Postgres/SQLite config. SQLite path configurable for fully offline. |

---

## Reused Components (Read-Only)

| Component         | Path                                  | Role                                                          |
| ----------------- | ------------------------------------- | ------------------------------------------------------------- |
| Core HTTP server  | `apps/server/src/app.ts`              | All business logic, API, agent/session/pulse management       |
| Server entry      | `apps/server/src/server.ts`           | `await app.listen({ host, port })` — no code changes          |
| Provider registry | `apps/server/src/providers/`          | Part of `createProviderServices()` in app.ts                  |
| Addon system      | `apps/server/src/addons/`             | Full addon lifecycle, proxy, security                         |
| Agent registry    | `apps/server/src/agents/`             | `createAgentRegistry()`                                       |
| Session service   | `apps/server/src/sessions/service.ts` | `SessionMessageService`                                       |
| Pulse service     | `apps/server/src/pulses/service.ts`   | `PulseService`                                                |
| Frontend SPA      | `apps/web/`                           | Solid.js + Vite SPA. No code changes. Built via `vite build`. |
| Addon loader      | `apps/web/src/lib/addon-loader.ts`    | `AddonLoader` class, dynamic `import()` — same in WebView     |
| DB adapter        | `packages/db/src/adapter.ts`          | `createDatabaseAdapter()` supports sqlite + postgres          |
| Config service    | `apps/server/src/config/service.ts`   | `createAppConfigService()` reads `openaidy.yaml`              |
| Env schema        | `apps/server/src/lib/env.ts`          | `PORT`, `OPENAIDY_HOME`, `DB_KIND`, etc. — all respected      |

---

## What Is New

| Component           | Path                                     | Description                                         |
| ------------------- | ---------------------------------------- | --------------------------------------------------- |
| Tauri shell         | `apps/desktop/src-tauri/`                | Rust backend: service spawning, keychain, tray, IPC |
| Desktop web wrapper | `apps/desktop/`                          | Node + Vite project that wraps `apps/web/dist`      |
| Tauri config        | `apps/desktop/src-tauri/tauri.conf.json` | App name, window, bundle targets                    |
| IPC commands        | `apps/desktop/src-tauri/src/commands.rs` | `store_credential`, `get_credential`, `open_window` |
| Service manager     | `apps/desktop/src-tauri/src/service.rs`  | Spawn, port discovery, restart-on-crash             |
| Keychain            | `apps/desktop/src-tauri/src/keychain.rs` | OS keychain CRUD via `keyring` crate                |
| Tray                | `apps/desktop/src-tauri/src/tray.rs`     | System tray icon + menu                             |
| Window manager      | `apps/desktop/src-tauri/src/window.rs`   | Minimize-to-tray, restore on click                  |
| Service definitions | `apps/desktop/bundle/linux/`             | systemd unit file                                   |
| Service definitions | `apps/desktop/bundle/macos/`             | LaunchAgent plist                                   |
| Service definitions | `apps/desktop/bundle/windows/`           | NSIS script for Windows Service                     |

---

## Implementation Task Order

```
Phase 1: Foundation
├── Task 01: Tauri shell setup
├── Task 02: Core service integration
└── Task 03: Service spawning manager

Phase 2: OS Integration
├── Task 04: Credential storage (keychain)
├── Task 05: Frontend IPC bridge
├── Task 06: System tray
└── Task 07: Window management

Phase 3: Distribution
├── Task 08: OS service installation
└── Task 09: Installer configuration

Phase 4: Validation
└── Task 10: Verification & testing
```

---

## Build Commands

```bash
# Development
pnpm tauri dev

# Production build
pnpm tauri build

# Output (example)
apps/desktop/src-tauri/target/release/bundle/
├── deb/   openaidy_0.1.0_amd64.deb
├── rpm/   openaidy_0.1.0_x86_64.rpm
├── dmg/   openaidy_0.1.0.dmg
└── appimage/ openaidy_0.1.0_amd64.AppImage
```

MSI is deliberately not built (see `bundle.targets` in `tauri.conf.json`) —
its WiX-based bundler proved unreliable both locally and in CI, and nothing
here needs it: NSIS is the Windows installer that actually ships.

---

## Environment Variables Passed to Core Service

> Note: this table describes the original plan. The shipped implementation
> lives in `apps/desktop/src-tauri/src/service.rs` (`try_start_once`) — see
> that file's doc comments for the current source of truth. The names below
> (`PORT`/`WS_PORT`/`CORS_ORIGIN`) don't match what
> `apps/server/src/lib/env.ts`'s zod schema actually reads and were corrected
> during implementation to `OPENAIDY_PORT`/`OPENAIDY_CORS_ORIGIN` (`WS_PORT`
> isn't a real input — it's derived internally from the port).

The Tauri backend starts `apps/server` with these env vars set:

| Variable               | Source                               | Description                           |
| ---------------------- | ------------------------------------ | ------------------------------------- |
| `OPENAIDY_PORT`        | Allocates free port dynamically      | Core service HTTP port                |
| `OPENAIDY_HOME`        | OS per-user app-data dir             | All data/config lives here            |
| `DB_KIND`              | Existing config or default `sqlite`  | Database type                         |
| `SQLITE_PATH`          | `$OPENAIDY_HOME/openaidy.db`         | SQLite file path                      |
| `DATABASE_URL`         | Existing config                      | Postgres connection (if used)         |
| `OPENAIDY_CORS_ORIGIN` | The real per-OS Tauri WebView origin | CORS allowed origin                   |
| API keys               | OS Keychain → env                    | Set via `keychain.rs` before spawning |

The core service (`apps/server`) reads all of these via `env.ts` — no code changes needed.
