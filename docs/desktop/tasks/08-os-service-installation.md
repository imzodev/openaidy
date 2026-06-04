# Task 08: OS Service Installation

## Objective

Register OpenAidy as a persistent background service that starts on system boot and keeps the core service running even when the desktop window is closed. This gives a "always-on" experience similar to Docker Desktop.

## Success Criteria

1. Linux: systemd user service is installed at `~/.config/systemd/user/openaidy.service`
2. macOS: LaunchAgent plist is installed at `~/Library/LaunchAgents/dev.openaidy.plist`
3. Windows: NSIS installer registers a Windows Service during install
4. Each service starts the core service (`apps/server`) as a daemonized subprocess
5. Services can be enabled/disabled via app settings

## Background

There are two service models:

1. **Embedded** (Tasks 02-03): Tauri spawns the server — server dies when Tauri quits
2. **Standalone** (this task): A system service owns the server — persists independently

We implement **Model 2** as an optional install-time/setting choice.

## Files to Create/Modify

```
apps/desktop/bundle/linux/openaidy.service    ← NEW: systemd unit file
apps/desktop/bundle/macos/dev.openaidy.plist  ← NEW: LaunchAgent plist
apps/desktop/bundle/windows/service.nsi       ← NEW: NSIS service registration
apps/desktop/src-tauri/src/service_install.rs ← NEW: Service installation logic
```

## Implementation Steps

### Step 8.1: Linux — systemd User Service

Create `apps/desktop/bundle/linux/openaidy.service`:

```ini
[Unit]
Description=OpenAidy AI Assistant Background Service
After=network.target
Wants=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/openaidy-service
Restart=on-failure
RestartSec=5
Environment=OPENAIDY_HOME=%h/.config/openaidy
Environment=DB_KIND=sqlite
Environment=SQLITE_PATH=%h/.config/openaidy/openaidy.db
WorkingDirectory=%h/.config/openaidy

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
# Allow reading config in ~/.config/openaidy
ReadWritePaths=%h/.config/openaidy

# Hardening for a Node.js server
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictNamespaces=true

[Install]
WantedBy=default.target
```

The `openaidy-service` binary is a simple wrapper that:

1. Reads env from `$OPENAIDY_HOME/.env` or environment
2. Launches the Node.js server via `tsx` (dev) or `node` (prod)

### Step 8.2: macOS — LaunchAgent Plist

Create `apps/desktop/bundle/macos/dev.openaidy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.openaidy</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/openaidy-service</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENAIDY_HOME</key>
    <string>~/.config/openaidy</string>
    <key>DB_KIND</key>
    <string>sqlite</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/tmp/openaidy.log</string>

  <key>StandardErrorPath</key>
  <string>/tmp/openaidy.err</string>

  <key>ProcessType</key>
  <string>Background</string>

  <key>LowPriorityIO</key>
  <true/>
</dict>
</plist>
```

**Install location:** `~/Library/LaunchAgents/dev.openaidy.plist`

**Commands to manage:**

```bash
# Load (start) the service
launchctl load ~/Library/LaunchAgents/dev.openaidy.plist

# Unload (stop) the service
launchctl unload ~/Library/LaunchAgents/dev.openaidy.plist

# Check status
launchctl list | grep openaidy
```

### Step 8.3: Windows — NSIS Service Registration

Windows doesn't have a native user-level service concept like systemd. We use a Windows Service (via `tauri-plugin-windows-small` or `win32-service` crate) or an auto-start registry entry.

The simplest approach for Windows is a **scheduled task with "At logon" trigger**, which achieves the same effect without needing a full Windows Service:

Create `apps/desktop/bundle/windows/openaidy-task.xml`:

```xml
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2"
  xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>openaidy-service.bat</Command>
      <WorkingDirectory>%USERPROFILE%\.config\openaidy</WorkingDirectory>
    </Exec>
  </Actions>
  <Settings>
    <Hidden>false</Hidden>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
  </Settings>
</Task>
```

Alternatively, use the `win32-service` crate for a proper Windows Service managed by `sc`.

### Step 8.4: Create openaidy-service Wrapper Script

The service needs a thin wrapper binary/script that starts the Node.js server. Create `apps/desktop/scripts/openaidy-service.sh`:

```bash
#!/usr/bin/env bash
#
# openaidy-service — Wrapper script for the OpenAidy background service
#
# This is installed as the ExecStart for the systemd service or LaunchAgent.
# It sets up the environment and launches the server.

set -e

OPENAIDY_HOME="${OPENAIDY_HOME:-$HOME/.config/openaidy}"
export OPENAIDY_HOME

# Load env file if present
ENV_FILE="$OPENAIDY_HOME/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Determine if we should use tsx (dev) or node (prod)
SERVER_ENTRY="$OPENAIDY_HOME/../../../apps/server/dist/index.js"
if [ ! -f "$SERVER_ENTRY" ]; then
  SERVER_ENTRY="$OPENAIDY_HOME/../../../apps/server/src/server.ts"
  RUNNER="tsx"
else
  RUNNER="node"
fi

# Change to workspace root
cd "$(dirname "$SERVER_ENTRY")/../../../../"

# Run the server
exec $RUNNER "$SERVER_ENTRY"
```

For Windows, create `openaidy-service.bat`:

```batch
@echo off
set OPENAIDY_HOME=%USERPROFILE%\.config\openaidy
if exist "%OPENAIDY_HOME%\.env" call "%OPENAIDY_HOME%\.env"
start /B "" node "%USERPROFILE%\.config\openaidy\..\..\apps\server\dist\index.js"
```

### Step 8.5: Service Installation/Uninstallation via Tauri Commands

Create `apps/desktop/src-tauri/src/service_install.rs`:

```rust
//! Service installation — registers the background service with the OS.

use log::{info, error};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone)]
pub enum ServiceManager {
    Systemd,
    LaunchAgent,
    WindowsTask,
}

impl ServiceManager {
    pub fn detect() -> Self {
        #[cfg(target_os = "linux")]
        {
            if std::path::Path::new("/run/user").exists() && std::process::Command::new("systemd").arg("--version").output().is_ok() {
                return ServiceManager::Systemd;
            }
        }
        #[cfg(target_os = "macos")]
        {
            return ServiceManager::LaunchAgent;
        }
        #[cfg(target_os = "windows")]
        {
            return ServiceManager::WindowsTask;
        }
        panic!("Unsupported OS");
    }

    pub fn install(&self, wrapper_path: &PathBuf) -> Result<(), String> {
        match self {
            ServiceManager::Systemd => self.install_systemd(wrapper_path),
            ServiceManager::LaunchAgent => self.install_launchagent(wrapper_path),
            ServiceManager::WindowsTask => self.install_windows_task(wrapper_path),
        }
    }

    pub fn uninstall(&self) -> Result<(), String> {
        match self {
            ServiceManager::Systemd => self.uninstall_systemd(),
            ServiceManager::LaunchAgent => self.uninstall_launchagent(),
            ServiceManager::WindowsTask => self.uninstall_windows_task(),
        }
    }

    pub fn is_installed(&self) -> bool {
        match self {
            ServiceManager::Systemd => {
                std::process::Command::new("systemctl")
                    .args(["--user", "is-active", "openaidy"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
            ServiceManager::LaunchAgent => {
                std::path::Path::new("/Users")
                    .join(std::env::var("USER").unwrap_or_default())
                    .join("Library/LaunchAgents/dev.openaidy.plist")
                    .exists()
            }
            ServiceManager::WindowsTask => {
                std::process::Command::new("schtasks")
                    .args(["/Query", "/TN", "OpenAidy"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
        }
    }

    // ─── systemd ────────────────────────────────────────────────────────────

    fn install_systemd(&self, wrapper_path: &PathBuf) -> Result<(), String> {
        let unit_content = format!(r#"[Unit]
Description=OpenAidy AI Assistant Background Service

[Service]
Type=simple
ExecStart={wrapper_path}
Restart=on-failure
RestartSec=5
Environment=OPENAIDY_HOME=$HOME/.config/openaidy
WorkingDirectory=$HOME/.config/openaidy

[Install]
WantedBy=default.target
"#,
            wrapper_path = wrapper_path.display()
        );

        let unit_dir = dirs::config_dir()
            .unwrap_or_default()
            .join("systemd/user");
        std::fs::create_dir_all(&unit_dir).map_err(|e| e.to_string())?;

        let unit_path = unit_dir.join("openaidy.service");
        std::fs::write(&unit_path, unit_content).map_err(|e| e.to_string())?;

        let output = Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err("systemctl daemon-reload failed".into());
        }

        let output = Command::new("systemctl")
            .args(["--user", "enable", "openaidy"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err("systemctl enable failed".into());
        }

        let output = Command::new("systemctl")
            .args(["--user", "start", "openaidy"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err("systemctl start failed".into());
        }

        info!("systemd service installed and started");
        Ok(())
    }

    fn uninstall_systemd(&self) -> Result<(), String> {
        let _ = Command::new("systemctl")
            .args(["--user", "stop", "openaidy"])
            .output();

        let _ = Command::new("systemctl")
            .args(["--user", "disable", "openaidy"])
            .output();

        let unit_path = dirs::config_dir()
            .unwrap_or_default()
            .join("systemd/user/openaidy.service");
        let _ = std::fs::remove_file(&unit_path);

        info!("systemd service uninstalled");
        Ok(())
    }

    // ─── LaunchAgent ────────────────────────────────────────────────────────

    fn install_launchagent(&self, wrapper_path: &PathBuf) -> Result<(), String> {
        let plist_content = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.openaidy</string>
  <key>ProgramArguments</key>
  <array>
    <string>{wrapper_path}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENAIDY_HOME</key>
    <string>$HOME/.config/openaidy</string>
  </dict>
</dict>
</plist>
"#,
            wrapper_path = wrapper_path.display()
        );

        let plist_dir = dirs::home_dir()
            .unwrap_or_default()
            .join("Library/LaunchAgents");
        std::fs::create_dir_all(&plist_dir).map_err(|e| e.to_string())?;

        let plist_path = plist_dir.join("dev.openaidy.plist");
        std::fs::write(&pl, plist_content).map_err(|e| e.to_string())?;

        let output = Command::new("launchctl")
            .args(["load", plist_path.to_str().unwrap()])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!("launchctl load failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        info!("LaunchAgent installed and started");
        Ok(())
    }

    fn uninstall_launchagent(&self) -> Result<(), String> {
        let plist_path = dirs::home_dir()
            .unwrap_or_default()
            .join("Library/LaunchAgents/dev.openaidy.plist");

        let _ = Command::new("launchctl")
            .args(["unload", plist_path.to_str().unwrap()])
            .output();

        let _ = std::fs::remove_file(&plist_path);
        info!("LaunchAgent uninstalled");
        Ok(())
    }

    // ─── Windows Task ───────────────────────────────────────────────────────

    fn install_windows_task(&self, wrapper_path: &PathBuf) -> Result<(), String> {
        // Use schtasks to create a task that runs at logon
        let output = Command::new("schtasks")
            .args([
                "/Create",
                "/TN", "OpenAidy",
                "/TR", &format!("\"{}\"", wrapper_path.display()),
                "/SC", "ONLOGON",
                "/F",  // Force overwrite
            ])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!("schtasks failed: {}", String::from_utf8_lossy(&output.stderr)));
        }

        info!("Windows scheduled task installed");
        Ok(())
    }

    fn uninstall_windows_task(&self) -> Result<(), String> {
        let _ = Command::new("schtasks")
            .args(["/Delete", "/TN", "OpenAidy", "/F"])
            .output();

        info!("Windows scheduled task uninstalled");
        Ok(())
    }
}
```

Note: The LaunchAgent plist generation has a typo (`&pl` instead of `&plist_content`). Fix before use.

## Service vs Embedded Mode

| Mode         | Who starts server | Survives window close | Install required |
| ------------ | ----------------- | --------------------- | ---------------- |
| **Embedded** | Tauri (Task 03)   | No                    | No               |
| **Service**  | OS service        | Yes                   | Yes              |

The user should be able to choose via a setting: "Run in background on startup" (enables service).

## Verification

```bash
# Linux
systemctl --user status openaidy
systemctl --user enable openaidy

# macOS
launchctl list | grep openaidy
launchctl load ~/Library/LaunchAgents/dev.openaidy.plist

# Windows
schtasks /Query /TN OpenAidy
```

## Risks & Mitigations

| Risk                                     | Mitigation                                        |
| ---------------------------------------- | ------------------------------------------------- |
| systemd not available on some distros    | Check for systemd before offering service install |
| libsecret not installed (Linux keychain) | Document dependency in install instructions       |
| Service fails silently                   | Check logs via `journalctl --user -u openaidy`    |
| macOS Gatekeeper blocks unsigned binary  | Sign the binary or document how to allow          |
| Windows Defender flags binary            | Submit for signing or document warning            |
| Multiple install attempts                | Check `is_installed()` before re-installing       |
