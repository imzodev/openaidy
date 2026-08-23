//! Window management — close-to-tray behavior, window controls, and state persistence.

use log::info;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, WindowEvent};

/// Window state for persistence across sessions.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_maximized: bool,
}

impl WindowState {
    /// Load window state from the openaidy config directory.
    pub fn load(openaidy_home: &std::path::Path) -> Option<WindowState> {
        let path = openaidy_home.join("window-state.json");
        let content = fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Save window state to the openaidy config directory.
    pub fn save(&self, openaidy_home: &std::path::Path) -> std::io::Result<()> {
        fs::create_dir_all(openaidy_home)?;
        let path = openaidy_home.join("window-state.json");
        let content = serde_json::to_string_pretty(self)?;
        fs::write(path, content)
    }
}

/// Global openaidy home path for window state saving.
static OPENAIDY_HOME: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Set the global openaidy home path.
pub fn set_openaidy_home(home: PathBuf) {
    OPENAIDY_HOME.set(home).ok();
}

/// Configure close-to-tray behavior for the main window.
/// Also saves window state before hiding.
pub fn setup_close_to_tray<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    let window_clone = main_window.clone();

    main_window.on_window_event(move |event: &WindowEvent| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            info!("Close requested — intercepting to hide to tray");
            api.prevent_close();

            // Save window state before hiding
            if let Some(home) = OPENAIDY_HOME.get() {
                if let Ok(pos) = window_clone.outer_position() {
                    if let Ok(size) = window_clone.outer_size() {
                        let is_max = window_clone.is_maximized().unwrap_or(false);
                        let state = WindowState {
                            x: pos.x,
                            y: pos.y,
                            width: size.width,
                            height: size.height,
                            is_maximized: is_max,
                        };
                        let _ = state.save(home);
                    }
                }
            }

            let app = AppHandle::clone(&app);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
    });

    info!("Close-to-tray handler registered");
    Ok(())
}

/// Show the main window and bring it to front.
#[tauri::command]
pub fn show_main_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Minimize the main window.
#[tauri::command]
pub fn minimize_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

/// Maximize or unmaximize the main window.
#[tauri::command]
pub async fn toggle_maximize<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

/// Close the main window (hides to tray, does not quit).
#[tauri::command]
pub fn close_window<R: Runtime>(app: AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Toggle fullscreen mode.
#[tauri::command]
pub fn toggle_fullscreen<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_fullscreen = window.is_fullscreen().unwrap_or(false);
        window
            .set_fullscreen(!is_fullscreen)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_window_state_save_load_roundtrip() {
        let dir = tempdir().unwrap();
        let home = dir.path().to_path_buf();

        let state = WindowState {
            x: 100,
            y: 200,
            width: 1200,
            height: 800,
            is_maximized: false,
        };

        state.save(&home).unwrap();

        let loaded = WindowState::load(&home).unwrap();
        assert_eq!(loaded.x, 100);
        assert_eq!(loaded.y, 200);
        assert_eq!(loaded.width, 1200);
        assert_eq!(loaded.height, 800);
        assert_eq!(loaded.is_maximized, false);
    }

    #[test]
    fn test_window_state_load_nonexistent() {
        let dir = tempdir().unwrap();
        let home = dir.path().to_path_buf();
        assert!(WindowState::load(&home).is_none());
    }

    #[test]
    fn test_window_state_maximized_roundtrip() {
        let dir = tempdir().unwrap();
        let home = dir.path().to_path_buf();

        let state = WindowState {
            x: 50,
            y: 50,
            width: 900,
            height: 600,
            is_maximized: true,
        };

        state.save(&home).unwrap();
        let loaded = WindowState::load(&home).unwrap();
        assert!(loaded.is_maximized);
    }
}
