// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod keychain;
mod service;
mod tray;

use log::{error, info};

fn main() {
    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    info!("Starting OpenAidy Desktop v{}", env!("CARGO_PKG_VERSION"));

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            info!("Tauri app setup complete");

            // Validate that the web dist exists (in dev, the Vite server handles this)
            #[cfg(not(debug_assertions))]
            {
                use tauri::Manager;
                let dist_path = _app.path().resolve(
                    "frontend/dist",
                    _app.config()
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

            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("Tauri runtime error: {e}");
        std::process::exit(1);
    }
}
