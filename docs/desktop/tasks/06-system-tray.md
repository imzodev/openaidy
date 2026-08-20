# Task 06: System Tray

## Objective

Add a system tray icon with a context menu (macOS menu bar, Linux panel, Windows taskbar notification area). The tray allows the app to run in the background after the window is closed, and provides quick access to common actions.

## Success Criteria

1. Tauri app displays a system tray icon after startup
2. Tray icon menu has: "Open OpenAidy", separator, "Quit"
3. Left-clicking the tray icon opens/restores the main window
4. Closing the main window hides to tray (app keeps running)
5. Tray tooltip shows "OpenAidy" and connection status

## Reused Components

None — this is pure Tauri/Rust UI.

## Files to Create/Modify

```
apps/desktop/src-tauri/src/tray.rs      ← NEW: System tray setup
apps/desktop/src-tauri/src/main.rs       ← MODIFY: wire tray
apps/desktop/src-tauri/src/window.rs     ← NEW: Window-to-tray behavior
```

## Implementation Steps

### Step 6.1: Implement tray.rs

Create `apps/desktop/src-tauri/src/tray.rs`:

```rust
//! System tray integration.
//!
//! Creates a tray icon with a context menu and click handlers.
//! Closing the main window hides to tray instead of quitting.

use log::info;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime,
};

/// Build the tray menu.
/// "Open OpenAidy"  — shows and focuses the main window
/// Separator
/// "Quit"           — exits the application completely
pub fn build_tray_menu<R: Runtime>(app: &App<R>) -> Result<Menu<R>, tauri::Error> {
    let open_item = MenuItem::with_id(app, "open", "Open OpenAidy", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit OpenAidy", true, None::<&str>)?;

    Menu::with_items(app, &[&open_item, &sep, &quit_item])
}

/// Setup the system tray for the application.
pub fn setup_tray<R: Runtime>(app: &App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app)?;

    // Get the app's default icon
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("No default window icon set in tauri.conf.json");

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("OpenAidy")
        .menu_on_left_click(false)  // Right-click for menu, left-click for action
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "open" => {
                    info!("Tray: Open clicked");
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    info!("Tray: Quit clicked");
                    // Stop the service first
                    let _ = app.emit("quit-requested", ());
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click on tray icon: show + focus window
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                info!("Tray icon left-clicked");
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    info!("System tray initialized");
    Ok(())
}

/// Handle the window close event — hide to tray instead of quitting.
pub fn setup_window_close_handler<R: Runtime>(app: &App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app.get_webview_window("main").ok_or("Main window not found")?;

    main_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            info!("Main window close requested — hiding to tray");
            // Prevent the window from closing
            api.prevent_close();
            // Hide the window instead
            // Note: we need the window handle, which we get from the app
        }
    });

    Ok(())
}
```

### Step 6.2: Improve window.rs with proper close-to-tray

The `on_window_event` API changed in Tauri 2. The correct approach uses `WindowEvent::CloseRequested` with `prevent_close()`. Create `apps/desktop/src-tauri/src/window.rs`:

```rust
//! Window management — close-to-tray behavior and window controls.

use log::info;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri::window::CloseRequestedEvent;

/// Configure close-to-tray behavior for the main window.
/// Called during app setup.
pub fn setup_close_to_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    // Use the proper Tauri 2 API for intercepting close
    main_window.on_window_event(move |event: &CloseRequestedEvent| {
        info!("Close requested — intercepting to hide to tray");
        // Prevent the app from closing
        event.prevent();
        // Hide the window
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    });

    info!("Close-to-tray handler registered");
    Ok(())
}

/// Show the main window and bring it to front.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Minimize the main window.
pub fn minimize_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

/// Maximize or unmaximize the main window.
pub async fn toggle_maximize<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

/// Close the main window (hides to tray, does not quit).
pub fn close_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}
```

### Step 6.3: Update main.rs to Wire Everything

Update `apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod service;
mod keychain;
mod tray;
mod commands;
mod window;

use log::{info, error};
use std::sync::Arc;
use tauri::Manager;
use crate::commands::AppState;
use crate::service::ServiceManager;
use crate::window::setup_close_to_tray;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    info!("OpenAidy Desktop v{}", env!("CARGO_PKG_VERSION"));

    let openaidy_home = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("openaidy");

    let keychain_creds = keychain::get_all_credentials().await.unwrap_or_default();
    let service_manager = Arc::new(ServiceManager::new(openaidy_home.clone()));

    let port = service_manager.start(keychain_creds).await
        .expect("Failed to start core service");

    let app_state = AppState { service: service_manager };

    info!("Core service running on port {}", port);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|app| {
            info!("Setting up system tray");
            tray::setup_tray(app)?;

            info!("Setting up close-to-tray handler");
            setup_close_to_tray(app.handle())?;

            info!("Setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_service_status,
            commands::restart_service,
            commands::stop_service,
            keychain::store_credential,
            keychain::get_credential,
            keychain::delete_credential,
            keychain::list_credentials,
            window::show_main_window,
            window::minimize_window,
            window::toggle_maximize,
            window::close_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Step 6.4: Add Window IPC Commands

Update `apps/desktop/src-tauri/src/commands.rs` to expose window controls:

```rust
#[tauri::command]
pub fn show_main_window() {
    window::show_main_window();
}

#[tauri::command]
pub fn minimize_window() {
    window::minimize_window();
}

#[tauri::command]
pub async fn toggle_maximize() -> Result<(), String> {
    // Need to access app handle, so use app-based approach
    Err("Use window bridge in frontend".into())
}
```

Or add these directly to `window.rs` with the `#[tauri::command]` attribute.

### Step 6.5: Tray Icons

The tray needs an icon image. Place `.png` files in `apps/desktop/src-tauri/icons/`:

- `32x32.png` — standard tray icon size on Linux/Windows
- `128x128.png` — macOS retina (2x)
- `icon.icns` — macOS
- `icon.ico` — Windows

**Important:** The icon file path is configured in `tauri.conf.json` under `bundle.icon`. The tray icon uses `app.default_window_icon()`.

For the initial build, you can create a simple colored rectangle PNG using ImageMagick:

```bash
convert -size 32x32 xc:#6366f1 32x32.png
```

## Platform-Specific Behavior

| OS          | Tray Location             | Notes                                                  |
| ----------- | ------------------------- | ------------------------------------------------------ |
| **macOS**   | Menu bar (top right)      | Icon template image recommended (automatic dark/light) |
| **Linux**   | Panel notification area   | Depends on desktop environment (GNOME/KDE)             |
| **Windows** | Taskbar notification area | System tray area near the clock                        |

## macOS Template Icons

On macOS, tray icons should be **template images** (single-color, uses system tint). Mark this in the icon file or Tauri will treat it as a full-color image.

## Verification

| Action                       | Expected Result                       |
| ---------------------------- | ------------------------------------- |
| Click close button on window | Window hides, app stays in tray       |
| Click tray icon              | Window shows and focuses              |
| Right-click tray icon        | Menu appears: "Open OpenAidy", "Quit" |
| Click "Quit" in menu         | App exits, service stopped            |
| Log out / shut down          | Service gracefully stopped            |

## Risks & Mitigations

| Risk                                          | Mitigation                                                |
| --------------------------------------------- | --------------------------------------------------------- |
| No tray icon appears on Linux                 | Ensure `libayatana-appindicator3-dev` is installed        |
| Window hides but service doesn't stop on quit | Explicit `stop_service()` in quit handler                 |
| Multiple tray icons if app started twice      | Single-instance enforcement via port file lock            |
| macOS: icon doesn't change for dark mode      | Use template image (`iconTemplate: true` in Tauri config) |
