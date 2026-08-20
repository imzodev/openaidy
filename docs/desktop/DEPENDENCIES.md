# OpenAidy Desktop App — Dependencies

Consolidated reference for all dependencies introduced by the desktop app feature.

---

## Rust Dependencies (Cargo.toml)

**File:** `apps/desktop/src-tauri/Cargo.toml`

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
# ─── Core Tauri ────────────────────────────────────────────────────────────
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-opener = "2"

# ─── Serialization ─────────────────────────────────────────────────────────
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# ─── Keychain ──────────────────────────────────────────────────────────────
keyring = "3"

# ─── Async runtime ─────────────────────────────────────────────────────────
tokio = { version = "1", features = ["process", "io-util", "sync", "rt-multi-thread", "macros", "time"] }

# ─── Port picking ──────────────────────────────────────────────────────────
portpicker = "0.1"

# ─── Platform dirs ─────────────────────────────────────────────────────────
dirs = "5"

# ─── Logging ───────────────────────────────────────────────────────────────
log = "0.4"
env_logger = "0.11"

[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

### Why Each Rust Dependency

| Crate                 | Purpose                 | Why Needed                              |
| --------------------- | ----------------------- | --------------------------------------- |
| `tauri = "2"`         | Core framework          | App shell, WebView, window management   |
| `tauri-plugin-shell`  | Execute commands        | Invoke Vite dev server, system apps     |
| `tauri-plugin-opener` | Open URLs               | Open external links in default browser  |
| `serde`               | Serialization           | Config file I/O, IPC structs            |
| `serde_json`          | JSON parsing            | Port file, window state                 |
| `keyring`             | Cross-platform keychain | Store API keys in OS credential manager |
| `tokio`               | Async runtime           | Service spawning, process management    |
| `portpicker`          | Port selection          | Find free port for server               |
| `dirs`                | Platform directories    | `~/.config/openaidy` on all platforms   |
| `log` + `env_logger`  | Logging                 | Structured logging in Rust backend      |

---

## Node Dependencies (package.json)

**File:** `apps/desktop/package.json`

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
    "@types/node": "^24.12.0",
    "typescript": "~5.9.3",
    "vite": "^8.0.0",
    "vite-plugin-solid": "^2.11.10"
  }
}
```

### Why Each Node Dependency

| Package                       | Purpose              | Why Needed                                   |
| ----------------------------- | -------------------- | -------------------------------------------- |
| `@tauri-apps/api`             | JS ↔ Rust IPC        | Invoke Rust commands from frontend           |
| `@tauri-apps/plugin-keychain` | Keychain JS bindings | `store_credential`, `get_credential` from TS |
| `@tauri-apps/plugin-shell`    | Shell JS bindings    | Open external URLs                           |
| `@tauri-apps/cli`             | Tauri CLI tools      | `pnpm tauri dev`, `pnpm tauri build`         |
| `vite`                        | Bundler              | Builds `apps/web` for Tauri                  |
| `vite-plugin-solid`           | Solid.js Vite plugin | Build the Solid.js SPA                       |
| `typescript`                  | TypeScript support   | Type-check the frontend code                 |

---

## Frontend Dependencies (apps/web)

**File:** `apps/web/package.json` — additions only

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2"
  }
}
```

The existing `apps/web` dependencies (Solid.js, `@solidjs/router`, TanStack Query, etc.) are reused without modification. Only `@tauri-apps/api` is added to enable IPC calls.

---

## System Dependencies (OS-level)

These are **not** npm/Rust packages — they must be installed on the build machine or target OS:

### Linux (Build & Runtime)

```bash
# Build
apt install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  pkg-config \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  libxdo-dev \
  librsvg2-dev \
  libfuse2  # AppImage bundling needs FUSE at build time; not installed by
            # default on Ubuntu 24.04+ runners/desktops

# Runtime (for users)
sudo apt install \
  libwebkit2gtk-4.1-0 \
  libsecret-1-0 \
  nodejs  # Or use the bundled Node from the server
```

### macOS (Build & Runtime)

```bash
# Build — requires Xcode CLI tools
xcode-select --install

# Runtime — uses native macOS Keychain
# No extra packages needed
```

### Windows (Build & Runtime)

```powershell
# Build — requires Visual Studio Build Tools
# and WebView2 SDK (usually pre-installed on Win10+)

# Runtime
# WebView2 runtime (usually comes with Windows 10/11)
# If missing: download from https://go.microsoft.com/fwlink/p/?LinkId=2124703
```

---

## Service Wrapper Script

The service wrapper is a **shell script**, not a package. It requires:

| Dependency                | Purpose            | Platform     |
| ------------------------- | ------------------ | ------------ |
| `bash`                    | Script interpreter | Linux, macOS |
| `node` or `tsx`           | Run the server     | All          |
| `systemd` (user instance) | Service manager    | Linux        |
| `launchd`                 | Service manager    | macOS        |

On **Windows**, the equivalent is a `.bat` batch script that uses `schtasks` or a Rust binary wrapping `win32-service`.

---

## Version Compatibility Matrix

| Component         | Minimum Version | Tested Version |
| ----------------- | --------------- | -------------- |
| Tauri CLI         | 2.x             | 2.0.x          |
| Tauri (Rust)      | 2.x             | 2.0.x          |
| Node.js (server)  | 18.x            | 20.x LTS       |
| Rust (toolchain)  | 1.70+           | 1.75+          |
| pnpm              | 8.x             | 10.x           |
| Vite              | 5.x             | 8.x            |
| Solid.js          | 1.9.x           | 1.9.x          |
| `@tauri-apps/api` | 2.x             | 2.0.x          |
| `keyring` (Rust)  | 3.x             | 3.0.x          |
| `tokio`           | 1.x             | 1.x            |

---

## Lock File Strategy

- **Rust:** `apps/desktop/src-tauri/Cargo.lock` is committed. All Rust versions are pinned.
- **Node:** `pnpm-lock.yaml` in root workspace pins all Node dependencies. `apps/desktop/package.json` references workspace packages (`@openaidy/*`) which inherit from the root lock file.
- **System packages:** Documented in the README for users who need to install them manually.
