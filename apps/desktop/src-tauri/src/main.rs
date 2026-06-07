// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod keychain;
mod service;
mod tray;
mod window;

use commands::AppState;
use log::{error, info};
use service::ServiceManager;
use std::sync::Arc;
use window::setup_close_to_tray;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    info!("OpenAidy Desktop v{}", env!("CARGO_PKG_VERSION"));

    // Determine OPENAIDY_HOME
    let openaidy_home = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("openaidy");

    // Create ServiceManager (replaces old ServiceHandle pattern)
    let service_manager = Arc::new(ServiceManager::new(openaidy_home.clone()));

    // Load credentials from keychain (stubbed until Task 04)
    let keychain_creds = keychain::get_all_credentials().await.unwrap_or_default();

    // Start the service using the new ServiceManager
    let port = service_manager
        .start(keychain_creds)
        .await
        .expect("Failed to start core service");

    info!("Core service started on port {port}");

    let app_state = AppState {
        service: service_manager,
    };

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(move |app| {
            info!("Setting up system tray");
            tray::setup_tray(app)?;

            info!("Setting up close-to-tray handler");
            setup_close_to_tray(app.handle().clone())?;

            info!("Tauri setup complete; core service on port {port}");
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
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("Tauri error: {e}");
    }
}
