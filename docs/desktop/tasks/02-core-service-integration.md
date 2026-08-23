# Task 02: Core Service Integration

## Objective

Wire `apps/server` into the Tauri app so the Solid.js WebView talks to the existing OpenAidy core service. The core runs as a Node.js subprocess spawned by Tauri, and the WebView proxies all requests to it.

## Success Criteria

1. Tauri spawns `apps/server` as a subprocess on a dynamically allocated port
2. The port is written to `~/.config/openaidy/port` so all components can find it
3. The WebView loads the Solid.js SPA which connects to `http://127.0.0.1:<port>`
4. The core service receives and handles API requests correctly
5. Graceful shutdown: closing the Tauri window sends SIGTERM to the server subprocess

## Key Reused Components

| Component          | File                         | Purpose                                                       |
| ------------------ | ---------------------------- | ------------------------------------------------------------- |
| Server entry point | `apps/server/src/server.ts`  | `buildApp()` + `app.listen({ host, port })`                   |
| Env schema         | `apps/server/src/lib/env.ts` | `PORT`, `OPENAIDY_HOME`, `DB_KIND`, `CORS_ORIGIN`             |
| App builder        | `apps/server/src/app.ts`     | Full Fastify app wiring (providers, agents, sessions, addons) |

## Files to Create/Modify

```
apps/desktop/src-tauri/src/service.rs     ← NEW: Core service lifecycle
apps/desktop/src-tauri/src/main.rs        ← MODIFY: call service::start()
```

## Implementation Steps

### Step 2.1: Create service.rs — Core Service Lifecycle Manager

Create `apps/desktop/src-tauri/src/service.rs`:

```rust
//! Core service lifecycle manager.
//!
//! Spawns `apps/server` as a managed subprocess, writes the assigned port to
//! OPENAIDY_HOME/port, and handles graceful shutdown.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use log::{info, warn, error};

/// Global service state
static SERVICE_HANDLE: Mutex<Option<ServiceHandle>> = Mutex::const_new(Mutex::const_new(None));

pub struct ServiceHandle {
    child: Child,
    port: u16,
    openaidy_home: PathBuf,
}

impl Drop for ServiceHandle {
    fn drop(&mut self) {
        info!("ServiceHandle dropping — sending SIGTERM to server");
        // Use kill() on Unix or terminate() on Windows via tokio
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let _ = self.child.process().kill();
        }
        #[cfg(windows)]
        {
            let _ = self.child.kill();
        }
    }
}

/// Locate the built server entry point.
/// In dev mode: ../../apps/server/src/server.ts  (tsx runs it)
/// In prod mode: ../../apps/server/dist/index.js  (node runs it)
fn locate_server_entry(openaidy_home: &PathBuf) -> (String, Vec<String>, PathBuf) {
    let workspace_root = openaidy_home
        .parent()  // .openaidy
        .and_then(|p| p.parent())  // ~  (home)
        .unwrap_or(openaidy_home);

    // Try dev entry first
    let dev_entry = workspace_root
        .join("apps")
        .join("server")
        .join("src")
        .join("server.ts");

    let prod_entry = workspace_root
        .join("apps")
        .join("server")
        .join("dist")
        .join("index.js");

    if prod_entry.exists() {
        // Production: run compiled JS with Node
        (
            "node".to_string(),
            vec![prod_entry.to_string_lossy().to_string()],
            workspace_root.to_path_buf(),
        )
    } else if dev_entry.exists() {
        // Development: run TypeScript source with tsx
        (
            "tsx".to_string(),
            vec![dev_entry.to_string_lossy().to_string()],
            workspace_root.to_path_buf(),
        )
    } else {
        error!(
            "Cannot find server entry. Tried:\n  dev:  {:?}\n  prod: {:?}",
            dev_entry, prod_entry
        );
        panic!("Server entry not found");
    }
}

/// Find a free port on the system.
fn pick_free_port() -> std::io::Result<u16> {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;
    Ok(addr.port())
}

/// Build the env vars passed to the server subprocess.
/// Reads existing env and supplements with keychain credentials + computed values.
fn build_server_env(
    port: u16,
    openaidy_home: &PathBuf,
    keychain_creds: &std::collections::HashMap<String, String>,
) -> Vec<(String, String)> {
    use std::env;

    let mut vars: Vec<(String, String)> = env::vars().collect();

    // Override/add OpenAidy-specific vars
    let additions = [
        ("PORT".to_string(), port.to_string()),
        ("OPENAIDY_HOME".to_string(), openaidy_home.to_string_lossy().to_string()),
        ("WS_PORT".to_string(), port.to_string()),
        ("CORS_ORIGIN".to_string(), "app://0.0.0.0".to_string()),
        ("DB_KIND".to_string(), "sqlite".to_string()),
        ("SQLITE_PATH".to_string(), openaidy_home.join("openaidy.db").to_string_lossy().to_string()),
    ];

    for (k, v) in additions {
        // Replace if exists, push if not
        if let Some(existing) = vars.iter_mut().find(|(key, _)| key == &k) {
            existing.1 = v;
        } else {
            vars.push((k, v));
        }
    }

    // Inject keychain credentials as env vars (API keys etc.)
    for (key, value) in keychain_creds {
        vars.push((key.clone(), value.clone()));
    }

    vars
}

/// Write the port file so the frontend IPC bridge and other components can find it.
fn write_port_file(openaidy_home: &PathBuf, port: u16) -> std::io::Result<()> {
    std::fs::create_dir_all(openaidy_home)?;
    let port_file = openaidy_home.join("port");
    std::fs::write(port_file, port.to_string())?;
    info!("Wrote port file: {:?} = {}", port_file, port);
    Ok(())
}

/// Read the port file to reconnect to an already-running server.
fn read_port_file(openaidy_home: &PathBuf) -> Option<u16> {
    let port_file = openaidy_home.join("port");
    let content = std::fs::read_to_string(port_file).ok()?;
    content.trim().parse().ok()
}

/// Start the core service subprocess.
pub async fn start_service(
    openaidy_home: PathBuf,
    keychain_creds: std::collections::HashMap<String, String>,
) -> Result<ServiceHandle, String> {
    // Check if already running
    if let Some(port) = read_port_file(&openaidy_home) {
        info!("Server already running on port {}", port);
        // Try to connect to verify it's alive
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)).await.is_ok() {
            return Ok(ServiceHandle {
                child: unsafe { std::process::Command::new("echo").spawn().unwrap() }, // placeholder
                port,
                openaidy_home,
            });
        }
    }

    let port = pick_free_port().map_err(|e| e.to_string())?;
    let (program, args, cwd) = locate_server_entry(&openaidy_home);
    let env_vars = build_server_env(port, &openaidy_home, &keychain_creds);

    info!("Spawning server: {} {:?} (port={}, cwd={:?})", program, args, port, cwd);

    let mut child = Command::new(&program)
        .args(&args)
        .envs(env_vars)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn server: {}", e))?;

    // Log stdout/stderr in background
    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout).lines();
        let op_name = program.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                info!("[{}] {}", op_name, line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                error!("[server stderr] {}", line);
            }
        });
    }

    // Wait briefly for server to bind to port
    let bound_port = Arc::new(Mutex::new(None));
    let bound_port_clone = bound_port.clone();
    let port_copy = port;

    tokio::spawn(async move {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port_copy))
                .await
                .is_ok()
            {
                *bound_port_clone.lock().await = Some(port_copy);
                info!("Server confirmed listening on port {}", port_copy);
                return;
            }
        }
        error!("Server failed to bind within 10 seconds");
    });

    write_port_file(&openaidy_home, port)?;

    Ok(ServiceHandle {
        child,
        port,
        openaidy_home,
    })
}

/// Stop the running service.
pub async fn stop_service() {
    let mut handle = SERVICE_HANDLE.lock().await;
    if let Some(service) = handle.take() {
        info!("Stopping core service (port {})", service.port);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let _ = service.child.kill();
        }
        #[cfg(windows)]
        {
            let _ = service.child.kill();
        }
    }
}

/// Get the current service port.
pub async fn get_service_port() -> Option<u16> {
    let handle = SERVICE_HANDLE.lock().await;
    handle.as_ref().map(|h| h.port)
}
```

### Step 2.2: Modify main.rs to Start Service on Setup

Update `apps/desktop/src-tauri/src/main.rs` to call the service manager:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod service;
mod keychain;
mod tray;
mod commands;

use log::{error, info};
use std::sync::Arc;
use tauri::Manager;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    info!("OpenAidy Desktop v{}", env!("CARGO_PKG_VERSION"));

    // Determine OPENAIDY_HOME
    let openaidy_home = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("openaidy");

    // Load credentials from keychain
    let keychain_creds = keychain::get_all_credentials().await.unwrap_or_default();

    // Start the core service
    let service_handle = service::start_service(openaidy_home.clone(), keychain_creds)
        .await
        .expect("Failed to start core service");

    let port = service_handle.port;
    info!("Core service started on port {}", port);

    // Store service handle in app state
    let app_handle = Arc::new(service_handle);

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_handle.clone())
        .setup(move |app| {
            info!("Tauri setup complete; core service on port {}", port);
            // The WebView in dev mode connects to localhost:5173 (Vite)
            // In prod mode, Tauri serves the built dist/
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("Tauri error: {}", e);
    }

    // Shutdown service on app exit
    service::stop_service().await;
}
```

### Step 2.3: Update keychain.rs to Load All Credentials

The `keychain::get_all_credentials()` function called above doesn't exist yet. Add it to `keychain.rs` (created in Task 04, but stub it here):

```rust
// Placeholder — full implementation in Task 04
pub async fn get_all_credentials() -> Result<std::collections::HashMap<String, String>, String> {
    Ok(std::collections::HashMap::new())
}
```

### Step 2.4: Verify Dev Mode

In dev mode (`tauri dev`), the WebView opens `http://localhost:5173`. The Vite dev server for `apps/web` must be running separately.

```bash
# Terminal 1: Start web dev server
cd /tmp/openaidy/apps/web && pnpm dev
# → Vite dev server at http://localhost:5173

# Terminal 2: Start Tauri
cd /tmp/openaidy/apps/desktop && pnpm tauri dev
# → Tauri window opens, WebView loads localhost:5173
# → Core service spawns on some port (e.g., 34567)
# → Frontend at :5173 makes API calls to :34567
```

### Step 2.5: Verify Prod Mode

In production build, Tauri bundles the Solid.js dist (not the Vite dev server):

1. `pnpm build` in `apps/web` produces `dist/`
2. Tauri bundles `apps/web/dist` as `frontendDist` in `tauri.conf.json`
3. The WebView loads `app://...` (local protocol) pointing to the bundled files
4. The bundled JS connects to `http://127.0.0.1:<port>` where the spawned server listens

## Reused Code Reference

The following are used **as-is** — no modifications:

```typescript
// apps/server/src/server.ts — unchanged
const app = await buildApp();
await app.listen({ host: env.HOST, port: env.PORT });

// apps/server/src/lib/env.ts — respected env vars
(PORT, CORS_ORIGIN, OPENAIDY_HOME, DB_KIND, SQLITE_PATH, DATABASE_URL);

// apps/server/src/app.ts — full app wiring
// createProviderServices, createAgentRegistry, SessionMessageService, etc.
```

## Environment Variables Passed

| Variable        | Value                            | Source                     |
| --------------- | -------------------------------- | -------------------------- |
| `PORT`          | Dynamic (e.g. `34567`)           | Tauri `service.rs`         |
| `OPENAIDY_HOME` | `~/.config/openaidy`             | Tauri `main.rs`            |
| `WS_PORT`       | Same as PORT                     | Tauri `service.rs`         |
| `CORS_ORIGIN`   | `app://0.0.0.0`                  | Tauri `service.rs`         |
| `DB_KIND`       | `sqlite`                         | Tauri `service.rs` default |
| `SQLITE_PATH`   | `~/.config/openaidy/openaidy.db` | Tauri `service.rs`         |
| `API keys`      | From keychain                    | Tauri `keychain.rs` → env  |

## Verification Commands

```bash
# Start only the core service (without Tauri UI) to test
cd /tmp/openaidy/apps/server && \
  OPENAIDY_HOME=$HOME/.config/openaidy \
  PORT=0 \
  DB_KIND=sqlite \
  SQLITE_PATH=$HOME/.config/openaidy/openaidy.db \
  pnpm dev

# Should output something like:
# Server listening at http://0.0.0.0:34567
```

## Risks & Mitigations

| Risk                             | Mitigation                                         |
| -------------------------------- | -------------------------------------------------- |
| Server takes too long to bind    | Poll with exponential backoff for up to 10s        |
| Port conflict                    | Use `portpicker` crate to find truly free port     |
| Server crash on startup          | Log stderr output streamed to Tauri logs           |
| Dev vs prod entry paths differ   | `locate_server_entry()` checks both paths          |
| Orphaned server process on crash | `ServiceHandle::drop()` sends SIGTERM via `kill()` |
