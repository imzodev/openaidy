# Task 04: Credential Storage (Keychain)

## Objective

Store OpenAidy API keys and secrets in the OS-native credential manager (macOS Keychain, Linux libsecret, Windows Credential Locker) instead of environment variables or config files. The Tauri backend reads from keychain and injects credentials as env vars when spawning the server.

## Success Criteria

1. `keychain.rs` provides `store()`, `get()`, `delete()`, `list()` operations
2. API keys are stored under the `openaidy` service name in the OS keychain
3. Credentials are read at startup and injected as env vars into the server subprocess
4. Frontend can trigger credential save via Tauri IPC command
5. All keychain operations are error-handled gracefully (no panics)

## Reused Components

None — this is a new Tauri backend component.

## OS Keychain Libraries

| OS      | Library               | Rust Crate                        |
| ------- | --------------------- | --------------------------------- |
| macOS   | Keychain Services API | `security-framework` or `keyring` |
| Linux   | libsecret (GNOME/KDE) | `keyring` (uses libsecret)        |
| Windows | Credential Manager    | `keyring` (uses winapi)           |

The `keyring` crate is the most portable — it handles all three platforms automatically via their native APIs.

## Files to Create/Modify

```
apps/desktop/src-tauri/src/keychain.rs   ← NEW: Full keychain implementation
apps/desktop/src-tauri/src/commands.rs   ← MODIFY: Add IPC commands
apps/desktop/src-tauri/src/main.rs       ← MODIFY: Load credentials at startup
```

## Keychain Entry Format

```
Service: "openaidy"
Account: <provider-name>   (e.g., "openai", "anthropic", "google")
Password: <api-key>
```

For credentials that map to multiple env vars (e.g., `OPENAI_API_KEY`), use the account name as the provider ID and store the value directly.

## Implementation Steps

### Step 4.1: Implement keychain.rs

Create `apps/desktop/src-tauri/src/keychain.rs`:

```rust
//! OS-native credential storage via keyring crate.
//!
//! Stores API keys in:
//!   - macOS:   Keychain Services
//!   - Linux:   libsecret / GNOME Keyring
//!   - Windows: Credential Manager

use keyring::Entry;
use log::{info, warn, error};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE_NAME: &str = "openaidy";

/// Credential record for IPC responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credential {
    pub account: String,
    pub value: String,
}

/// Store a credential in the OS keychain.
#[tauri::command]
pub async fn store_credential(
    account: String,
    value: String,
) -> Result<(), String> {
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
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CredentialsManifest {
    accounts: Vec<String>,
}

impl Default for CredentialsManifest {
    fn default() -> Self {
        Self { accounts: Vec::new() }
    }
}

/// Save credential account name to manifest (called after store).
async fn save_to_manifest(account: &str) -> Result<(), String> {
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

        let content = serde_json::to_string_pretty(&manifest)
            .map_err(|e| e.to_string())?;
        std::fs::write(manifest_path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

### Step 4.2: Wire IPC Commands

Add to `apps/desktop/src-tauri/src/commands.rs`:

```rust
use crate::keychain::{self, Credential};

#[tauri::command]
pub async fn store_credential(
    account: String,
    value: String,
) -> Result<(), String> {
    keychain::store_credential(account.clone(), value).await?;
    keychain::save_to_manifest(&account).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_credential(account: String) -> Result<String, String> {
    keychain::get_credential(account).await
}

#[tauri::command]
pub async fn delete_credential(account: String) -> Result<(), String> {
    keychain::delete_credential(account).await
}

#[tauri::command]
pub async fn list_credentials() -> Result<Vec<String>, String> {
    // Return account names only (not values)
    if let Some(openaidy_home) = dirs::config_dir() {
        let manifest_path = openaidy_home.join("openaidy").join(".credentials");
        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<keychain::CredentialsManifest>(&content) {
                return Ok(manifest.accounts);
            }
        }
    }
    Ok(Vec::new())
}
```

Update `main.rs` to register these commands:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_service_status,
    commands::restart_service,
    commands::stop_service,
    keychain::store_credential,
    keychain::get_credential,
    keychain::delete_credential,
    keychain::list_credentials,
])
```

### Step 4.3: Update Cargo.toml Dependencies

Add to `apps/desktop/src-tauri/Cargo.toml`:

```toml
[dependencies]
keyring = "3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Remove `log` and `env_logger` duplicates if already present from Task 01.

### Step 4.4: Frontend Keychain Integration (Optional)

The frontend can expose a UI for managing API keys using the IPC bridge. Example TypeScript call:

```typescript
// apps/web/src/lib/keychain-bridge.ts
import { invoke } from '@tauri-apps/api/core';

export interface KeychainBridge {
  storeCredential(account: string, value: string): Promise<void>;
  getCredential(account: string): Promise<string>;
  deleteCredential(account: string): Promise<void>;
  listCredentials(): Promise<string[]>;
}

export const keychain: KeychainBridge = {
  async storeCredential(account: string, value: string) {
    await invoke('store_credential', { account, value });
  },
  async getCredential(account: string) {
    return await invoke<string>('get_credential', { account });
  },
  async deleteCredential(account: string) {
    await invoke('delete_credential', { account });
  },
  async listCredentials() {
    return await invoke<string[]>('list_credentials');
  },
};
```

This file lives in `apps/web` — no changes to `apps/server` needed.

## Supported Credentials

| Account Name   | Env Var Injected       | Provider           |
| -------------- | ---------------------- | ------------------ |
| `openai`       | `OPENAI_API_KEY`       | OpenAI             |
| `anthropic`    | `ANTHROPIC_API_KEY`    | Anthropic          |
| `google`       | `GOOGLE_AI_API_KEY`    | Google AI / Vertex |
| `azure-openai` | `AZURE_OPENAI_API_KEY` | Azure OpenAI       |
| `<custom>`     | `<custom>`             | Custom provider    |

## Verification

```bash
# Manually test keychain operations
# macOS
security find-generic-password -s openaidy -a openai
# Linux (requires libsecret)
secret-tool lookup service openaidy account openai
# Windows
cmdkey /list
```

## Risks & Mitigations

| Risk                                               | Mitigation                                          |
| -------------------------------------------------- | --------------------------------------------------- |
| keyring crate fails on Linux without libsecret     | Add `libsecret-1-dev` to Linux install instructions |
| Keychain access denied (macOS permission)          | Document first-launch permission prompt             |
| Credential file deleted but keychain entry remains | Periodic cleanup or versioned manifest              |
| Password too long for macOS Keychain               | Split into chunks or store hashed reference         |
| Multiple concurrent store operations               | Use tokio::sync::Mutex in keychain module           |
