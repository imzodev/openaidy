# OpenAidy Desktop App — Product Specification

## Overview

OpenAidy Desktop transforms OpenAidy into a native desktop application with a persistent background service, system tray integration, and OS-native credential management. The desktop app provides full functionality of the CLI and web frontend in a native, installable package.

## Target Users

1. **Individual developers** who want a persistent AI assistant running in the background
2. **Power users** who prefer a native app over a browser tab
3. **Teams** with a shared self-hosted deployment (desktop as a client to a hosted server)
4. **Developers** building and testing OpenAidy addons locally

## User Experience

### First Launch Flow

```
1. User runs the installer (deb/dmg/exe)
2. App installs, creates config directory (~/.config/openaidy)
3. First-launch wizard:
   a. Welcome screen
   b. API key setup (stored in OS keychain)
   c. Choose startup mode: "Start with system" or "Manual"
   d. Desktop app opens with full UI
```

### Core UX Principles

- **Persistent background service** — The AI assistant is always available, even when the window is closed
- **Familiar Solid.js UI** — Same interface as the web app, no learning curve
- **OS-native feel** — System tray, keychain integration, native window controls
- **Zero-config for basic use** — SQLite database, sensible defaults, no manual setup

## Feature List

### MVP Features (Must Have)

| Feature                | Description                                         |
| ---------------------- | --------------------------------------------------- |
| **Core Service**       | `apps/server` runs as a background subprocess       |
| **Native Window**      | Solid.js SPA in Tauri WebView with native title bar |
| **System Tray**        | App minimizes to tray, right-click menu             |
| **Close to Tray**      | Closing window hides app (doesn't quit)             |
| **Keychain Storage**   | API keys stored in OS credential manager            |
| **Service Restart**    | Auto-restart on crash (max 3 attempts)              |
| **Window Persistence** | Size/position saved across sessions                 |
| **Debian Package**     | `.deb` installer for Linux                          |
| **macOS Package**      | `.dmg` installer for macOS                          |
| **Windows Installer**  | `.exe`/`.msi` for Windows                           |

### Post-MVP Features (Nice to Have)

| Feature                 | Description                           | Priority |
| ----------------------- | ------------------------------------- | -------- |
| **Background Service**  | systemd/LaunchAgent auto-start        | High     |
| **Fullscreen Mode**     | F11 or button to toggle               | Medium   |
| **File Associations**   | `.openaidy` project files open in app | Low      |
| **Auto-update**         | Check for updates on launch           | Medium   |
| **SQLite Offline Mode** | Fully offline desktop use             | High     |
| **Code Signing**        | Signed installers for all platforms   | High     |

## UI/UX Specification

### Window Model

- **Single main window** — One window containing the Solid.js SPA
- **Dialogs** — Native OS dialogs for file picking, confirmations
- **System tray** — Persistent tray icon when app is running
- **Notifications** — Native OS notifications for pulse/task events

### Layout Structure

The Solid.js SPA fills the entire window. No custom window chrome is added — the OS native title bar is used. This means the UI is exactly the same as in the browser, but without browser tabs/address bar.

```
┌─────────────────────────────────────────────────────────┐
│  [OS Native Title Bar]                    [─] [□] [×]  │
├─────────────────────────────────────────────────────────┤
│  ┌─────┬───────────────────────────────────────────┐   │
│  │     │                                           │   │
│  │ S   │  Solid.js SPA (Apps, Chats, Addons, etc.) │   │
│  │ I   │                                           │   │
│  │ D   │                                           │   │
│  │ E   │                                           │   │
│  │ B   │                                           │   │
│  │ A   │                                           │   │
│  │ R   │                                           │   │
│  └─────┴───────────────────────────────────────────┘   │
│                                          [Status Bar]  │
└─────────────────────────────────────────────────────────┘
```

### System Tray Menu

```
┌─────────────────────────┐
│  🟣 Open OpenAidy       │  ← Shows + focuses window
│  ─────────────────────  │
│  🔄 Restart Service     │  ← Restarts the core service
│  ─────────────────────  │
│  ⚙️ Settings            │  ← Opens settings in the app
│  ─────────────────────  │
│  ❌ Quit OpenAidy       │  ← Quits app + service
└─────────────────────────┘
```

### Status Bar (Desktop Indicator)

The frontend adds a status indicator showing service health:

```
┌──────────────────────────────────────────────────────────┐
│  Agents │ Sessions │ Addons │           [🟢 Desktop]    │
└──────────────────────────────────────────────────────────┘
```

- **🟢 Desktop** — Service running, connected
- **🟡 Starting** — Service starting up
- **🔴 Stopped** — Service not running (click to restart)

### Settings Panel

Accessible from the app's settings page (no separate desktop settings):

| Setting            | Description             | Storage     |
| ------------------ | ----------------------- | ----------- |
| API Keys           | Provider credentials    | OS Keychain |
| Theme              | Light/dark (follows OS) | Config file |
| Service Auto-start | Run on login            | OS service  |
| Notifications      | Enable/disable          | Config file |
| Data Location      | `~/.config/openaidy`    | Config      |

### Visual Design

- **Theme:** Matches the existing Solid.js app (light/dark OS theme)
- **Window chrome:** OS native (no custom title bar)
- **Font:** System font stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`)
- **Icons:** Existing Bootstrap Icons from `apps/web`
- **Tray icon:** Simple openaidy logo, single color (template on macOS)

## User Flows

### Flow 1: First-Time Setup

```
User installs app
    │
    ▼
App launches → Shows main window (first time: onboarding wizard)
    │
    ▼
User enters API keys (stored in keychain)
    │
    ▼
App connects to core service → Shows agent list
    │
    ▼
User starts using OpenAidy normally
```

### Flow 2: Returning User (App Already Configured)

```
User clicks app icon / dock
    │
    ▼
App window appears (immediately, service already running in background)
    │
    ▼
User sees last state (sessions, agents)
```

### Flow 3: Minimize to Tray

```
User clicks close button (×) on window
    │
    ▼
Window hides (app stays in tray)
    │
    ▼
User can quit via tray menu "Quit"
    │
    ▼
If quit: service stops gracefully
```

### Flow 4: Service Crash Recovery

```
Service crashes (e.g., unhandled exception)
    │
    ▼
Tauri detects (via wait() on subprocess)
    │
    ▼
Restarts automatically (up to 3 times)
    │
    ▼
After 3 failures: shows notification, stops auto-restart
    │
    ▼
User can manually restart via tray menu or app UI
```

## Edge Cases & Error Handling

| Scenario                           | Expected Behavior                               |
| ---------------------------------- | ----------------------------------------------- |
| Port already in use                | `portpicker` finds another free port            |
| Keychain access denied             | Prompt user, fall back to manual env var        |
| Server fails to bind (15s timeout) | Show error dialog, offer to retry               |
| Database file corrupted            | Backup and create fresh, warn user              |
| No internet                        | Service still runs, agent calls fail gracefully |
| Multiple app launches              | Single instance only (port file lock)           |
| Update available                   | Show notification in tray                       |
| Addon crashes                      | Isolated to that addon, others continue         |

## Open Questions / Future Decisions

| Question              | Notes                                                 |
| --------------------- | ----------------------------------------------------- |
| Code signing          | Required for macOS Gatekeeper and Windows SmartScreen |
| Auto-update mechanism | Tauri's built-in updater or manual                    |
| Full offline mode     | Swap Postgres for SQLite (document path)              |
| Default plugins       | Ship with pre-installed addons?                       |
| Multiple workspaces   | Support per-project `openaidy.yaml` from tray         |
| Mobile companion      | (Future) iOS/Android app connecting to same service   |
