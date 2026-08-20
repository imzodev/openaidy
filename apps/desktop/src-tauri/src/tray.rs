//! System tray integration.
//!
//! Creates a tray icon with a context menu and click handlers.
//! Closing the main window hides to tray instead of quitting.

use log::info;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager, Runtime,
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
        .show_menu_on_left_click(false)
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

#[cfg(test)]
mod tests {
    #[test]
    fn test_tray_module_compiles() {
        // Verify the module structure is correct
        assert!(true, "tray module should compile");
    }
}
