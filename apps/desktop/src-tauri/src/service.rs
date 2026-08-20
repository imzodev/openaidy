//! Core service lifecycle manager.
//!
//! Spawns `apps/server` as a managed subprocess, writes the assigned port to
//! OPENAIDY_HOME/port, and handles graceful shutdown.

use log::{error, info};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, timeout, Duration};

/// The origin the embedded WebView actually sends as its `Origin` header,
/// per platform — Tauri v2 serves the frontend from this pseudo-origin, not
/// a real http(s) origin the CORS-origin config could otherwise share with
/// the browser dev server. A single build only ever targets one OS, so a
/// `cfg`-selected literal is sufficient without loosening apps/server's CORS
/// policy itself.
fn tauri_webview_origin() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "tauri://localhost"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "http://tauri.localhost"
    }
}

/// Maximum restart attempts before giving up
const MAX_RESTART_ATTEMPTS: u32 = 3;

/// Initial delay between restarts (doubles each attempt)
const INITIAL_RESTART_DELAY_MS: u64 = 1000;

/// Service state
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ServiceState {
    #[default]
    Idle,
    Starting,
    Running {
        port: u16,
    },
    Crashed {
        attempts: u32,
    },
    Stopping,
}

/// Service status for IPC exposure
#[derive(Debug, Clone, Serialize)]
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
            state: format!("{state:?}"),
            port,
            restart_attempts,
            pid,
            openaidy_home: self.openaidy_home.clone(),
        }
    }

    /// Start the service, with retry logic on crash
    pub async fn start(&self, keychain_creds: HashMap<String, String>) -> Result<u16, String> {
        // Set state to Starting
        {
            let mut s = self.state.write().await;
            *s = ServiceState::Starting;
        }

        let port = match self.try_start(keychain_creds.clone()).await {
            Ok(port) => port,
            Err(e) => {
                error!("Service start failed: {e}");
                let attempts = *self.restart_attempts.read().await;
                let mut s = self.state.write().await;
                *s = ServiceState::Crashed { attempts };
                return Err(e);
            }
        };

        // Spawn background monitor
        let manager = Arc::new(self.clone_manager());
        let creds = keychain_creds;
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
    async fn try_start(&self, keychain_creds: HashMap<String, String>) -> Result<u16, String> {
        use std::env;

        let port = pick_free_port().map_err(|e| e.to_string())?;
        let (program, args, cwd) = locate_server_entry(&self.openaidy_home);

        // Build env. Names must match what apps/server/src/lib/env.ts's zod
        // schema actually reads from process.env — it has no PORT/CORS_ORIGIN/
        // WS_PORT keys (those are internal aliases *derived* from the real
        // ones on the parsed config object, never consumed as env-var input),
        // so setting those instead of OPENAIDY_PORT/OPENAIDY_CORS_ORIGIN was a
        // silent no-op: the server always bound 3001 with the default
        // http://localhost:5173 CORS origin regardless of what we picked here.
        let mut vars: Vec<(String, String)> = env::vars().collect();
        let additions = [
            ("OPENAIDY_PORT".to_string(), port.to_string()),
            (
                "OPENAIDY_HOME".to_string(),
                self.openaidy_home.to_string_lossy().to_string(),
            ),
            (
                "OPENAIDY_CORS_ORIGIN".to_string(),
                tauri_webview_origin().to_string(),
            ),
            ("DB_KIND".to_string(), "sqlite".to_string()),
            (
                "SQLITE_PATH".to_string(),
                self.openaidy_home
                    .join("openaidy.db")
                    .to_string_lossy()
                    .to_string(),
            ),
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

        info!("Spawning server: {program} {args:?} (port={port})");

        let mut child = Command::new(&program)
            .args(&args)
            .envs(vars)
            .current_dir(&cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn error: {e}"))?;

        // Log stdout
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = reader.next_line().await {
                    info!("[server] {line}");
                }
            });
        }
        // Log stderr
        if let Some(stderr) = child.stderr.take() {
            let mut reader = BufReader::new(stderr).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = reader.next_line().await {
                    error!("[server] {line}");
                }
            });
        }

        // Wait for server to bind
        let port_copy = port;
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while std::time::Instant::now() < deadline {
            sleep(Duration::from_millis(200)).await;
            if tokio::net::TcpStream::connect(format!("127.0.0.1:{port_copy}"))
                .await
                .is_ok()
            {
                // Write port file
                write_port_file(&self.openaidy_home, port_copy)
                    .map_err(|e| format!("write_port_file: {e}"))?;
                info!("Server confirmed on port {port_copy}");

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
            let mut child = self.child.lock().await;

            match state {
                ServiceState::Running { .. } => {
                    // Check if child has exited
                    if let Some(ref mut c) = child.as_mut() {
                        match c.try_wait() {
                            Ok(Some(status)) => {
                                error!("Server exited with status: {status:?}");
                                drop(child); // release lock before restart

                                let attempts = {
                                    let mut a = self.restart_attempts.write().await;
                                    *a += 1;
                                    *a
                                };

                                if attempts <= MAX_RESTART_ATTEMPTS {
                                    let delay_ms =
                                        INITIAL_RESTART_DELAY_MS * 2u64.pow(attempts - 1);
                                    info!(
                                        "Restarting server in {delay_ms}ms (attempt {attempts}/{MAX_RESTART_ATTEMPTS})"
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
                                            error!("Restart failed: {e}");
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
                                error!("wait() error: {e}");
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

            // SIGTERM via kill(), then wait up to 10s for graceful shutdown
            drop(c.kill());
            let result = timeout(Duration::from_secs(10), c.wait()).await;
            match result {
                Ok(Ok(status)) => info!("Server exited: {status:?}"),
                Ok(Err(e)) => error!("wait() error: {e}"),
                Err(_) => {
                    info!("Server did not exit in 10s, sending SIGKILL");
                    drop(c.kill());
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

    fn clone_manager(&self) -> ServiceManager {
        ServiceManager {
            state: RwLock::const_new(ServiceState::Idle),
            child: Mutex::const_new(None),
            port: RwLock::const_new(None),
            restart_attempts: RwLock::const_new(0),
            openaidy_home: self.openaidy_home.clone(),
        }
    }
}

// ============================================================================
// Legacy module-level helpers (retained for test compatibility)
// ============================================================================

/// Global service state
#[allow(dead_code)]
static SERVICE_HANDLE: Mutex<Option<ServiceHandle>> = Mutex::const_new(None);

pub struct ServiceHandle {
    child: Child,
    #[allow(dead_code)]
    pub port: u16,
    #[allow(dead_code)]
    openaidy_home: PathBuf,
}

impl Drop for ServiceHandle {
    fn drop(&mut self) {
        info!("ServiceHandle dropping — sending SIGTERM to server");
        #[cfg(unix)]
        {
            drop(self.child.kill());
        }
        #[cfg(windows)]
        {
            drop(self.child.kill());
        }
    }
}

/// Locate the built server entry point.
/// In dev mode: ../../apps/server/src/server.ts  (tsx runs it)
/// In prod mode: ../../apps/server/dist/index.js  (node runs it)
#[allow(dead_code)]
fn locate_server_entry(openaidy_home: &Path) -> (String, Vec<String>, PathBuf) {
    let workspace_root = openaidy_home
        .parent() // .openaidy
        .and_then(|p| p.parent()) // ~  (home)
        .unwrap_or(openaidy_home);

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
        (
            "node".to_string(),
            vec![prod_entry.to_string_lossy().to_string()],
            workspace_root.to_path_buf(),
        )
    } else if dev_entry.exists() {
        (
            "tsx".to_string(),
            vec![dev_entry.to_string_lossy().to_string()],
            workspace_root.to_path_buf(),
        )
    } else {
        error!("Cannot find server entry. Tried:\n  dev:  {dev_entry:?}\n  prod: {prod_entry:?}");
        panic!("Server entry not found");
    }
}

/// Find a free port on the system.
#[allow(dead_code)]
fn pick_free_port() -> std::io::Result<u16> {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let addr = listener.local_addr()?;
    Ok(addr.port())
}

/// Build the env vars passed to the server subprocess.
#[allow(dead_code)]
fn build_server_env(
    port: u16,
    openaidy_home: &Path,
    keychain_creds: &HashMap<String, String>,
) -> Vec<(String, String)> {
    use std::env;

    let mut vars: Vec<(String, String)> = env::vars().collect();

    let additions = [
        ("PORT".to_string(), port.to_string()),
        (
            "OPENAIDY_HOME".to_string(),
            openaidy_home.to_string_lossy().to_string(),
        ),
        ("WS_PORT".to_string(), port.to_string()),
        ("CORS_ORIGIN".to_string(), "app://0.0.0.0".to_string()),
        ("DB_KIND".to_string(), "sqlite".to_string()),
        (
            "SQLITE_PATH".to_string(),
            openaidy_home
                .join("openaidy.db")
                .to_string_lossy()
                .to_string(),
        ),
    ];

    for (k, v) in additions {
        if let Some(existing) = vars.iter_mut().find(|(key, _)| key == &k) {
            existing.1 = v;
        } else {
            vars.push((k, v));
        }
    }

    for (key, value) in keychain_creds {
        vars.push((key.clone(), value.clone()));
    }

    vars
}

/// Write the port file so the frontend IPC bridge can find it.
#[allow(dead_code)]
fn write_port_file(openaidy_home: &Path, port: u16) -> std::io::Result<()> {
    std::fs::create_dir_all(openaidy_home)?;
    let port_file = openaidy_home.join("port");
    std::fs::write(&port_file, port.to_string())?;
    info!("Wrote port file: {port_file:?} = {port}");
    Ok(())
}

/// Read the port file to reconnect to an already-running server.
#[allow(dead_code)]
fn read_port_file(openaidy_home: &Path) -> Option<u16> {
    let port_file = openaidy_home.join("port");
    let content = std::fs::read_to_string(port_file).ok()?;
    content.trim().parse().ok()
}

/// Start the core service subprocess.
#[allow(dead_code)]
pub async fn start_service(
    openaidy_home: PathBuf,
    keychain_creds: HashMap<String, String>,
) -> Result<ServiceHandle, String> {
    if let Some(port) = read_port_file(&openaidy_home) {
        info!("Server already running on port {port}");
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
            .await
            .is_ok()
        {
            let placeholder = Command::new("echo")
                .arg("placeholder")
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(ServiceHandle {
                child: placeholder,
                port,
                openaidy_home,
            });
        }
    }

    let port = pick_free_port().map_err(|e| e.to_string())?;
    let (program, args, cwd) = locate_server_entry(&openaidy_home);
    let env_vars = build_server_env(port, &openaidy_home, &keychain_creds);

    info!("Spawning server: {program} {args:?} (port={port}, cwd={cwd:?})");

    let mut child = Command::new(&program)
        .args(&args)
        .envs(env_vars)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn server: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout).lines();
        let op_name = program.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                info!("[{op_name}] {line}");
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                error!("[server stderr] {line}");
            }
        });
    }

    let bound_port = Arc::new(Mutex::new(None));
    let bound_port_clone = bound_port.clone();
    let port_copy = port;

    tokio::spawn(async move {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline {
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            if tokio::net::TcpStream::connect(format!("127.0.0.1:{port_copy}"))
                .await
                .is_ok()
            {
                *bound_port_clone.lock().await = Some(port_copy);
                info!("Server confirmed listening on port {port_copy}");
                return;
            }
        }
        error!("Server failed to bind within 10 seconds");
    });

    write_port_file(&openaidy_home, port).map_err(|e| e.to_string())?;

    Ok(ServiceHandle {
        child,
        port,
        openaidy_home,
    })
}

/// Stop the running service.
#[allow(dead_code)]
pub async fn stop_service() {
    let mut handle = SERVICE_HANDLE.lock().await;
    if let Some(mut service) = handle.take() {
        info!("Stopping core service (port {port})", port = service.port);
        #[cfg(unix)]
        {
            drop(service.child.kill());
        }
        #[cfg(windows)]
        {
            drop(service.child.kill());
        }
    }
}

/// Get the current service port.
#[allow(dead_code)]
pub async fn get_service_port() -> Option<u16> {
    let handle = SERVICE_HANDLE.lock().await;
    handle.as_ref().map(|h| h.port)
}

// ============================================================================
// TDD Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ----------------------------------------------------------------
    // ServiceState tests
    // ----------------------------------------------------------------

    #[test]
    fn test_service_state_default_is_idle() {
        assert_eq!(ServiceState::Idle, ServiceState::default());
    }

    #[test]
    fn test_service_state_running_contains_port() {
        let state = ServiceState::Running { port: 3000 };
        match state {
            ServiceState::Running { port } => assert_eq!(port, 3000),
            _ => panic!("expected Running state"),
        }
    }

    #[test]
    fn test_service_state_crashed_contains_attempts() {
        let state = ServiceState::Crashed { attempts: 3 };
        match state {
            ServiceState::Crashed { attempts } => assert_eq!(attempts, 3),
            _ => panic!("expected Crashed state"),
        }
    }

    // ----------------------------------------------------------------
    // ServiceStatus tests
    // ----------------------------------------------------------------

    #[test]
    fn test_service_status_debug_clone() {
        let status = ServiceStatus {
            state: "Idle".to_string(),
            port: None,
            restart_attempts: 0,
            pid: None,
            openaidy_home: PathBuf::from("/tmp"),
        };
        let _ = format!("{status:?}");
    }

    // ----------------------------------------------------------------
    // ServiceManager basic tests
    // ----------------------------------------------------------------

    #[test]
    fn test_service_manager_new_sets_idle_state() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let manager = ServiceManager::new(temp_dir.path().to_path_buf());
        let status = futures::executor::block_on(manager.status());
        assert_eq!(status.state, "Idle");
    }

    #[test]
    fn test_service_manager_status_returns_home_dir() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let manager = ServiceManager::new(temp_dir.path().to_path_buf());
        let status = futures::executor::block_on(manager.status());
        assert_eq!(status.openaidy_home, temp_dir.path());
    }

    #[test]
    fn test_service_manager_status_returns_zero_restart_attempts_on_init() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let manager = ServiceManager::new(temp_dir.path().to_path_buf());
        let status = futures::executor::block_on(manager.status());
        assert_eq!(status.restart_attempts, 0);
    }

    // ----------------------------------------------------------------
    // Restart/backoff constants
    // ----------------------------------------------------------------

    #[test]
    fn test_max_restart_attempts_is_3() {
        assert_eq!(MAX_RESTART_ATTEMPTS, 3);
    }

    #[test]
    fn test_initial_restart_delay_is_1000ms() {
        assert_eq!(INITIAL_RESTART_DELAY_MS, 1000);
    }

    // ----------------------------------------------------------------
    // write_port_file / read_port_file
    // ----------------------------------------------------------------

    #[test]
    fn test_write_and_read_port_file() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let port: u16 = 54321;

        write_port_file(temp_dir.path(), port).expect("write should succeed");

        let read_port = read_port_file(temp_dir.path()).expect("read should succeed");
        assert_eq!(read_port, port, "read port should match written port");
    }

    #[test]
    fn test_read_port_file_returns_none_for_missing_file() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let result = read_port_file(temp_dir.path());
        assert!(result.is_none(), "should return None for missing port file");
    }

    #[test]
    fn test_write_port_file_creates_directory() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let nested_dir = temp_dir.path().join("openaidy").join("subdir");
        let port: u16 = 12345;

        write_port_file(&nested_dir, port).expect("write should succeed");

        let port_file_content =
            fs::read_to_string(nested_dir.join("port")).expect("should read port file");
        assert_eq!(port_file_content.trim(), "12345");
    }

    // ----------------------------------------------------------------
    // pick_free_port
    // ----------------------------------------------------------------

    #[test]
    fn test_pick_free_port_returns_valid_port() {
        let port = pick_free_port().expect("should return a valid port");
        assert!(port > 0, "port should be non-zero");
        assert!(port <= 65535, "port should be valid");
    }

    #[test]
    fn test_pick_free_port_returns_different_ports() {
        let port1 = pick_free_port().expect("should return a valid port");
        let port2 = pick_free_port().expect("should return a valid port");
        assert!(port1 > 0 && port2 > 0);
    }

    // ----------------------------------------------------------------
    // build_server_env
    // ----------------------------------------------------------------

    #[test]
    fn test_build_server_env_includes_openaidy_vars() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let port: u16 = 12345;
        let keychain_creds = HashMap::new();

        let env_vars = build_server_env(port, temp_dir.path(), &keychain_creds);
        let env_map: HashMap<_, _> = env_vars.into_iter().collect();

        assert_eq!(env_map.get("PORT"), Some(&"12345".to_string()));
        assert_eq!(
            env_map.get("OPENAIDY_HOME"),
            Some(&temp_dir.path().to_string_lossy().to_string())
        );
        assert_eq!(
            env_map.get("CORS_ORIGIN"),
            Some(&"app://0.0.0.0".to_string())
        );
        assert_eq!(env_map.get("DB_KIND"), Some(&"sqlite".to_string()));
    }

    #[test]
    fn test_build_server_env_injects_keychain_credentials() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let port: u16 = 12345;

        let mut keychain_creds = HashMap::new();
        keychain_creds.insert("OPENAI_API_KEY".to_string(), "sk-test-123".to_string());
        keychain_creds.insert("ANTHROPIC_API_KEY".to_string(), "***".to_string());

        let env_vars = build_server_env(port, temp_dir.path(), &keychain_creds);
        let env_map: HashMap<_, _> = env_vars.into_iter().collect();

        assert_eq!(
            env_map.get("OPENAI_API_KEY"),
            Some(&"sk-test-123".to_string())
        );
        assert_eq!(env_map.get("ANTHROPIC_API_KEY"), Some(&"***".to_string()));
    }

    // ----------------------------------------------------------------
    // locate_server_entry
    // ----------------------------------------------------------------

    #[test]
    fn test_locate_server_entry_prefers_prod_over_dev() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let home_dir = temp_dir.path();

        let openaidy_home = home_dir.join(".config").join("openaidy");
        fs::create_dir_all(&openaidy_home).expect("should create openaidy_home dir");

        let prod_dir = home_dir.join("apps").join("server").join("dist");
        fs::create_dir_all(&prod_dir).expect("should create prod dir");
        fs::write(prod_dir.join("index.js"), "console.log('prod')")
            .expect("should write prod entry");

        let (program, args, _) = locate_server_entry(&openaidy_home);

        assert_eq!(program, "node");
        assert!(args[0].contains("dist/index.js"));
    }

    #[test]
    fn test_locate_server_entry_falls_back_to_dev() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let home_dir = temp_dir.path();

        let openaidy_home = home_dir.join(".config").join("openaidy");
        fs::create_dir_all(&openaidy_home).expect("should create openaidy_home dir");

        let dev_dir = home_dir.join("apps").join("server").join("src");
        fs::create_dir_all(&dev_dir).expect("should create dev dir");
        fs::write(dev_dir.join("server.ts"), "console.log('dev')").expect("should write dev entry");

        let (program, args, _) = locate_server_entry(&openaidy_home);

        assert_eq!(program, "tsx");
        assert!(args[0].contains("server.ts"));
    }
}
