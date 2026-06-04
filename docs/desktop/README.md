# OpenAidy Desktop App — Implementation Plan

## Overview

**Goal:** Ship OpenAidy as a native desktop application (`.deb`, `.dmg`, `.exe`) that reuses the existing `apps/server` core with zero modifications.

**Principle:** The core (`apps/server`) is the single source of truth. Desktop is a Tauri shell around the existing Solid.js SPA.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Desktop App (Tauri)                     │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  WebView (embedded Chromium)                          │  │
│  │                                                        │  │
│  │  Solid.js SPA (apps/web)  ←  NO CHANGES NEEDED       │  │
│  │  ├── Router                                           │  │
│  │  ├── AddonLoader                                      │  │
│  │  └── All existing components                          │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │                                   │
│                         ▼                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Core Service (apps/server) — same process            │  │
│  │  • Provider registry                                  │  │
│  │  • Agent management                                   │  │
│  │  • Session management                                 │  │
│  │  • Pulse/scheduler                                    │  │
│  │  • Addon system                                       │  │
│  │  • HTTP API (:port)                                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │                                   │
│  ┌──────────────────────┴───────────────────────────────┐  │
│  │  Platform Integration                                 │  │
│  │  • System tray icon                                   │  │
│  │  • OS menus                                           │  │
│  │  • Window controls (min/max/close)                    │  │
│  │  • OS keychain (credential storage)                   │  │
│  │  • Auto-start on login                                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

OS Service Management (installed by the app):
┌─────────────────────────────────────────────────────────────┐
│  Background Service                                         │
│  ├── Linux   →  systemd user service                       │
│  ├── macOS   →  LaunchAgent plist                          │
│  └── Windows →  Windows Service or scheduled task           │
└─────────────────────────────────────────────────────────────┘
```

**Key insight:** The Tauri shell does NOT modify `apps/server`. It:

1. Spawns `apps/server` as a subprocess
2. Opens the Solid.js SPA in the WebView
3. Provides native OS integration (tray, menus, keychain)

---

## What Gets Reused

| Component                 | Reused As-Is | Notes                                         |
| ------------------------- | ------------ | --------------------------------------------- |
| `apps/server`             | ✅ Yes       | Spawned as subprocess, no code changes        |
| `apps/web` (Solid.js SPA) | ✅ Yes       | Served by the core service in WebView         |
| Provider registry         | ✅ Yes       | Part of `apps/server`                         |
| Addon system              | ✅ Yes       | Served by `apps/server`, rendered by Solid.js |
| Agent/session/pulse APIs  | ✅ Yes       | All HTTP, same endpoints                      |
| Database (Postgres)       | ✅ Yes       | Local Postgres or swapped to SQLite           |

---

## What Needs to Be Built

| Component         | Location                         | Description                                     |
| ----------------- | -------------------------------- | ----------------------------------------------- |
| Tauri shell       | `apps/desktop/`                  | New — Tauri 2.x project, wraps Solid.js UI      |
| Service manager   | `apps/desktop/src/service/`      | Spawn, monitor, restart the core service        |
| OS integrations   | `apps/desktop/src-tauri/src/`    | Tray, menus, keychain, auto-start               |
| Installer configs | `apps/desktop/src-tauri/bundle/` | NSIS (Windows), DMG (macOS), deb/rpm (Linux)    |
| Desktop UI tweaks | `apps/web/` (minor)              | Window controls, fullscreen, OS-specific styles |

---

## Directory Structure

```
apps/
├── desktop/                    ← NEW Tauri project
│   ├── src/                   ← Rust source (Tauri commands)
│   │   ├── main.rs
│   │   ├── service.rs         ← Spawn/monitor apps/server
│   │   ├── tray.rs            ← System tray integration
│   │   ├── menu.rs            ← OS menus
│   │   ├── keychain.rs        ← OS credential storage
│   │   └── commands.rs        ← IPC commands to frontend
│   ├── src-tauri/             ← Tauri configuration
│   │   ├── tauri.conf.json    ← App name, window config, bundle targets
│   │   ├── Cargo.toml
│   │   ├── icons/
│   │   └── bundle/            ← Per-OS installer configs
│   └── web/                   ← Symlink or copy of apps/web
│                                (Tauri builds from the Solid.js output)
apps/
└── web/                       ← Existing — no changes
```

**Note:** `apps/web` is not copied — Tauri is configured to use `apps/web/dist` (the Vite build output) as the WebView content.

---

## Implementation Phases

### Phase 1: Tauri Shell Setup

**Goal:** Get a working Tauri window showing the existing Solid.js SPA.

1. Create `apps/desktop/` with `npm create tauri-app@latest` (Solid.js template)
2. Configure `apps/desktop/src-tauri/tauri.conf.json`:
   - App name: `OpenAidy`
   - Window: size 1200×800, resizable, title bar per OS
   - Dev tools: enabled for development
   - Frontend dev path: `http://localhost:port` (dev) or `../web/dist` (prod)
3. Install Tauri CLI globally: `cargo install tauri-cli`
4. Verify: `pnpm tauri dev` opens a window with the Solid.js app

**Deliverable:** `apps/desktop/` with `tauri.conf.json`, bare Rust main, window showing SPA.

---

### Phase 2: Core Service Integration

**Goal:** `apps/server` runs as a managed subprocess, the WebView connects to it.

1. In `apps/desktop/src-tauri/src/service.rs`:
   - Detect if `apps/server` is already running on a port (check env or config file)
   - If not running, spawn `node /path/to/apps/server/dist/index.js` as a child process
   - Write the assigned port to `~/.config/openaidy/port` so the WebView knows where to connect
   - Handle graceful shutdown: send SIGTERM / kill process group on app exit
   - Auto-restart on crash (simple restart loop with exponential backoff, max 3 retries)
2. Configure Vite proxy in dev: WebView → `http://127.0.0.1:port`
3. Configure Tauri to load `http://127.0.0.1:port` in the WebView

**Deliverable:** Desktop app spawns the core service automatically. WebView shows the Solid.js UI connected to it.

---

### Phase 3: Platform Service Installation

**Goal:** The app installs itself as a background service so it runs on OS boot.

| OS      | Mechanism            | Config Location                             |
| ------- | -------------------- | ------------------------------------------- |
| Linux   | systemd user service | `~/.config/systemd/user/openaidy.service`   |
| macOS   | LaunchAgent plist    | `~/Library/LaunchAgents/dev.openaidy.plist` |
| Windows | Windows Service      | Registered during install via NSIS          |

**For Linux (systemd):**

```ini
[Unit]
Description=OpenAidy Background Service

[Service]
Type=simple
ExecStart=/usr/local/bin/openaidy-service
Restart=on-failure
RestartSec=5
WorkingDirectory=%h/.config/openaidy

[Install]
WantedBy=default.target
```

**For macOS (LaunchAgent):**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.openaidy</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/openaidy-service</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

**Implementation:**

- Create the service definition file at first launch (or during install)
- Register with `systemctl --user daemon-reload` (Linux) or `launchctl load` (macOS)
- Windows: call `sc create` via NSIS during install

**Deliverable:** App runs as a persistent background service after installation.

---

### Phase 4: OS Credential Storage

**Goal:** Store API keys in the OS keychain instead of env vars.

| OS      | Solution          | Library                 |
| ------- | ----------------- | ----------------------- |
| Linux   | libsecret         | `tauri-plugin-secret`   |
| macOS   | Keychain          | `tauri-plugin-keychain` |
| Windows | Credential Locker | `tauri-plugin-keychain` |

**Flow:**

1. On first launch, prompt user to enter API keys (or load from env if set)
2. Store in OS keychain via Tauri command
3. `apps/server` retrieves credentials at startup via a Tauri IPC call → `apps/desktop` reads keychain and sets env vars before spawning the service

**Implementation:**

```rust
// apps/desktop/src-tauri/src/keychain.rs
#[tauri::command]
fn store_credential(key: String, value: String) -> Result<(), String> {
    keyring::set_password("openaidy", &key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_credential(key: String) -> Result<String, String> {
    keyring::get_password("openaidy", &key)
        .map_err(|e| e.to_string())
}
```

**Deliverable:** API keys stored in OS keychain. Core service reads them at startup.

---

### Phase 5: System Tray & Window Management

**Goal:** Native OS integration for window controls and tray.

**System Tray:**

- On minimize/close: app hides to tray (doesn't quit)
- Tray menu: "Open OpenAidy", "Quit"
- Tray icon: openaidy icon (from `apps/desktop/src-tauri/icons/`)

**Window Controls:**

- Per-platform (native title bar handles everything on macOS/Linux)
- On Windows: custom title bar only if needed for close-to-tray behavior

**Implementation:**

```rust
// apps/desktop/src-tauri/src/tray.rs
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit OpenAidy", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Open OpenAidy", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => { app.exit(0); }
            "show" => { app.get_webview_window("main").map(|w| w.show()); }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                app.get_webview_window("main").map(|w| w.show());
            }
        })
        .build(app)?;

    Ok(())
}
```

**Deliverable:** Tray icon with menu. App minimizes to tray on close.

---

### Phase 6: Installer Configuration

**Goal:** Produce `.deb`, `.dmg`, `.exe` installers from the same codebase.

Configure `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi", "dmg", "deb", "rpm", "appimage"],
    "identifier": "dev.openaidy",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "nsis": {
        "installMode": "currentUser"
      }
    },
    "macOS": {
      "minimumSystemVersion": "10.15"
    },
    "linux": {
      "appimage": { "bundleMediaFramework": false }
    }
  }
}
```

**Build command:** `pnpm tauri build`

**Output:**

```
apps/desktop/src-tauri/target/release/bundle/
├── deb/  openaidy_0.1.0_amd64.deb
├── msi/  openaidy_0.1.0_x64_en-US.msi
├── dmg/  openaidy_0.1.0.dmg
├── appimage/  openaidy_0.1.0_amd64.AppImage
└── rpm/  openaidy-0.1.0-1.x86_64.rpm
```

**Deliverable:** All three platform installers from a single build.

---

### Phase 7: Database Considerations

**Goal:** Ensure the core service works in a desktop context (local-only or with an existing hosted DB).

Two options depending on the use case:

**Option A — Local SQLite (fully offline desktop):**

- Swap Prisma provider from Postgres to SQLite
- Database file at `~/.config/openaidy/openaidy.db`
- No changes to app logic, just config

**Option B — Keep Postgres (requires a server):**

- Use `DATABASE_URL` pointing to a local Postgres instance or a remote URL
- Works if the user already has Postgres or wants a hosted setup

**Recommendation:** Start with Option B (existing Postgres setup), add SQLite migration path later if there's demand for fully offline mode.

---

## Implementation Order

```
1. Phase 1: Tauri shell (verify SPA loads)
2. Phase 2: Service spawning (apps/server as subprocess)
3. Phase 4: OS keychain (API key storage)
4. Phase 3: Background service (systemd/LaunchAgent)
5. Phase 5: System tray + window management
6. Phase 6: Installer configs
7. Phase 7: Database (optional — SQLite swap if needed)
```

---

## File Inventory (What's New)

```
apps/desktop/
├── src/
│   ├── main.rs                ← Tauri entry, setup calls
│   ├── service.rs             ← Spawn/monitor apps/server subprocess
│   ├── tray.rs                ← System tray
│   ├── menu.rs                ← OS menus
│   ├── keychain.rs            ← OS keychain CRUD
│   └── commands.rs            ← Tauri IPC commands (exposed to frontend)
├── src-tauri/
│   ├── tauri.conf.json        ← App name, window, bundle targets
│   ├── Cargo.toml             ← Rust dependencies
│   ├── icons/                 ← App icons (various sizes)
│   ├── capabilities/           ← Tauri capabilities (permissions)
│   └── build.rs               ← Build script
├── package.json               ← Node dependencies, scripts
├── tsconfig.json
├── vite.config.ts
└── SPEC.md                    ← Tauri app specification
```

---

## Dependencies to Add

**Rust (`apps/desktop/src-tauri/Cargo.toml`):**

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-keychain = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
keyring = "3"
log = "0.4"
env_logger = "0.11"
```

**Node (`apps/desktop/package.json`):**

```json
{
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  },
  "dependencies": {
    "@tauri-apps/api": "^2"
  }
}
```

---

## Verification Checklist

After each phase:

- [ ] `pnpm tauri dev` launches without errors
- [ ] Solid.js app renders in the Tauri window
- [ ] `apps/server` starts as subprocess and serves API on expected port
- [ ] Tray icon appears and menu works
- [ ] Minimize to tray on close works
- [ ] `pnpm tauri build` produces installers for target OS
- [ ] Installed app runs without terminal, persists after reboot
- [ ] API keys stored in keychain persist across restarts
- [ ] Addons load and render correctly in the desktop app
