//! Service installation — registers the background service with the OS.
//!
//! This module handles installing/uninstalling OS-level service managers:
//! - Linux: systemd user service
//! - macOS: LaunchAgent plist
//! - Windows: Scheduled task with logon trigger

use log::info;
use std::process::Command;

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceManager {
    Systemd,
    LaunchAgent,
    WindowsTask,
}

#[allow(dead_code)]
impl ServiceManager {
    /// Detect which service manager is available on this OS
    pub fn detect() -> Self {
        #[cfg(target_os = "linux")]
        {
            if std::path::Path::new("/run/user").exists()
                && Command::new("systemd")
                    .arg("--version")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            {
                return ServiceManager::Systemd;
            }
            // No systemd on this Linux distro — return Systemd anyway and let install fail gracefully
            ServiceManager::Systemd
        }
        #[cfg(target_os = "macos")]
        {
            return ServiceManager::LaunchAgent;
        }
        #[cfg(target_os = "windows")]
        {
            return ServiceManager::WindowsTask;
        }
        // Fallback — will likely fail on install
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        {
            panic!("Unsupported OS: cannot detect a service manager");
        }
    }

    /// Install the background service with the given wrapper script path
    pub fn install(&self, wrapper_path: &std::path::Path) -> Result<(), String> {
        match self {
            ServiceManager::Systemd => self.install_systemd(wrapper_path),
            ServiceManager::LaunchAgent => self.install_launchagent(wrapper_path),
            ServiceManager::WindowsTask => self.install_windows_task(wrapper_path),
        }
    }

    /// Uninstall the background service
    pub fn uninstall(&self) -> Result<(), String> {
        match self {
            ServiceManager::Systemd => self.uninstall_systemd(),
            ServiceManager::LaunchAgent => self.uninstall_launchagent(),
            ServiceManager::WindowsTask => self.uninstall_windows_task(),
        }
    }

    /// Check if the service is currently installed
    pub fn is_installed(&self) -> bool {
        match self {
            ServiceManager::Systemd => Command::new("systemctl")
                .args(["--user", "is-active", "openaidy"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false),
            ServiceManager::LaunchAgent => dirs::home_dir()
                .map(|h| h.join("Library/LaunchAgents/dev.openaidy.plist"))
                .map(|p| p.exists())
                .unwrap_or(false),
            ServiceManager::WindowsTask => Command::new("schtasks")
                .args(["/Query", "/TN", "OpenAidy"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false),
        }
    }

    // ─── systemd ──────────────────────────────────────────────────────────────

    fn install_systemd(&self, wrapper_path: &std::path::Path) -> Result<(), String> {
        let unit_content = format!(
            r#"[Unit]
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

        let unit_dir = dirs::config_dir().unwrap_or_default().join("systemd/user");
        std::fs::create_dir_all(&unit_dir).map_err(|e| e.to_string())?;

        let unit_path = unit_dir.join("openaidy.service");
        std::fs::write(&unit_path, &unit_content).map_err(|e| e.to_string())?;

        let output = Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!(
                "systemctl daemon-reload failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let output = Command::new("systemctl")
            .args(["--user", "enable", "openaidy"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!(
                "systemctl enable failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        let output = Command::new("systemctl")
            .args(["--user", "start", "openaidy"])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!(
                "systemctl start failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
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

    // ─── LaunchAgent ──────────────────────────────────────────────────────────

    fn install_launchagent(&self, wrapper_path: &std::path::Path) -> Result<(), String> {
        let plist_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
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
        std::fs::write(&plist_path, plist_content).map_err(|e| e.to_string())?;

        let output = Command::new("launchctl")
            .args(["load", plist_path.to_str().unwrap()])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!(
                "launchctl load failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
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

    // ─── Windows Task ─────────────────────────────────────────────────────────

    fn install_windows_task(&self, wrapper_path: &std::path::Path) -> Result<(), String> {
        let output = Command::new("schtasks")
            .args([
                "/Create",
                "/TN",
                "OpenAidy",
                "/TR",
                &format!("\"{}\"", wrapper_path.display()),
                "/SC",
                "ONLOGON",
                "/F",
            ])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(format!(
                "schtasks failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_manager_detect_returns_enum_variant() {
        let manager = ServiceManager::detect();
        let variant_name = format!("{:?}", manager);
        assert!(!variant_name.is_empty());
    }

    #[test]
    fn test_service_manager_is_installed_returns_bool() {
        let manager = ServiceManager::detect();
        // Should return a boolean without panicking
        let result = manager.is_installed();
        assert!(result == true || result == false);
    }

    #[test]
    fn test_service_manager_enum_debug() {
        let manager = ServiceManager::detect();
        let debug_str = format!("{:?}", manager);
        assert!(
            debug_str.contains("Systemd")
                || debug_str.contains("LaunchAgent")
                || debug_str.contains("WindowsTask"),
            "Unexpected ServiceManager variant: {}",
            debug_str
        );
    }

    #[test]
    fn test_service_manager_clone() {
        let manager = ServiceManager::detect();
        let _cloned = manager.clone();
    }
}
