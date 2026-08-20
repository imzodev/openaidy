# Task 01: Tauri Shell Setup

## Objective

Create a minimal Tauri 2.x desktop application that displays the existing `apps/web` Solid.js SPA in a WebView, with zero changes to the existing codebase.

## Success Criteria

1. `pnpm create tauri-app` scaffolds `apps/desktop/` with Solid.js template
2. `apps/desktop/src-tauri/tauri.conf.json` is configured with correct app metadata
3. `pnpm tauri dev` opens a window showing the Solid.js app at `http://localhost:5173` in dev mode
4. Production build (`pnpm tauri build`) produces a working `.app`/`.exe` bundle
5. The WebView connects to the core service running at `http://127.0.0.1:3001`

## Files to Create

```
apps/desktop/                              ← NEW (Tauri project root)
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                        ← Tauri entry point
│   │   └── lib.rs                         ← Library exports (optional)
│   ├── Cargo.toml                         ← Rust dependencies
│   ├── build.rs                           ← Build script (icon generation)
│   ├── tauri.conf.json                    ← Tauri configuration
│   └── icons/                             ← App icons (placeholder)
├── src/                                   ← Web root (scaffolded by Tauri CLI)
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── SPEC.md                                ← Tauri app specification
```

## Implementation Steps

### Step 1.1: Bootstrap Tauri Project

```bash
# Must be done inside /tmp/openaidy/apps/
cd /tmp/openaidy/apps
npm create tauri-app@latest desktop -- --template solid-ts --manager pnpm --yes
```

This creates `apps/desktop/` with the Solid.js + TypeScript + Vite template.

**Verify:**

```bash
cd /tmp/openaidy/apps/desktop
ls -la
# Should have: src-tauri/, src/, package.json, vite.config.ts, index.html
```

### Step 1.2: Configure tauri.conf.json

Edit `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OpenAidy",
  "version": "0.1.0",
  "identifier": "dev.openaidy",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devtools": true
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "OpenAidy",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "center": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi", "dmg", "deb", "appimage"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "minimumSystemVersion": "10.15"
    },
    "linux": {
      "appimage": { "bundleMediaFramework": false }
    },
    "windows": {
      "nsis": { "installMode": "currentUser" }
    }
  },
  "plugins": {
    "shell": {
      "open": true
    }
  }
}
```

**Key fields explained:**

| Field              | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `frontendDist`     | Where `vite build` outputs — Tauri bundles from here in prod |
| `devUrl`           | Tauri opens this URL in dev mode (Vite dev server)           |
| `beforeDevCommand` | Runs before `tauri dev` — starts Vite                        |
| `devtools`         | `true` in dev for debugging; `false` in prod                 |
| `csp`              | Restricts WebView to only connect to `127.0.0.1` (security)  |

### Step 1.3: Add Tauri Rust Dependencies

Edit `apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "openaidy-desktop"
version = "0.1.0"
edition = "2021"

[lib]
name = "openaidy_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-keychain = "2"
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
keyring = "3"
log = "0.4"
env_logger = "0.11"
tokio = { version = "1", features = ["process", "io-util", "sync"] }
portpicker = "0.1"
dirs = "5"

[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

### Step 1.4: Create minimal main.rs

Edit `apps/desktop/src-tauri/src/main.rs`:

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod service;
mod keychain;
mod tray;
mod commands;

use log::{error, info};
use tauri::Manager;

fn main() {
    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    info!("Starting OpenAidy Desktop v{}", env!("CARGO_PKG_VERSION"));

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            info!("Tauri app setup complete");

            // Validate that the web dist exists (in dev, the Vite server handles this)
            #[cfg(not(debug_assertions))]
            {
                let dist_path = app.path().resolve("frontend/dist", app.config().app.as_ref().unwrap().windows.first().map(|w| w.label.as_str()).unwrap_or("main"));
                if !dist_path.exists() {
                    error!("Frontend dist not found at {:?}", dist_path);
                    return Err("Frontend dist not found. Run `pnpm build` first.".into());
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("Tauri runtime error: {}", e);
        std::process::exit(1);
    }
}
```

### Step 1.5: Create placeholder icons

Generate minimal placeholder icons for the build to succeed:

```bash
mkdir -p apps/desktop/src-tauri/icons

# Create a simple 32x32 PNG (you'd replace this with real icons later)
# The Tauri CLI can scaffold default icons; alternatively:
cd /tmp/openaidy/apps/desktop/src-tauri/icons

# For now, create empty placeholder files that allow build to proceed
touch 32x32.png 128x128.png 128x128@2x.png icon.icns icon.ico
```

**Note:** Real icons should be designed and added before shipping. Tauri provides a CLI to generate icons from a single source image:

```bash
pnpm tauri icon /path/to/source.png
```

### Step 1.6: Update package.json scripts

Ensure `apps/desktop/package.json` has the correct scripts:

```json
{
  "name": "@openaidy/desktop",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-keychain": "^2",
    "@tauri-apps/plugin-shell": "^2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "typescript": "~5.9.3",
    "vite": "^8.0.0",
    "vite-plugin-solid": "^2.11.10"
  }
}
```

### Step 1.7: Configure Vite for Tauri

The Vite config (`apps/desktop/vite.config.ts`) should already be set up by the template. Verify it looks like:

```typescript
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
```

### Step 1.8: Link the existing web app (temporary)

In dev mode, Tauri will load `http://localhost:5173` which is served by `apps/web` (not `apps/desktop`). For the shell to work standalone, temporarily point the `devUrl` to the running web dev server.

For **Step 1 only**, we verify the shell works. The integration with `apps/server` and `apps/web` happens in Task 02 and Task 03.

## Verification

```bash
# 1. Start the web dev server (from apps/web)
cd /tmp/openaidy/apps/web && pnpm dev &
# Should output: Local: http://localhost:5173/

# 2. In another terminal, start Tauri dev
cd /tmp/openaidy/apps/desktop && pnpm tauri dev

# Expected result:
# - A window opens titled "OpenAidy"
# - The Solid.js web app is visible at localhost:5173
# - No errors in the Tauri console
```

## Dependencies Added

**Rust (Cargo.toml):**

- `tauri = "2"` — Core Tauri framework
- `tauri-plugin-shell = "2"` — Shell commands plugin
- `tauri-plugin-keychain = "2"` — OS keychain access
- `tauri-plugin-opener = "2"` — Open URLs in default browser
- `keyring = "3"` — Cross-platform keychain access
- `tokio` — Async runtime for process management
- `portpicker` — Find available ports
- `dirs` — Platform-specific home/config directory paths

**Node (package.json):**

- `@tauri-apps/cli` — Tauri CLI tools
- `@tauri-apps/api` — TypeScript API for Tauri commands
- `@tauri-apps/plugin-keychain` — Keychain plugin bindings
- `@tauri-apps/plugin-shell` — Shell plugin bindings

## Risks & Mitigations

| Risk                              | Mitigation                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Tauri 2.x API changes             | Pin to specific minor version in Cargo.toml                                  |
| WebView not available on Linux    | Tauri 2 uses WebKitGTK on Linux; ensure `libwebkit2gtk-4.1-dev` is installed |
| CSP blocking localhost in WebView | Set `connect-src 'self' http://127.0.0.1:*` in tauri.conf.json               |
| Icon build failing                | Use placeholder PNGs initially; real icons before release                    |
