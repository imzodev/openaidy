//! OS-native credential storage via keyring crate.
//!
//! Stores API keys in:
//!   - macOS:   Keychain Services
//!   - Linux:   libsecret / GNOME Keyring
//!   - Windows: Credential Manager

use keyring::Entry;
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE_NAME: &str = "openaidy";

/// Credential record for IPC responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct Credential {
    pub account: String,
    pub value: String,
}

/// Store a credential in the OS keychain.
#[tauri::command]
#[allow(dead_code)]
pub async fn store_credential(account: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &account)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry
        .set_password(&value)
        .map_err(|e| format!("Failed to store credential '{}': {}", account, e))?;

    info!("Stored credential: {}", account);
    Ok(())
}

/// Retrieve a credential from the OS keychain.
#[tauri::command]
pub async fn get_credential(account: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &account)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry
        .get_password()
        .map_err(|e| format!("Failed to get credential '{}': {}", account, e))
}

/// Delete a credential from the OS keychain.
#[tauri::command]
#[allow(dead_code)]
pub async fn delete_credential(account: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &account)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete credential '{}': {}", account, e))?;

    info!("Deleted credential: {}", account);
    Ok(())
}

/// List all credential account names (not values) stored under openaidy service.
#[tauri::command]
#[allow(dead_code)]
pub async fn list_credentials() -> Result<Vec<String>, String> {
    // Note: keyring doesn't support listing without platform-specific APIs.
    // Maintain a manifest file at OPENAIDY_HOME/.credentials to track stored keys.
    // This is stored as JSON in the config dir, not the keychain.
    Ok(Vec::new()) // TODO: implement via manifest
}

/// Load all credentials as a HashMap (for injecting into server env).
/// This does NOT expose values to the frontend — only to the service starter.
pub async fn get_all_credentials() -> Result<HashMap<String, String>, String> {
    let mut creds = HashMap::new();

    // Load from manifest if it exists
    if let Some(openaidy_home) = dirs::config_dir() {
        let manifest_path = openaidy_home.join("openaidy").join(".credentials");
        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<CredentialsManifest>(&content) {
                for account in &manifest.accounts {
                    if let Ok(value) = get_credential(account.clone()).await {
                        // Map account name to env var convention
                        let env_key = match account.as_str() {
                            "openai" => "OPENAI_API_KEY",
                            "anthropic" => "ANTHROPIC_API_KEY",
                            "google" => "GOOGLE_AI_API_KEY",
                            "azure-openai" => "AZURE_OPENAI_API_KEY",
                            name => name, // use as-is
                        };
                        creds.insert(env_key.to_string(), value);
                    }
                }
            }
        }
    }

    // Also check common provider env var conventions directly
    // (for credentials stored under different account names)
    let common_accounts = [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_AI_API_KEY",
        "AZURE_OPENAI_API_KEY",
    ];

    for account in common_accounts {
        if !creds.contains_key(account) {
            if let Ok(value) = get_credential(account.to_string()).await {
                creds.insert(account.to_string(), value);
            }
        }
    }

    info!("Loaded {} credentials from keychain", creds.len());
    Ok(creds)
}

/// Manifest file tracking which credentials are stored.
/// Stored at ~/.config/openaidy/.credentials
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CredentialsManifest {
    accounts: Vec<String>,
}

/// Save credential account name to manifest (called after store).
#[allow(dead_code)]
pub async fn save_to_manifest(account: &str) -> Result<(), String> {
    if let Some(openaidy_home) = dirs::config_dir() {
        let config_dir = openaidy_home.join("openaidy");
        std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        let manifest_path = config_dir.join(".credentials");

        let mut manifest = CredentialsManifest::default();
        if manifest_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                manifest = serde_json::from_str(&content).unwrap_or_default();
            }
        }

        if !manifest.accounts.contains(&account.to_string()) {
            manifest.accounts.push(account.to_string());
        }

        let content = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(manifest_path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_store_and_get_credential() {
        // Use a test account name with timestamp to avoid collisions
        let test_account = format!(
            "test-account-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        );
        let test_value = "test-secret-value";

        // Store the credential
        let store_result = store_credential(test_account.clone(), test_value.to_string()).await;
        assert!(
            store_result.is_ok(),
            "Failed to store credential: {:?}",
            store_result.err()
        );

        // Retrieve it
        let get_result = get_credential(test_account.clone()).await;
        assert!(
            get_result.is_ok(),
            "Failed to get credential: {:?}",
            get_result.err()
        );
        assert_eq!(get_result.unwrap(), test_value);

        // Cleanup
        let _ = delete_credential(test_account).await;
    }

    #[tokio::test]
    async fn test_delete_credential() {
        let test_account = format!(
            "test-delete-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
        );
        let test_value = "delete-test-value";

        // Store first
        store_credential(test_account.clone(), test_value.to_string())
            .await
            .unwrap();

        // Delete
        let delete_result = delete_credential(test_account.clone()).await;
        assert!(
            delete_result.is_ok(),
            "Failed to delete credential: {:?}",
            delete_result.err()
        );

        // Verify it's gone (expect error)
        let get_result = get_credential(test_account).await;
        assert!(get_result.is_err(), "Credential should have been deleted");
    }

    #[test]
    fn test_credential_struct_serialization() {
        let cred = Credential {
            account: "test".to_string(),
            value: "secret".to_string(),
        };
        let json = serde_json::to_string(&cred).unwrap();
        let parsed: Credential = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.account, "test");
        assert_eq!(parsed.value, "secret");
    }

    #[test]
    fn test_credentials_manifest_default() {
        let manifest = CredentialsManifest::default();
        assert!(manifest.accounts.is_empty());
    }

    #[test]
    fn test_credentials_manifest_serialization() {
        let manifest = CredentialsManifest {
            accounts: vec!["openai".to_string(), "anthropic".to_string()],
        };
        let json = serde_json::to_string(&manifest).unwrap();
        let parsed: CredentialsManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.accounts.len(), 2);
        assert_eq!(parsed.accounts[0], "openai");
    }

    #[test]
    fn test_service_name_constant() {
        assert_eq!(SERVICE_NAME, "openaidy");
    }
}
