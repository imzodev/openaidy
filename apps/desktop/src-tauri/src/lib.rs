mod commands;
mod keychain;
mod service;
mod tray;
mod window;

use commands::AppState;
use log::{error, info};
use service::ServiceManager;
use std::sync::Arc;
use tauri::Manager;
use window::{set_openaidy_home, setup_close_to_tray, WindowState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    info!("OpenAidy Desktop v{}", env!("CARGO_PKG_VERSION"));

    // Determine OPENAIDY_HOME
    let openaidy_home = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("openaidy");

    let service_manager = Arc::new(ServiceManager::new(openaidy_home.clone()));

    let app_state = AppState {
        service: service_manager.clone(),
    };

    // Load saved window state for restoration
    let window_state = WindowState::load(&openaidy_home);

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(move |app| {
            info!("Setting up system tray");
            tray::setup_tray(app)?;

            info!("Setting up close-to-tray handler");
            setup_close_to_tray(app.handle().clone())?;

            // Set openaidy home for window state saving
            set_openaidy_home(openaidy_home.clone());

            // Restore window state if saved
            if let Some(state) = window_state.as_ref() {
                if let Some(window) = app.get_webview_window("main") {
                    if !state.is_maximized {
                        let _ = window.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(state.x, state.y),
                        ));
                        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                            state.width,
                            state.height,
                        )));
                    } else {
                        let _ = window.maximize();
                    }
                }
            }

            // Start the core service in the background rather than
            // blocking window creation on it (it can take up to several
            // seconds, and retries on a contended port on top of that) —
            // the window now appears immediately, and the frontend waits
            // for get_service_status() to report `Running` (or surfaces
            // `Crashed`) before issuing any API call instead of the whole
            // app silently hanging with no window at all for up to 15s, or
            // — on failure — panicking with no UI feedback whatsoever.
            //
            // `resource_dir()` is where a packaged build's bundled copy of
            // apps/server/dist actually lives; it's platform-specific (e.g.
            // inside Contents/Resources on macOS) which is why service.rs
            // needs it passed in rather than deriving it from the
            // executable's own path.
            let resource_dir = app.path().resource_dir().ok();
            let service_manager = service_manager.clone();
            tauri::async_runtime::spawn(async move {
                let keychain_creds = keychain::get_all_credentials().await.unwrap_or_default();
                match service_manager.start(keychain_creds, resource_dir).await {
                    Ok(port) => info!("Core service started on port {port}"),
                    Err(e) => error!("Failed to start core service: {e}"),
                }
            });

            info!("Tauri setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_service_status,
            commands::get_bootstrap_admin_token,
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
            window::toggle_fullscreen,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("Tauri error: {e}");
    }
}
