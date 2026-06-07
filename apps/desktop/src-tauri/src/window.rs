//! Window management — close-to-tray behavior and window controls.

use log::info;
use tauri::{AppHandle, Manager, Runtime, WindowEvent};

/// Configure close-to-tray behavior for the main window.
/// Called during app setup.
pub fn setup_close_to_tray<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let main_window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    // Use the proper Tauri 2 API for intercepting close
    // Note: we need AppHandle to be cloned into the closure, so we take ownership
    main_window.on_window_event(move |event: &WindowEvent| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            info!("Close requested — intercepting to hide to tray");
            // Prevent the app from closing
            api.prevent_close();
            // Hide the window
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
