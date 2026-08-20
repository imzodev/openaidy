//! Tauri IPC commands exposed to the frontend.

use crate::keychain;
use crate::service::{ServiceManager, ServiceStatus};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// State wrapper for ServiceManager
pub struct AppState {
    pub service: Arc<ServiceManager>,
}

#[tauri::command]
pub async fn get_service_status(state: State<'_, AppState>) -> Result<ServiceStatus, String> {
    Ok(state.service.status().await)
}

/// Read the spawned server's own bootstrap-admin token back from disk, so
/// the frontend's LoginScreen can pre-fill it. A desktop install has no
/// separate "admin" to hand the user a token out-of-band — the server just
/// creates one on first run and persists it to
/// `<openaidy_home>/credentials/bootstrap-admin.json` (the same file the
/// `openaidy admin token show` CLI command reads). Returns `Ok(None)`
/// rather than an error if the server hasn't created one yet (e.g. this is
/// called before the service has finished its first startup), the file is
/// malformed, or the persisted token has already expired — the frontend
/// just falls back to a blank field either way.
#[tauri::command]
pub async fn get_bootstrap_admin_token(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let status = state.service.status().await;
    let token_path = status
        .openaidy_home
        .join("credentials")
        .join("bootstrap-admin.json");

    let Ok(content) = std::fs::read_to_string(&token_path) else {
        return Ok(None);
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Ok(None);
    };

    // Mirrors the record shape apps/server/src/bootstrap-admin.ts writes
    // (`expiresAt` is a `Date.toISOString()` string). An absent/malformed
    // `expiresAt` is treated as not-expired rather than as a hard failure,
    // to fail open the same way a malformed *file* already does above.
    let expired = parsed
        .get("expiresAt")
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|expires_at| expires_at.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(false);
    if expired {
        return Ok(None);
    }

    Ok(parsed
        .get("token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string()))
}

#[tauri::command]
pub async fn restart_service(app: AppHandle, state: State<'_, AppState>) -> Result<u16, String> {
    // stop() before start(): start() overwrites the manager's `child`
    // handle with the newly spawned process without killing whatever was
    // there before. Without stopping first, a still-running previous
    // server process is simply dropped (no `kill_on_drop`), leaking an
    // orphaned subprocess on every restart.
    state.service.stop().await;
    let creds = keychain::get_all_credentials()
        .await
        .unwrap_or_else(|_| HashMap::new());
    let resource_dir = app.path().resource_dir().ok();
    state.service.start(creds, resource_dir).await
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
