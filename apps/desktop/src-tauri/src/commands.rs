//! Tauri IPC commands exposed to the frontend.

use crate::keychain;
use crate::service::{ServiceManager, ServiceStatus};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

/// State wrapper for ServiceManager
pub struct AppState {
    pub service: Arc<ServiceManager>,
}

#[tauri::command]
pub async fn get_service_status(state: State<'_, AppState>) -> Result<ServiceStatus, String> {
    Ok(state.service.status().await)
}

#[tauri::command]
pub async fn restart_service(state: State<'_, AppState>) -> Result<u16, String> {
    let creds = keychain::get_all_credentials()
        .await
        .unwrap_or_else(|_| HashMap::new());
    state.service.start(creds).await
}

#[tauri::command]
pub async fn stop_service(state: State<'_, AppState>) -> Result<(), String> {
    state.service.stop().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_state_struct_exists() {
        // AppState is a simple wrapper, just verify it can be instantiated conceptually
        // The actual service field requires a real ServiceManager which needs async context
        let _ = format!("{:?}", std::mem::size_of::<AppState>());
    }
}
