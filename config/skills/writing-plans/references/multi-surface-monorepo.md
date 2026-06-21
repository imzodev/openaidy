# Multi-Surface Monorepo Architecture

## Core Principle

**The server is the core.** CLI, desktop, and frontend are different ways to invoke and interact with the same server process — they are "shells," not separate codebases.

```
┌──────────────────────────────────────────────────┐
│                   apps/server                     │
│  (provider registry, LLM orchestration, config,  │
│   addon system, database, auth)                  │
└──────────────────────────────────────────────────┘
         ↑                    ↑                    ↑
    CLI (spawns         Desktop (spawns      Frontend (calls
    server subprocess)  same subprocess)       via HTTP)
```

## Surface Types

| Surface                 | How it invokes server                                                          |
| ----------------------- | ------------------------------------------------------------------------------ |
| **CLI**                 | Spawns `apps/server` as subprocess on `127.0.0.1`, calls it via localhost HTTP |
| **Desktop (Tauri)**     | Same — spawns server subprocess, wraps Solid.js UI in WebView                  |
| **Frontend (Solid.js)** | Already an HTTP client — calls `localhost:port`                                |
| **Addons**              | Loaded by the server process — work identically for all surfaces               |

## What This Means for New Surfaces

Adding a desktop app does NOT require duplicating core logic:

1. **Desktop = Tauri window + Solid.js UI bundled inside + same server subprocess**
2. **Server runs as subprocess** (handle `PORT=0` for auto-allocation, write port to temp file, graceful shutdown)
3. **Frontend needs zero changes** — already an HTTP client
4. **Addons unchanged** — loaded by the server

## Shared Code Pattern

```
packages/           ← shared across all surfaces
├── config/         ← Zod schemas, config loading
├── providers/      ← Provider registry (used by server)
├── runtime/         ← Adapter contract
└── shared-types/   ← Types used everywhere

apps/
├── server/         ← The core (HTTP API, business logic, addons)
├── web/            ← Solid.js SPA (HTTP client only)
└── desktop/        ← NEW: Tauri shell (spawns server + wraps web)
```

## Desktop-Specific Changes

| Area           | Change                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| Server startup | Fork as subprocess, auto-allocate port, write PID file                       |
| Database       | SQLite instead of PostgreSQL for local embedded mode                         |
| Credentials    | OS keychain (macOS Keychain / Windows Credential Locker) instead of env vars |
| Config path    | Platform dirs (`~/.config/openaidy/` on Linux, AppData on Windows)           |
| UI             | Tauri wraps the existing Solid.js app in a native window                     |

## Signs the Architecture Is Wrong

- CLI has its own copy of business logic — should call server
- Desktop has a separate "core" duplicated from server — should reuse `apps/server`
- Frontend makes direct DB calls — should go through server API
- Addons are loaded differently per surface — should be server-side only

## Plan Location

For OpenAidy: plans go in `docs/<feature>/` inside the repo (not `.hermes/plans/`).
Example: `docs/desktop/` for desktop app plan, `docs/providers/` for provider registry plan.
