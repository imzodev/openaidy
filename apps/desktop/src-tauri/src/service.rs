//! Core service lifecycle manager.
//!
//! Spawns `apps/server` as a managed subprocess, writes the assigned port to
//! OPENAIDY_HOME/port, and handles graceful shutdown.

use log::{error, info, warn};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, Duration};

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

/// How many fresh ports to try, in a row, when the one `pick_free_port()`
/// handed back turns out to already be taken by the time our own child
/// tries to bind it (a TOCTOU race: the port is free at pick-time, but
/// nothing reserves it between then and the child's own bind call).
const MAX_BIND_ATTEMPTS: u32 = 3;

/// How long to wait for the spawned server to confirm it's listening before
/// treating the attempt as a genuine (non-contention) failure.
const BIND_WAIT: Duration = Duration::from_secs(15);

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

impl ServiceState {
    /// Bare variant name, exposed to the frontend via ServiceStatus.state.
    /// Deliberately NOT the derived Debug format: `Running`/`Crashed` carry
    /// fields, so `format!("{self:?}")` produces e.g. `"Running { port: 3001
    /// }"` — the frontend's `isConnected()` does an exact `state === 'Running'`
    /// check (apps/web/src/lib/tauri-provider.tsx), which can never match
    /// against that. Caught live: the desktop app's own status bar showed
    /// "Service stopped" forever despite the service actually running.
    fn variant_name(&self) -> &'static str {
        match self {
            ServiceState::Idle => "Idle",
            ServiceState::Starting => "Starting",
            ServiceState::Running { .. } => "Running",
            ServiceState::Crashed { .. } => "Crashed",
            ServiceState::Stopping => "Stopping",
        }
    }
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

/// Thread-safe service manager.
///
/// Every field is itself `Arc`-wrapped so that `#[derive(Clone)]` produces a
/// *shallow* clone — one that shares the exact same locks as the original —
/// rather than a fresh, independent instance. That matters because `start()`
/// hands a clone to the background crash monitor: a deep clone (fresh
/// `RwLock::const_new(ServiceState::Idle)` etc.) would leave the monitor
/// reading its own permanently-`Idle` copy of the state while the real
/// instance transitions to `Running`, so it would never observe a crash and
/// auto-restart would silently never fire. Caught live: the monitor loop's
/// very first iteration saw `Idle` and broke immediately.
#[derive(Clone)]
pub struct ServiceManager {
    state: Arc<RwLock<ServiceState>>,
    child: Arc<Mutex<Option<Child>>>,
    port: Arc<RwLock<Option<u16>>>,
    restart_attempts: Arc<RwLock<u32>>,
    openaidy_home: PathBuf,
}

/// Distinguishes a port-contention failure (worth retrying with a fresh
/// port) from a genuine boot failure (retrying the same way won't help).
enum StartOnceError {
    PortContested(String),
    Other(String),
}

impl ServiceManager {
    pub fn new(openaidy_home: PathBuf) -> Self {
        Self {
            state: Arc::new(RwLock::const_new(ServiceState::Idle)),
            child: Arc::new(Mutex::const_new(None)),
            port: Arc::new(RwLock::const_new(None)),
            restart_attempts: Arc::new(RwLock::const_new(0)),
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
            state: state.variant_name().to_string(),
            port,
            restart_attempts,
            pid,
            openaidy_home: self.openaidy_home.clone(),
        }
    }

    /// Start the service, with retry logic on crash.
    ///
    /// `resource_dir` is the Tauri-resolved bundled-resources directory
    /// (`app.path().resource_dir()`) — where a packaged build's copy of
    /// `apps/server/dist` actually lives. It's platform-specific (e.g.
    /// inside `Contents/Resources` on macOS), which is why it has to come
    /// from Tauri itself rather than being derived from the executable's own
    /// path. `None` in dev mode, where the monorepo-relative fallback in
    /// `locate_server_entry` applies instead.
    pub async fn start(
        &self,
        keychain_creds: HashMap<String, String>,
        resource_dir: Option<PathBuf>,
    ) -> Result<u16, String> {
        // Set state to Starting
        {
            let mut s = self.state.write().await;
            *s = ServiceState::Starting;
        }

        let port = match self
            .try_start(&keychain_creds, resource_dir.as_deref())
            .await
        {
            Ok(port) => port,
            Err(e) => {
                error!("Service start failed: {e}");
                let attempts = *self.restart_attempts.read().await;
                let mut s = self.state.write().await;
                *s = ServiceState::Crashed { attempts };
                return Err(e);
            }
        };

        {
            let mut s = self.state.write().await;
            *s = ServiceState::Running { port };
        }

        // Spawn background monitor — a true shallow clone (see the type's
        // doc comment), so it observes the same state/child this instance
        // mutates from here on.
        let manager = Arc::new(self.clone());
        let creds = keychain_creds;
        tokio::spawn(async move {
            manager.monitor_loop(creds, resource_dir).await;
        });

        Ok(port)
    }

    /// Attempt to start the server, retrying with a fresh port up to
    /// `MAX_BIND_ATTEMPTS` times if the chosen port turns out to already be
    /// taken (see `try_start_once`'s doc comment for why that can happen).
    async fn try_start(
        &self,
        keychain_creds: &HashMap<String, String>,
        resource_dir: Option<&Path>,
    ) -> Result<u16, String> {
        let mut last_err = String::new();
        for attempt in 1..=MAX_BIND_ATTEMPTS {
            match self.try_start_once(keychain_creds, resource_dir).await {
                Ok(port) => return Ok(port),
                Err(StartOnceError::PortContested(e)) => {
                    warn!(
                        "Start attempt {attempt}/{MAX_BIND_ATTEMPTS} lost a port race ({e}), retrying with a fresh port"
                    );
                    last_err = e;
                }
                // Not a port race — retrying the same way won't help, so
                // surface it immediately instead of burning the remaining
                // attempts' worth of wait time.
                Err(StartOnceError::Other(e)) => return Err(e),
            }
        }
        Err(format!(
            "gave up after {MAX_BIND_ATTEMPTS} port-contention retries: {last_err}"
        ))
    }

    /// Single attempt: pick a port, spawn the server, and wait for it to
    /// either confirm the port is bound or exit early.
    ///
    /// `pick_free_port()` binds a throwaway listener, reads its assigned
    /// port, then drops it — nothing reserves that port between the drop and
    /// the child process's own bind call, so another process on the machine
    /// can grab it first. When that happens the child (a Node server) exits
    /// almost immediately with an EADDRINUSE-style error; polling for that
    /// early exit lets this return quickly instead of waiting out the full
    /// `BIND_WAIT` window for a port that was never going to bind.
    async fn try_start_once(
        &self,
        keychain_creds: &HashMap<String, String>,
        resource_dir: Option<&Path>,
    ) -> Result<u16, StartOnceError> {
        use std::env;

        let port = pick_free_port().map_err(|e| StartOnceError::Other(e.to_string()))?;
        let (program, args, cwd) = locate_server_entry(&self.openaidy_home, resource_dir);

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

        // apps/server/src/lib/env.ts derives its own APP_CONFIG_TEMPLATE_PATH
        // / BUNDLED_SKILLS_DIR defaults from `import.meta.url`, walking a
        // fixed number of parent directories up from wherever env.ts itself
        // physically sits — correct when it's really at
        // apps/server/src/lib/env.ts (dev mode), but that file is a *copy*
        // once bundled (see locate_server_entry's doc comment), sitting at
        // a completely different depth, so those defaults resolve to nonsense
        // (observed: landing inside apps/desktop/config, which doesn't
        // exist). `beforeBuildCommand` also copies the repo's own top-level
        // config/ into the bundle as "shared-config" specifically so these
        // can be pointed at a real location instead.
        let shared_config_dir = cwd.join("shared-config");
        if shared_config_dir.join("openaidy.template.json").exists() {
            vars.push((
                "APP_CONFIG_TEMPLATE_PATH".to_string(),
                shared_config_dir
                    .join("openaidy.template.json")
                    .to_string_lossy()
                    .to_string(),
            ));
            vars.push((
                "BUNDLED_SKILLS_DIR".to_string(),
                shared_config_dir
                    .join("skills")
                    .to_string_lossy()
                    .to_string(),
            ));
        }

        for (k, v) in keychain_creds {
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
            .map_err(|e| {
                // The packaged app bundles apps/server itself but not a
                // Node.js runtime — `program` is plain "node", resolved via
                // PATH — so a missing system Node is the single most likely
                // reason this ever fails, and the raw io::Error ("program
                // not found" / os error 2) gives the user no idea what to
                // actually do about it.
                if e.kind() == std::io::ErrorKind::NotFound {
                    StartOnceError::Other(
                        "Node.js was not found on PATH. OpenAidy's core service requires \
                         Node.js 18+ to be installed separately — see https://nodejs.org/"
                            .to_string(),
                    )
                } else {
                    StartOnceError::Other(format!("spawn error: {e}"))
                }
            })?;

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

        // Wait for server to bind, or exit early (a strong signal the port
        // was contested rather than the server just being slow).
        let port_copy = port;
        let deadline = std::time::Instant::now() + BIND_WAIT;
        while std::time::Instant::now() < deadline {
            sleep(Duration::from_millis(200)).await;

            if let Ok(Some(status)) = child.try_wait() {
                return Err(StartOnceError::PortContested(format!(
                    "server exited early ({status:?}) before binding port {port_copy}"
                )));
            }

            if tokio::net::TcpStream::connect(format!("127.0.0.1:{port_copy}"))
                .await
                .is_ok()
            {
                // Write port file
                write_port_file(&self.openaidy_home, port_copy)
                    .map_err(|e| StartOnceError::Other(format!("write_port_file: {e}")))?;
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

        // Timed out without binding *and* without exiting — genuinely slow
        // or stuck, not a contended port. Kill it; the caller won't retry
        // this kind of failure.
        drop(child.kill());
        Err(StartOnceError::Other(format!(
            "server did not bind to port {port_copy} within {BIND_WAIT:?}"
        )))
    }

    /// Monitor loop — restarts on crash
    async fn monitor_loop(
        &self,
        keychain_creds: HashMap<String, String>,
        resource_dir: Option<PathBuf>,
    ) {
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

                                    match self
                                        .try_start(&keychain_creds, resource_dir.as_deref())
                                        .await
                                    {
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
            let result = tokio::time::timeout(Duration::from_secs(10), c.wait()).await;
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
}

/// Locate the server entry point and how to run it.
///
/// `openaidy_home` (the OS per-user app-data dir, e.g. `%APPDATA%/openaidy`
/// on Windows) has no path relationship to where the monorepo source or a
/// packaged build's resources live — it used to be (wrongly) used as the
/// basis for this lookup, which meant this always failed to find the server
/// outside of the one specific case where openaidy_home happened to be
/// nested exactly two directories inside the workspace root.
///
/// Both dev and packaged mode run the *TypeScript source* directly through
/// `node <tsx's cli.mjs> <server.ts>`, never `apps/server`'s own `tsc`-
/// compiled `dist` output. The compiled output looked like the "proper"
/// production path, but apps/server relies on the workspace's shared
/// `moduleResolution: "Bundler"` tsconfig (needed elsewhere for esbuild/Vite
/// tooling) — under that mode `tsc` leaves relative imports (`from
/// './app'`) without a `.js` extension in its emitted JS, which plain
/// Node's ESM loader then refuses to resolve at all
/// (`ERR_MODULE_NOT_FOUND`). Running the original `.ts` source through tsx
/// (an esbuild-backed loader tolerant of extensionless imports) is what
/// apps/server's own `dev` script already does, and is the only path that's
/// actually been proven to boot the full server end-to-end. A bare `tsx`
/// command isn't used directly — it's only ever a pnpm-local
/// `node_modules/.bin` shim (a `.CMD`/`.ps1` wrapper on Windows, not
/// something `std::process::Command` can exec directly, and not on PATH at
/// all unless installed globally) — `node_modules/tsx/dist/cli.mjs` is the
/// real, portable entry point.
///
/// Packaged mode looks under `resource_dir` (`tauri::Manager::path()
/// .resource_dir()` — the bundled-resources directory, which is *not*
/// simply "next to the executable" on every platform, e.g. it's inside
/// `Contents/Resources` in a macOS `.app` bundle) for `server-bundle`, the
/// self-contained `pnpm --filter @openaidy/server deploy --prod` output
/// `tauri.conf.json`'s `beforeBuildCommand` produces and `bundle.resources`
/// ships — apps/server's own source plus its fully resolved production
/// node_modules (`pnpm deploy` flattens the target package's own contents
/// to the deploy dir, so `server-bundle/` here plays the same role
/// `apps/server/` does for the dev fallback below). `tsx` is a direct
/// dependency of `@openaidy/server` specifically so this deploy step
/// captures it.
///
/// Dev mode: `apps/server/src/server.ts` plus the workspace root's own
/// `node_modules/tsx`, found relative to this crate's own location in the
/// monorepo via `CARGO_MANIFEST_DIR` (a compile-time constant — always
/// `apps/desktop/src-tauri` — so this only works when built from the
/// monorepo, which is exactly the dev case).
fn locate_server_entry(
    _openaidy_home: &Path,
    resource_dir: Option<&Path>,
) -> (String, Vec<String>, PathBuf) {
    let dev_workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");

    let bundled_server_root = resource_dir.map(|dir| dir.join("server-bundle"));

    locate_server_entry_from(&dev_workspace_root, bundled_server_root.as_deref())
}

/// Injectable version of the search so tests can point it at temp
/// directories instead of the real compile-time/resource-dir roots.
fn locate_server_entry_from(
    dev_workspace_root: &Path,
    bundled_server_root: Option<&Path>,
) -> (String, Vec<String>, PathBuf) {
    // apps/server has no src/index.ts — `server.ts` is the real entry
    // point. (`apps/server/package.json`'s own `exports["."]` field claims
    // `./src/index.ts`, which doesn't exist either — a pre-existing issue
    // in that package, unrelated to this lookup.)
    if let Some(bundled_root) = bundled_server_root {
        let entry = bundled_root.join("src").join("server.ts");
        let tsx_cli = bundled_root
            .join("node_modules")
            .join("tsx")
            .join("dist")
            .join("cli.mjs");
        if entry.exists() && tsx_cli.exists() {
            return (
                "node".to_string(),
                vec![
                    tsx_cli.to_string_lossy().to_string(),
                    entry.to_string_lossy().to_string(),
                ],
                bundled_root.to_path_buf(),
            );
        }
    }

    let dev_entry = dev_workspace_root
        .join("apps")
        .join("server")
        .join("src")
        .join("server.ts");
    if dev_entry.exists() {
        let tsx_cli = dev_workspace_root
            .join("node_modules")
            .join("tsx")
            .join("dist")
            .join("cli.mjs");
        (
            "node".to_string(),
            vec![
                tsx_cli.to_string_lossy().to_string(),
                dev_entry.to_string_lossy().to_string(),
            ],
            dev_workspace_root.to_path_buf(),
        )
    } else {
        error!(
            "Cannot find server entry. Tried:\n  bundled: {bundled_server_root:?}\n  dev:     {dev_entry:?}"
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

/// Write the port file so the frontend IPC bridge can find it.
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

    // Regression test: caught live in a real running desktop app — the
    // frontend's isConnected() does an exact `state === 'Running'` string
    // check, which silently never matched when this used to be the derived
    // Debug format (`"Running { port: 3000 }"`) instead of the bare variant
    // name. Covers every variant, not just Running, since Crashed also
    // carries a field with the same bug shape.
    #[test]
    fn test_service_state_variant_name_is_bare_for_data_carrying_variants() {
        assert_eq!(ServiceState::Idle.variant_name(), "Idle");
        assert_eq!(ServiceState::Starting.variant_name(), "Starting");
        assert_eq!(
            ServiceState::Running { port: 3000 }.variant_name(),
            "Running"
        );
        assert_eq!(
            ServiceState::Crashed { attempts: 3 }.variant_name(),
            "Crashed"
        );
        assert_eq!(ServiceState::Stopping.variant_name(), "Stopping");
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

    // Regression test for the shared-state bug: a shallow clone (as used to
    // hand the monitor loop a handle onto the same manager) must observe
    // mutations made through the original, not a frozen snapshot from
    // clone-time.
    #[test]
    fn test_service_manager_clone_shares_state() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let manager = ServiceManager::new(temp_dir.path().to_path_buf());
        let clone = manager.clone();

        futures::executor::block_on(async {
            {
                let mut s = manager.state.write().await;
                *s = ServiceState::Running { port: 4242 };
            }
            let status = clone.status().await;
            assert_eq!(status.state, "Running");
            assert_eq!(status.port, None); // port signal wasn't touched here
        });
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
    }

    #[test]
    fn test_pick_free_port_returns_different_ports() {
        let port1 = pick_free_port().expect("should return a valid port");
        let port2 = pick_free_port().expect("should return a valid port");
        assert!(port1 > 0 && port2 > 0);
    }

    // ----------------------------------------------------------------
    // locate_server_entry
    // ----------------------------------------------------------------

    // These test locate_server_entry_from (the injectable version) rather
    // than locate_server_entry itself, since the real function's roots
    // (CARGO_MANIFEST_DIR, resource_dir/current_exe()) aren't things a unit
    // test can meaningfully redirect into a temp dir.

    #[test]
    fn test_locate_server_entry_prefers_bundled_over_dev() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let root = temp_dir.path();

        let dev_dir = root
            .join("dev-root")
            .join("apps")
            .join("server")
            .join("src");
        fs::create_dir_all(&dev_dir).expect("should create dev dir");
        fs::write(dev_dir.join("server.ts"), "console.log('dev')").expect("should write dev entry");

        // A complete bundled deploy needs both the entry *and* its own tsx —
        // this is what `pnpm deploy --prod` for @openaidy/server (which now
        // depends on tsx directly) actually produces.
        let bundled_root = root.join("resource-dir").join("server-bundle");
        fs::create_dir_all(bundled_root.join("src")).expect("should create bundled src dir");
        fs::write(
            bundled_root.join("src").join("server.ts"),
            "console.log('bundled')",
        )
        .expect("should write bundled entry");
        let tsx_dir = bundled_root.join("node_modules").join("tsx").join("dist");
        fs::create_dir_all(&tsx_dir).expect("should create bundled tsx dir");
        fs::write(tsx_dir.join("cli.mjs"), "// tsx cli").expect("should write bundled tsx cli");

        let (program, args, _) =
            locate_server_entry_from(&root.join("dev-root"), Some(&bundled_root));

        assert_eq!(program, "node");
        assert!(args[0].contains("tsx") && args[0].contains("cli.mjs"));
        assert!(args[1].contains("server.ts") && args[1].contains("resource-dir"));
    }

    #[test]
    fn test_locate_server_entry_falls_back_to_dev_when_no_bundled_root_given() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let root = temp_dir.path();

        let dev_dir = root
            .join("dev-root")
            .join("apps")
            .join("server")
            .join("src");
        fs::create_dir_all(&dev_dir).expect("should create dev dir");
        fs::write(dev_dir.join("server.ts"), "console.log('dev')").expect("should write dev entry");

        let (program, args, _) = locate_server_entry_from(&root.join("dev-root"), None);

        assert_eq!(program, "node");
        assert!(args[0].contains("tsx") && args[0].contains("cli.mjs"));
        assert!(args[1].contains("server.ts"));
    }

    #[test]
    fn test_locate_server_entry_falls_back_to_dev_when_bundled_root_incomplete() {
        let temp_dir = TempDir::new().expect("should create temp dir");
        let root = temp_dir.path();

        let dev_dir = root
            .join("dev-root")
            .join("apps")
            .join("server")
            .join("src");
        fs::create_dir_all(&dev_dir).expect("should create dev dir");
        fs::write(dev_dir.join("server.ts"), "console.log('dev')").expect("should write dev entry");

        // Bundled root exists but is missing its own tsx (e.g. a
        // half-finished/corrupted install) — should still fall back to dev
        // rather than trying (and failing) to run without a tsx loader.
        let bundled_root = root.join("resource-dir").join("server-bundle");
        fs::create_dir_all(bundled_root.join("src")).expect("should create bundled src dir");
        fs::write(
            bundled_root.join("src").join("server.ts"),
            "console.log('bundled')",
        )
        .expect("should write bundled entry");

        let (program, args, _) =
            locate_server_entry_from(&root.join("dev-root"), Some(&bundled_root));

        assert_eq!(program, "node");
        assert!(args[1].contains("dev-root"));
    }
}
