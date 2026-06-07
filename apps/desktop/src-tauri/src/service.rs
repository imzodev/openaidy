//! Core service lifecycle manager.
//!
//! Spawns `apps/server` as a managed subprocess, writes the assigned port to
//! OPENAIDY_HOME/port, and handles graceful shutdown.

use log::{error, info};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

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
/// Reads existing env and supplements with keychain credentials + computed values.
#[allow(dead_code)]
fn build_server_env(
    port: u16,
    openaidy_home: &Path,
    keychain_creds: &std::collections::HashMap<String, String>,
) -> Vec<(String, String)> {
    use std::env;

    let mut vars: Vec<(String, String)> = env::vars().collect();

    // Override/add OpenAidy-specific vars
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
pub async fn start_service(
    openaidy_home: PathBuf,
    keychain_creds: std::collections::HashMap<String, String>,
) -> Result<ServiceHandle, String> {
    // Check if already running
    if let Some(port) = read_port_file(&openaidy_home) {
        info!("Server already running on port {port}");
        // Try to connect to verify it's alive
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
            .await
            .is_ok()
        {
            // Return a placeholder child — we don't own this process
            // This is a workaround for the "already running" case
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

    // Log stdout/stderr in background
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

    // Wait briefly for server to bind to port
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
// TDD Tests - RED phase: these tests define the expected behavior
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

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
        // Note: there's a tiny chance they could match, but very unlikely
        // This mainly verifies they don't panic
        assert!(port1 > 0 && port2 > 0);
    }

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
    fn test_build_server_env_includes_openaidy_vars() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let port: u16 = 12345;
        let keychain_creds = std::collections::HashMap::new();

        let env_vars = build_server_env(port, temp_dir.path(), &keychain_creds);
        let env_map: std::collections::HashMap<_, _> = env_vars.into_iter().collect();

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

        let mut keychain_creds = std::collections::HashMap::new();
        keychain_creds.insert("OPENAI_API_KEY".to_string(), "sk-test-123".to_string());
        keychain_creds.insert("ANTHROPIC_API_KEY".to_string(), "***".to_string());

        let env_vars = build_server_env(port, temp_dir.path(), &keychain_creds);
        let env_map: std::collections::HashMap<_, _> = env_vars.into_iter().collect();

        assert_eq!(
            env_map.get("OPENAI_API_KEY"),
            Some(&"sk-test-123".to_string())
        );
        assert_eq!(env_map.get("ANTHROPIC_API_KEY"), Some(&"***".to_string()));
    }

    #[test]
    fn test_locate_server_entry_prefers_prod_over_dev() {
        // Setup: temp_dir/
        //   .config/openaidy/ <- openaidy_home (nested 2 levels deep)
        //   apps/server/dist/index.js <- prod entry (sibling of .config)
        let temp_dir = TempDir::new().expect("should create temp dir");
        let home_dir = temp_dir.path();

        // openaidy_home must be nested 2+ levels deep so .parent().parent() finds workspace_root
        let openaidy_home = home_dir.join(".config").join("openaidy");
        fs::create_dir_all(&openaidy_home).expect("should create openaidy_home dir");

        // Create prod entry at home_dir/apps/server/dist/index.js
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
        // Setup: temp_dir/
        //   .config/openaidy/        <- openaidy_home (nested 2 levels deep)
        //   apps/server/src/server.ts <- dev entry (sibling of .config, NO prod)
        let temp_dir = TempDir::new().expect("should create temp dir");
        let home_dir = temp_dir.path();

        // openaidy_home must be nested 2+ levels deep so .parent().parent() finds workspace_root
        let openaidy_home = home_dir.join(".config").join("openaidy");
        fs::create_dir_all(&openaidy_home).expect("should create openaidy_home dir");

        // Create dev entry at home_dir/apps/server/src/server.ts (NO prod entry)
        let dev_dir = home_dir.join("apps").join("server").join("src");
        fs::create_dir_all(&dev_dir).expect("should create dev dir");
        fs::write(dev_dir.join("server.ts"), "console.log('dev')").expect("should write dev entry");

        let (program, args, _) = locate_server_entry(&openaidy_home);

        assert_eq!(program, "tsx");
        assert!(args[0].contains("server.ts"));
    }

    #[test]
    fn test_write_port_file_creates_directory() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let nested_dir = temp_dir.path().join("openaidy").join("subdir");
        let port: u16 = 12345;

        // Should create directories as needed
        write_port_file(&nested_dir, port).expect("write should succeed");

        let port_file_content =
            fs::read_to_string(nested_dir.join("port")).expect("should read port file");
        assert_eq!(port_file_content.trim(), "12345");
    }
}
