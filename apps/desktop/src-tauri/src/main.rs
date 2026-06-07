// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod keychain;
mod service;
mod tray;

use log::{error, info};
use std::sync::Arc;

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

    // Load credentials from keychain (stubbed until Task 04)
    let keychain_creds = keychain::get_all_credentials().await.unwrap_or_default();

    // Start the core service
    let service_handle = service::start_service(openaidy_home.clone(), keychain_creds)
        .await
        .expect("Failed to start core service");

    let port = service_handle.port;
    info!("Core service started on port {port}");

    // Store service handle in app state so it lives for the duration of the app
    let app_handle = Arc::new(service_handle);

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_handle.clone())
        .setup(move |app| {
            info!("Tauri setup complete; core service on port {port}");

            // Validate that the web dist exists (in dev, the Vite server handles this)
            #[cfg(not(debug_assertions))]
            {
                let dist_path = app.path().resolve(
                    "frontend/dist",
                    app.config()
                        .app
                        .as_ref()
                        .unwrap()
                        .windows
                        .first()
                        .map(|w| w.label.as_str())
                        .unwrap_or("main"),
                );
                if !dist_path.exists() {
                    error!("Frontend dist not found at {:?}", dist_path);
                    return Err("Frontend dist not found. Run `pnpm build` first.".into());
                }
            }

            #[cfg(debug_assertions)]
            let _ = app;

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("Tauri error: {e}");
    }

    // Shutdown service on app exit
    service::stop_service().await;
}
