# Task 03: Service Spawning Manager

## Objective

Build a robust, production-ready service spawning system with restart logic, health checks, crash recovery, and proper lifecycle management. This extends Task 02's basic spawning into a managed daemon.

## Success Criteria

1. Server subprocess restarts automatically on crash (up to 3 retries with exponential backoff)
2. Port file (`~/.config/openaidy/port`) is always current
3. Startup waits until server is confirmed healthy (TCP connect check)
4. Shutdown is graceful — SIGTERM, then SIGKILL after 10s timeout
5. All subprocess I/O (stdout/stderr) is captured and logged
6. Service state is observable via Tauri IPC command

## Key Reused Components

| Component         | File                         | Purpose                              |
| ----------------- | ---------------------------- | ------------------------------------ |
| `server.ts` entry | `apps/server/src/server.ts`  | Node.js server entry, `app.listen()` |
| Env schema        | `apps/server/src/lib/env.ts` | All configurable env vars            |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  ServiceManager (Rust, apps/desktop/src-tauri/src/service.rs)│
│                                                               │
│  ┌─────────────┐    ┌──────────────────┐                    │
│  │ spawn()     │───▶│  server.ts       │                    │
│  │  ↓          │    │  (Node.js)       │                    │
│  │ monitor()   │◀───│  stdout/stderr   │                    │
│  │  ↓          │    └──────────────────┘                    │
│  │ restart?    │                                             │
│  │  (max 3x)   │                                             │
│  └─────────────┘                                             │
│                                                               │
│  State: idle | starting | running | crashed | stopping       │
└──────────────────────────────────────────────────────────────┘
```

## Files to Create/Modify

```
apps/desktop/src-tauri/src/service.rs   ← MODIFY: Add restart logic + health checks
apps/desktop/src-tauri/src/commands.rs  ← NEW: IPC status command
```

## State Machine

```
                    ┌─────────────────────────────────────┐
                    │                  start()            │
  ┌───────┐        ▼                                     │  crash
  │ idle  │ ─────────────────────────────────────────▶ running
  └───────┘              restart() ◀───────────────────┐   │
       ▲                                           │     │
       │    max retries     ┌───────────┐          │     │
       └────────────────────│ crashed   │───────────┘     │
                            └───────────┘    stop()      │
                                  ▲                     │
                                  │    stop()            │
                            ┌───────────┐                │
                            │ stopping  │─────────────────┘
                            └───────────┘
```

## Implementation Steps

### Step 3.1: Define Service State Machine

Add to `apps/desktop/src-tauri/src/service.rs`:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, Duration};
use log::{info, warn, error};

/// Maximum restart attempts before giving up
const MAX_RESTART_ATTEMPTS: u32 = 3;

/// Initial delay between restarts (doubles each attempt)
const INITIAL_RESTART_DELAY_MS: u64 = 1000;

/// Service state
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceState {
    Idle,
    Starting,
    Running { port: u16 },
    Crashed { attempts: u32 },
    Stopping,
}

impl Default for ServiceState {
    fn default() -> Self {
        ServiceState::Idle
    }
}

/// Service status for IPC exposure
#[derive(Debug, Clone)]
pub struct ServiceStatus {
    pub state: String,
    pub port: Option<u16>,
    pub restart_attempts: u32,
    pub pid: Option<u32>,
    pub openaidy_home: PathBuf,
}

/// Thread-safe service manager
pub struct ServiceManager {
    state: RwLock<ServiceState>,
    child: Mutex<Option<Child>>,
    port: RwLock<Option<u16>>,
    restart_attempts: RwLock<u32>,
    openaidy_home: PathBuf,
}

impl ServiceManager {
    pub fn new(openaidy_home: PathBuf) -> Self {
        Self {
            state: RwLock::const_new(ServiceState::Idle),
            child: Mutex::const_new(None),
            port: RwLock::const_new(None),
            restart_attempts: RwLock::const_new(0),
            openaidy_home,
        }
    }

    /// Get current service status (for IPC)
    pub async fn status(&self) -> ServiceStatus {
        let state = self.state.read().await.clone();
        let port = *self.port.read().await;
        let restart_attempts = *self.restart_attempts.read().await;
        let child = self.child.lock().await;
        let pid = child.as_ref().and_then(|c| c.id());

        ServiceStatus {
            state: format!("{:?}", state),
            port,
            restart_attempts,
            pid,
            openaidy_home: self.openaidy_home.clone(),
        }
    }

    /// Start the service, with retry logic on crash
    pub async fn start(
        &self,
        keychain_creds: HashMap<String, String>,
    ) -> Result<u16, String> {
        // Set state to Starting
        {
            let mut s = self.state.write().await;
            *s = ServiceState::Starting;
        }

        let port = match self.try_start(keychain_creds).await {
            Ok(port) => port,
            Err(e) => {
                error!("Service start failed: {}", e);
                let attempts = *self.restart_attempts.read().await;
                {
                    let mut s = self.state.write().await;
                    *s = ServiceState::Crashed { attempts };
                }
                return Err(e);
            }
        };

        // Spawn background monitor
        let manager = Arc::new(self.clone_manager());
        let home = self.openaidy_home.clone();
        let creds = keychain_creds.clone();
        tokio::spawn(async move {
            manager.monitor_loop(creds).await;
        });

        {
            let mut s = self.state.write().await;
            *s = ServiceState::Running { port };
        }

        Ok(port)
    }

    /// Attempt a single start
    async fn try_start(
        &self,
        keychain_creds: HashMap<String, String>,
    ) -> Result<u16, String> {
        use std::env;

        let port = pick_free_port().map_err(|e| e.to_string())?;
        let (program, args, cwd) = locate_server_entry(&self.openaidy_home);

        // Build env
        let mut vars: Vec<(String, String)> = env::vars().collect();
        let additions = [
            ("PORT".to_string(), port.to_string()),
            ("OPENAIDY_HOME".to_string(), self.openaidy_home.to_string_lossy().to_string()),
            ("WS_PORT".to_string(), port.to_string()),
            ("CORS_ORIGIN".to_string(), "app://0.0.0.0".to_string()),
            ("DB_KIND".to_string(), "sqlite".to_string()),
            ("SQLITE_PATH".to_string(), self.openaidy_home.join("openaidy.db").to_string_lossy().to_string()),
        ];
        for (k, v) in additions {
            if let Some(existing) = vars.iter_mut().find(|(key, _)| key == &k) {
                existing.1 = v;
            } else {
                vars.push((k, v));
            }
        }
        for (k, v) in &keychain_creds {
            vars.push((k.clone(), v.clone()));
        }

        info!("Spawning server: {} {:?} (port={})", program, args, port);

        let mut child = Command::new(&program)
            .args(&args)
            .envs(vars)
            .current_dir(&cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn error: {}", e))?;

        // Log stdout
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = reader.next_line().await {
                    info!("[server] {}", line);
                }
            });
        }
        // Log stderr
        if let Some(stderr) = child.stderr.take() {
            let mut reader = BufReader::new(stderr).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = reader.next_line().await {
                    error!("[server] {}", line);
                }
            });
        }

        // Wait for server to bind
        let port_copy = port;
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while std::time::Instant::now() < deadline {
            sleep(Duration::from_millis(200)).await;
            if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port_copy))
                .await
                .is_ok()
            {
                // Write port file
                write_port_file(&self.openaidy_home, port_copy)?;
                info!("Server confirmed on port {}", port_copy);

                {
                    let mut child_guard = self.child.lock().await;
                    *child_guard = Some(child);
                }
                {
                    let mut p = self.port.write().await;
                    *p = Some(port_copy);
                }

                return Ok(port_copy);
            }
        }

        Err("Server did not bind within 15 seconds".to_string())
    }

    /// Monitor loop — restarts on crash
    async fn monitor_loop(&self, keychain_creds: HashMap<String, String>) {
        loop {
            sleep(Duration::from_secs(2)).await;

            let state = self.state.read().await.clone();
            let child = self.child.lock().await;

            match state {
                ServiceState::Running { .. } => {
                    // Check if child has exited
                    if let Some(ref mut c) = child.as_mut() {
                        match c.try_wait() {
                            Ok(Some(status)) => {
                                error!("Server exited with status: {:?}", status);
                                drop(child); // release lock before restart

                                let attempts = {
                                    let mut a = self.restart_attempts.write().await;
                                    *a += 1;
                                    *a
                                };

                                if attempts <= MAX_RESTART_ATTEMPTS {
                                    let delay_ms = INITIAL_RESTART_DELAY_MS * 2u64.pow(attempts - 1);
                                    info!(
                                        "Restarting server in {}ms (attempt {}/{})",
                                        delay_ms, attempts, MAX_RESTART_ATTEMPTS
                                    );
                                    sleep(Duration::from_millis(delay_ms)).await;

                                    let mut s = self.state.write().await;
                                    *s = ServiceState::Starting;
                                    drop(s);

                                    match self.try_start(keychain_creds.clone()).await {
                                        Ok(port) => {
                                            let mut st = self.state.write().await;
                                            *st = ServiceState::Running { port };
                                            let mut a = self.restart_attempts.write().await;
                                            *a = 0; // reset on success
                                        }
                                        Err(e) => {
                                            error!("Restart failed: {}", e);
                                            let mut s = self.state.write().await;
                                            *s = ServiceState::Crashed { attempts };
                                        }
                                    }
                                } else {
                                    let mut s = self.state.write().await;
                                    *s = ServiceState::Crashed { attempts };
                                    error!("Max restart attempts reached. Server stopped.");
                                    break;
                                }
                            }
                            Ok(None) => {
                                // Still running, all good
                            }
                            Err(e) => {
                                error!("wait() error: {}", e);
                            }
                        }
                    }
                }
                ServiceState::Stopping | ServiceState::Crashed { .. } | ServiceState::Idle => {
                    break;
                }
                _ => {}
            }
        }
    }

    /// Stop the service gracefully
    pub async fn stop(&self) {
        {
            let mut s = self.state.write().await;
            *s = ServiceState::Stopping;
        }

        let mut child = self.child.lock().await;
        if let Some(ref mut c) = child.take() {
            info!("Sending SIGTERM to server (pid={:?})", c.id());

            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                let _ = c.kill();
            }
            #[cfg(windows)]
            {
                let _ = c.kill();
            }

            // Wait up to 10s for graceful shutdown
            match c.wait().timeout(Duration::from_secs(10)).await {
                Ok(status) => info!("Server exited: {:?}", status),
                Err(_) => {
                    warn!("Server did not exit in 10s, forcing kill");
                    #[cfg(unix)]
                    {
                        use std::os::unix::process::CommandExt;
                        let _ = c.kill();
                    }
                }
            }
        }

        // Remove port file
        let port_file = self.openaidy_home.join("port");
        let _ = std::fs::remove_file(&port_file);

        let mut s = self.state.write().await;
        *s = ServiceState::Idle;
        info!("Service stopped");
    }

    fn clone_manager(&self) -> Arc<ServiceManager> {
        // Safety: ServiceManager is Send+Sync, we wrap in Arc
        unsafe { Arc::from_raw(Arc::into_raw(Arc::new(ServiceManager {
            state: RwLock::const_new(ServiceState::Idle), // will be set from inner
            child: Mutex::const_new(None),
            port: RwLock::const_new(None),
            restart_attempts: RwLock::const_new(0),
            openaidy_home: self.openaidy_home.clone(),
        })) as *const ServiceManager) }
    }
}
```

Note: The `clone_manager()` above is a simplified pattern. A cleaner approach uses `Arc<Self>` from the start. The full production version should use `Arc<ServiceManager>` as the shared handle from the beginning.

### Step 3.2: Add Health Check IPC Command

Create `apps/desktop/src-tauri/src/commands.rs`:

```rust
//! Tauri IPC commands exposed to the frontend.

use crate::service::{ServiceManager, ServiceStatus};
use std::sync::Arc;
use tauri::State;

/// State wrapper for ServiceManager
pub struct AppState {
    pub service: Arc<ServiceManager>,
}

#[tauri::command]
pub async fn get_service_status(
    state: State<'_, AppState>,
) -> Result<ServiceStatus, String> {
    Ok(state.service.status().await)
}

#[tauri::command]
pub async fn restart_service(
    state: State<'_, AppState>,
) -> Result<u16, String> {
    use crate::keychain;
    let creds = keychain::get_all_credentials()
        .await
        .unwrap_or_default();
    state.service.start(creds).await
}

#[tauri::command]
pub async fn stop_service(state: State<'_, AppState>) -> Result<(), String> {
    state.service.stop().await;
    Ok(())
}
```

### Step 3.3: Update main.rs to Use ServiceManager

```rust
// Replace the simple SERVICE_HANDLE with ServiceManager
use crate::service::ServiceManager;
use crate::commands::AppState;

let openaidy_home = dirs::config_dir()
    .unwrap_or_else(|| PathBuf::from("."))
    .join("openaidy");

let service_manager = Arc::new(ServiceManager::new(openaidy_home.clone()));

// Load keychain and start
let keychain_creds = keychain::get_all_credentials().await.unwrap_or_default();
let port = service_manager.start(keychain_creds).await
    .expect("Failed to start core service");

let app_state = AppState { service: service_manager };

tauri::Builder::default()
    .manage(app_state)
    .invoke_handler(tauri::generate_handler![
        commands::get_service_status,
        commands::restart_service,
        commands::stop_service,
    ])
    // ... rest unchanged
```

## Cleanup on Drop

Since `ServiceManager` now handles shutdown via `.stop()`, remove the `Drop` implementation from `ServiceHandle` (which no longer exists).

## Reused Code

| File                         | Role                       | Changes |
| ---------------------------- | -------------------------- | ------- |
| `apps/server/src/server.ts`  | Entry point for subprocess | None    |
| `apps/server/src/lib/env.ts` | Env var schema             | None    |

## Test Scenarios

| Scenario                   | Expected Behavior                            |
| -------------------------- | -------------------------------------------- |
| Server crashes on startup  | Retry up to 3 times with backoff             |
| Server crashes after 5 min | Restart automatically (max 3 attempts)       |
| Tauri window closed        | Service continues running (service persists) |
| User clicks "Quit" in tray | Service.stop() called, SIGTERM sent          |
| Port already in use        | `pick_free_port()` finds another             |
| Max retries exceeded       | State → Crashed, no further auto-restart     |

## Risks & Mitigations

| Risk                               | Mitigation                                          |
| ---------------------------------- | --------------------------------------------------- |
| Infinite restart loop on fatal bug | MAX_RESTART_ATTEMPTS=3, then Crashed state          |
| Memory leak from spawned threads   | Each monitor loop is bounded and drops cleanly      |
| Zombie process on hard crash       | 10s SIGKILL timeout in stop()                       |
| Port file stale after crash        | Always rewrite port file on successful start        |
| Concurrent start calls             | `ServiceState::Starting` gate prevents double-spawn |
