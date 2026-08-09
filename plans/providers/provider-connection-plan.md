# Provider Connection Implementation Plan

> **Goal:** Enable users to connect to AI providers (OpenAI, Anthropic, Google, etc.) via 1-click OAuth or API key input across CLI, Web UI, API, and Desktop.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Applications                       │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │    CLI   │  │   Web    │  │   API    │  │ Desktop  │       │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
└────────┼────────────┼────────────┼────────────┼───────────────┘
         │            │            │            │
         └────────────┴─────┬──────┴────────────┘
                           │
                    ┌──────▼──────┐
                    │  SDK Layer  │
                    │ (client.ts) │
                    └──────┬──────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                    Server App                                    │
│   ┌─────────────────────▼─────────────────────┐                │
│   │           Provider Connection Routes        │                │
│   │  • GET  /api/providers                      │                │
│   │  • GET  /api/providers/:id                 │                │
│   │  • GET  /api/providers/:id/auth            │                │
│   │  • POST /api/providers/:id/connect         │                │
│   │  • POST /api/providers/:id/oauth/start    │                │
│   │  • GET  /api/providers/:id/oauth/callback  │                │
│   └─────────────────────┬─────────────────────┘                │
│                         │                                       │
│   ┌─────────────────────▼─────────────────────┐                │
│   │         Provider Service Layer             │                │
│   │  • ProviderService (connection management)  │                │
│   │  • OAuthService (flow orchestration)       │                │
│   │  • CredentialsService (secure storage)     │                │
│   └─────────────────────┬─────────────────────┘                │
│                         │                                       │
│   ┌─────────────────────▼─────────────────────┐                │
│   │         Provider Registry                 │                │
│   │  • Uses @openaidy/providers package       │                │
│   │  • ProviderProfile instances               │                │
│   │  • Hook system for provider-specific logic │                │
│   └────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                    Database                                       │
│   ┌─────────────────────▼─────────────────────┐                │
│   │         Provider Credentials Table        │                │
│   │  • Per-workspace provider configurations  │                │
│   │  • Encrypted credential storage           │                │
│   │  • Connection status tracking             │                │
│   └────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Shared Types & Interfaces

### 1.1 Create `packages/shared-types/src/providers.ts`

**Location:** `packages/shared-types/src/providers.ts`

**Purpose:** Centralize all provider connection types that are shared across packages (server, CLI, web, etc.)

```typescript
// ── Error Types ─────────────────────────────────────────────────────────────

/**
 * Provider not found error
 */
export class ProviderNotFoundError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider ${providerId} not found`);
    this.name = 'ProviderNotFoundError';
  }
}

/**
 * Provider connection error
 */
export class ProviderConnectionError extends Error {
  constructor(
    public readonly providerId: string,
    message: string,
    public readonly isRetryable = false,
  ) {
    super(message);
    this.name = 'ProviderConnectionError';
  }
}

/**
 * OAuth flow error
 */
export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

// ── Auth Methods ─────────────────────────────────────────────────────────────

/**
 * Supported authentication methods for provider connections
 */
export type AuthMethodType = 'api_key' | 'oauth' | 'device_code';

/**
 * API Key authentication method
 */
export type ApiKeyAuthMethod = {
  type: 'api_key';
  label: string;
};

/**
 * OAuth 2.0 authentication method
 */
export type OAuthAuthMethod = {
  type: 'oauth';
  label: string;
  method: 'code' | 'auto'; // code = manual entry, auto = callback
  authorizationUrl?: string;
  scopes?: string[];
};

/**
 * Device code flow authentication method (for CLI/desktop)
 */
export type DeviceCodeAuthMethod = {
  type: 'device_code';
  label: string;
  deviceAuthUrl?: string;
  scopes?: string[];
};

export type AuthMethod =
  | ApiKeyAuthMethod
  | OAuthAuthMethod
  | DeviceCodeAuthMethod;

// ── Connection Status ─────────────────────────────────────────────────────────

/**
 * Provider connection status
 */
export type ProviderConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Detailed connection state for UI display
 */
export type ProviderConnectionState = {
  status: ProviderConnectionStatus;
  error?: string;
  lastConnectedAt?: string;
  authMethod?: AuthMethodType;
};

// ── Provider Info ──────────────────────────────────────────────────────────────

/**
 * Public provider information for connection UI.
 * Extends ProviderPreset with connection-specific fields.
 * Import ProviderPreset from './providers-preset' for base provider data.
 */
export type ProviderInfo = {
  /** Unique provider identifier (e.g., 'openai', 'anthropic') */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Short description for UI display */
  description?: string;
  /** Icon class or identifier for UI */
  icon: string;
  /** Vendor family for adapter selection */
  vendorFamily: 'openai-compatible' | 'anthropic' | 'gemini';
  /** Signup/registration URL */
  signupUrl?: string;
  /** Link to provider documentation */
  documentationUrl?: string;
  /** Available authentication methods for this provider */
  availableAuthMethods: AuthMethod[];
  /** Whether this provider is already connected in current workspace */
  isConnected: boolean;
  /** Current connection status (if connected) */
  connectionStatus?: ProviderConnectionStatus;
};

/**
 * Connected provider with status (includes sensitive data path, not credentials)
 */
export type ConnectedProvider = {
  providerId: string;
  workspaceId: string;
  status: ProviderConnectionStatus;
  authMethod: AuthMethodType;
  connectedAt: string;
  lastUsedAt?: string;
  error?: string;
};

// ── OAuth Flow Types ───────────────────────────────────────────────────────────

/**
 * Device code response for CLI/desktop OAuth flows.
 * Used when provider supports device code authorization (RFC 8628).
 */
export type DeviceCodeResponse = {
  /** Device verification code - user enters this on verificationUrl */
  deviceCode: string;
  /** User code displayed on verification page */
  userCode: string;
  /** URL user visits to complete authorization */
  verificationUrl: string;
  /** Seconds until device code expires */
  expiresIn: number;
  /** Seconds between polling requests */
  interval: number;
};

/**
 * OAuth authorization initiation response
 */
export type OAuthStartResponse = {
  /** Authorization URL for browser-based OAuth (web/desktop) */
  authorizationUrl: string;
  /** Device code info for CLI (if provider supports device code flow) */
  deviceCode?: DeviceCodeResponse;
  /** State parameter for CSRF protection */
  state: string;
};

/**
 * OAuth callback query parameters
 */
export type OAuthCallbackParams = {
  providerId: string;
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

/**
 * OAuth completion result
 */
export type OAuthCompleteResult = {
  success: boolean;
  providerId: string;
  error?: string;
};

// ── API Request/Response Types ────────────────────────────────────────────────

/**
 * Connect provider request (API key)
 */
export type ConnectProviderRequest = {
  providerId: string;
  apiKey: string;
};

/**
 * Connect provider response
 */
export type ConnectProviderResponse = {
  success: boolean;
  provider?: ConnectedProvider;
  error?: string;
};

/**
 * Provider auth methods response
 */
export type ProviderAuthMethodsResponse = {
  providerId: string;
  methods: AuthMethod[];
};
```

### 1.2 Export from `packages/shared-types/src/index.ts`

```typescript
// Add to existing exports
export * from './providers';
```

---

## Phase 2: Provider Registry Enhancement

### 2.1 Extend `packages/providers/src/types.ts`

Add connection-related methods to `ProviderProfile`:

```typescript
// Add to ProviderProfile class

/**
 * Return the available authentication methods for this provider.
 * Override in subclass to define auth methods.
 */
getAvailableAuthMethods(): AuthMethod[] {
  // Default: API key only
  return [{ type: 'api_key', label: 'API Key' }];
}

/**
 * Validate API key by making a health check call.
 * Override in subclass for provider-specific validation.
 */
async validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(`${this.getBaseUrl()}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    return { valid: response.ok };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

/**
 * Return the OAuth authorization URL for this provider.
 * Override in subclass to provide provider-specific OAuth URL.
 */
getOAuthAuthorizationUrl(scopes?: string[]): string | undefined {
  return undefined;  // Override in OAuth-enabled providers
}

/**
 * Exchange authorization code for tokens.
 * Override in subclass for provider-specific token exchange.
 */
async exchangeOAuthCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; error?: string }> {
  return { accessToken: '', error: 'OAuth not supported' };
}

/**
 * Get device code info for CLI/desktop OAuth flows.
 * Return undefined if provider doesn't support device code flow.
 */
getDeviceCodeInfo(): DeviceCodeResponse | undefined {
  return undefined;  // Override in providers that support device code
}

/**
 * Poll for device code authorization completion.
 * Return { pending: true } while waiting, { accessToken } when complete,
 * or { error } when failed.
 */
async pollDeviceCodeAuth(deviceCode: string): Promise<{
  pending?: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}> {
  return { error: 'Device code flow not supported' };
}

/**
 * Get the signup/registration URL for this provider.
 */
getSignupUrl(): string | undefined {
  return this.signupUrl;
}

/**
 * Get the icon identifier for this provider.
 */
getIcon(): string {
  return `bi-${this.id}`;
}
```

### 2.2 Add Provider-specific Profiles

Create profile files for major providers that support OAuth:

**`packages/providers/src/openai/index.ts`:**

```typescript
import { ProviderProfile } from '../types';
import type { AuthMethod, DeviceCodeResponse, HookContext } from '../hooks';
import { registry } from '../registry';

export class OpenAIProfile extends ProviderProfile {
  constructor() {
    super({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      displayName: 'OpenAI',
      description: 'GPT models including GPT-4 and o-series',
      signupUrl: 'https://platform.openai.com/api-keys',
      auth: { type: 'oauth' },
      vendorFamily: 'openai-compatible',
      models: [
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          capabilities: [
            'text_generation',
            'streaming',
            'tool_calls',
            'vision',
          ],
        },
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o Mini',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
        },
        {
          id: 'o4-mini',
          name: 'o4 Mini',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
        },
        {
          id: 'o3',
          name: 'o3',
          capabilities: ['text_generation', 'streaming', 'tool_calls'],
        },
      ],
    });
  }

  getAvailableAuthMethods(): AuthMethod[] {
    return [
      { type: 'api_key', label: 'API Key' },
      { type: 'oauth', label: 'OAuth 2.0', method: 'auto' },
      { type: 'device_code', label: 'Device Code (CLI)' },
    ];
  }

  getOAuthAuthorizationUrl(scopes?: string[]): string {
    const defaultScopes = ['model:read', 'assistant:read', 'assistant:write'];
    const scopeStr = (scopes ?? defaultScopes).join(' ');
    return `https://oauth.openai.com/authorize?scope=${encodeURIComponent(scopeStr)}`;
  }

  async exchangeOAuthCode(
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
  }> {
    try {
      const response = await fetch('https://oauth.openai.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.OPENAI_CLIENT_ID ?? '',
          client_secret: process.env.OPENAI_CLIENT_SECRET ?? '',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return {
          accessToken: '',
          error: error.error_description ?? 'Token exchange failed',
        };
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      return { accessToken: '', error: String(error) };
    }
  }

  getDeviceCodeInfo(): DeviceCodeResponse {
    // OpenAI supports device code flow
    return {
      deviceCode: '', // Filled by server when calling device code endpoint
      userCode: '',
      verificationUrl: 'https://oauth.openai.com/device',
      expiresIn: 300,
      interval: 5,
    };
  }

  async pollDeviceCodeAuth(deviceCode: string): Promise<{
    pending?: boolean;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    error?: string;
  }> {
    try {
      const response = await fetch('https://oauth.openai.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: process.env.OPENAI_CLIENT_ID ?? '',
          client_secret: process.env.OPENAI_CLIENT_SECRET ?? '',
          device_code: deviceCode,
        }),
      });

      const data = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
      };

      if (data.error === 'authorization_pending') {
        return { pending: true };
      }

      if (data.error) {
        return { error: data.error };
      }

      return {
        accessToken: data.access_token ?? '',
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      return { error: String(error) };
    }
  }
}

// Register at module level
registry.register(new OpenAIProfile());
```

**`packages/providers/src/anthropic/index.ts`:**

```typescript
// Similar OAuth implementation for Anthropic
```

---

## Phase 3: Server Implementation

### 3.1 Database Schema

**`packages/db/drizzle/provider-credentials.sql`:**

```sql
CREATE TABLE provider_credentials (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,  -- e.g., 'openai', 'anthropic'
  auth_method TEXT NOT NULL,  -- 'api_key', 'oauth', 'device_code'
  encrypted_credentials TEXT NOT NULL,  -- encrypted API key or OAuth tokens
  status TEXT NOT NULL DEFAULT 'connected',  -- 'connected', 'error', 'disconnected'
  last_used_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  time_deleted TEXT,

  UNIQUE(workspace_id, provider_id)
);

CREATE INDEX idx_provider_credentials_workspace ON provider_credentials(workspace_id);
CREATE INDEX idx_provider_credentials_provider ON provider_credentials(provider_id);
```

### 3.2 Provider Credentials Repository

**`packages/db/src/repositories/provider-credentials.ts`:**

```typescript
export class ProviderCredentialsRepository {
  /**
   * Store encrypted credentials for a provider
   */
  async upsert(
    workspaceId: string,
    providerId: string,
    authMethod: AuthMethodType,
    encryptedCredentials: string,
  ): Promise<ProviderCredential> {
    // Implementation
  }

  /**
   * Get credentials for a provider in a workspace
   */
  async findByWorkspaceAndProvider(
    workspaceId: string,
    providerId: string,
  ): Promise<ProviderCredential | null> {
    // Implementation
  }

  /**
   * List all connected providers for a workspace
   */
  async listByWorkspace(workspaceId: string): Promise<ProviderCredential[]> {
    // Implementation
  }

  /**
   * Delete credentials (disconnect)
   */
  async delete(workspaceId: string, providerId: string): Promise<boolean> {
    // Implementation
  }

  /**
   * Update last used timestamp
   */
  async updateLastUsed(id: string): Promise<void> {
    // Implementation
  }
}
```

### 3.2.1 Encryption Service

**`apps/server/src/lib/encryption.ts`:**

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encryption service for secure credential storage.
 * Uses AES-256-GCM with workspace-derived keys.
 */
export class EncryptionService {
  private masterKey: Buffer;

  constructor(masterKey: string) {
    // In production, master key should come from secure vault (e.g., AWS KMS, GCP Secret Manager)
    this.masterKey = Buffer.from(masterKey, 'hex');
  }

  /**
   * Derive workspace-specific encryption key from master key
   */
  private async deriveKey(workspaceId: string): Promise<Buffer> {
    const salt = Buffer.from(workspaceId, 'utf8');
    return (await scryptAsync(this.masterKey, salt, KEY_LENGTH)) as Buffer;
  }

  /**
   * Encrypt plaintext for storage
   */
  async encrypt(plaintext: string, workspaceId: string): Promise<string> {
    const key = await this.deriveKey(workspaceId);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted (all base64)
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt ciphertext from storage
   */
  async decrypt(ciphertext: string, workspaceId: string): Promise<string> {
    const key = await this.deriveKey(workspaceId);
    const [ivB64, authTagB64, encryptedB64] = ciphertext.split(':');

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf8');
  }
}

// Singleton instance - initialize from environment/secret manager
let encryptionService: EncryptionService | null = null;

export function getEncryptionService(): EncryptionService {
  if (!encryptionService) {
    const masterKey = process.env.CREDENTIALS_MASTER_KEY;
    if (!masterKey) {
      throw new Error('CREDENTIALS_MASTER_KEY environment variable not set');
    }
    encryptionService = new EncryptionService(masterKey);
  }
  return encryptionService;
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 3.2.2 Auth Middleware Helper

**`apps/server/src/lib/auth-workspace.ts`:**

```typescript
import type { FastifyRequest } from 'fastify';

/**
 * Extract workspace ID from authenticated request.
 * Works with both JWT session and API key auth.
 */
export function getWorkspaceId(request: FastifyRequest): string {
  // Option 1: From session/jwt claims (web/desktop auth)
  if (request.user && 'workspaceId' in request.user) {
    return request.user.workspaceId as string;
  }

  // Option 2: From API key context (CLI/server-to-server)
  if (request.apiKeyContext && 'workspaceId' in request.apiKeyContext) {
    return request.apiKeyContext.workspaceId as string;
  }

  throw new Error('Could not determine workspace ID from request');
}

/**
 * Assert user has admin role for provider management
 */
export function assertAdmin(request: FastifyRequest): void {
  const role = request.user?.role ?? request.apiKeyContext?.role;
  if (role !== 'admin') {
    throw new Error('Admin role required for provider management');
  }
}
```

### 3.3 Provider Service

**`apps/server/src/providers/service.ts`:**

```typescript
export class ProviderService {
  constructor(
    private registry: ProviderRegistry,
    private credentialsRepo: ProviderCredentialsRepository,
    private encryption: EncryptionService,
  ) {}

  /**
   * List available providers with their auth methods
   */
  listAvailableProviders(): ProviderInfo[] {
    return this.registry.list().map((profile) => ({
      id: profile.id,
      name: profile.name,
      displayName: profile.displayName ?? profile.name,
      description: profile.description,
      icon: `bi-${profile.id}`, // Map to icon
      vendorFamily: profile.vendorFamily ?? 'openai-compatible',
      signupUrl: profile.signupUrl,
      availableAuthMethods: profile.getAvailableAuthMethods(),
    }));
  }

  /**
   * Get auth methods for a specific provider
   */
  async getAuthMethods(providerId: string): Promise<AuthMethod[]> {
    const profile = this.registry.get(providerId);
    if (!profile) {
      throw new Error(`Provider ${providerId} not found`);
    }
    return profile.getAvailableAuthMethods();
  }

  /**
   * Connect provider with API key
   */
  async connectWithApiKey(
    workspaceId: string,
    providerId: string,
    apiKey: string,
  ): Promise<ConnectProviderResponse> {
    const profile = this.registry.get(providerId);
    if (!profile) {
      return { success: false, error: `Provider ${providerId} not found` };
    }

    // Validate API key
    const validation = await profile.validateApiKey(apiKey);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid API key' };
    }

    // Encrypt and store credentials
    const encrypted = await this.encryption.encrypt(apiKey);
    const credential = await this.credentialsRepo.upsert(
      workspaceId,
      providerId,
      'api_key',
      encrypted,
    );

    return {
      success: true,
      provider: {
        providerId,
        workspaceId,
        status: 'connected',
        authMethod: 'api_key',
        connectedAt: credential.createdAt,
      },
    };
  }

  /**
   * Start OAuth flow
   */
  async startOAuthFlow(
    providerId: string,
    redirectUri: string,
  ): Promise<OAuthStartResponse> {
    const profile = this.registry.get(providerId);
    if (!profile) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const authUrl = profile.getOAuthAuthorizationUrl();
    if (!authUrl) {
      throw new Error(`Provider ${providerId} does not support OAuth`);
    }

    // Generate state for CSRF protection
    const state = generateState();

    return {
      authorizationUrl: `${authUrl}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
    };
  }

  /**
   * Complete OAuth flow
   * @param workspaceId - Workspace ID from authenticated request
   * @param providerId - Provider identifier
   * @param code - Authorization code from OAuth callback
   * @param redirectUri - Original redirect URI used in authorization request
   */
  async completeOAuthFlow(
    workspaceId: string,
    providerId: string,
    code: string,
    redirectUri: string,
  ): Promise<OAuthCompleteResult> {
    const profile = this.registry.get(providerId);
    if (!profile) {
      return {
        success: false,
        providerId,
        error: `Provider ${providerId} not found`,
      };
    }

    const result = await profile.exchangeOAuthCode(code, redirectUri);
    if (result.error) {
      return { success: false, providerId, error: result.error };
    }

    // Encrypt and store tokens
    const encryptedTokens = await this.encryption.encrypt(
      JSON.stringify({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresIn
          ? Date.now() + result.expiresIn * 1000
          : undefined,
      }),
    );

    await this.credentialsRepo.upsert(
      workspaceId,
      providerId,
      'oauth',
      encryptedTokens,
    );

    return { success: true, providerId };
  }

  /**
   * Start device code flow (for CLI/desktop)
   * @param providerId - Provider identifier
   */
  async startDeviceCodeFlow(providerId: string): Promise<DeviceCodeResponse> {
    const profile = this.registry.get(providerId);
    if (!profile) {
      throw new ProviderNotFoundError(providerId);
    }

    const deviceCodeInfo = profile.getDeviceCodeInfo();
    if (!deviceCodeInfo) {
      throw new ProviderConnectionError(
        providerId,
        `Provider ${providerId} does not support device code flow`,
      );
    }

    // In production, this would call the provider's device code endpoint
    // For now, return structure that profile.getDeviceCodeInfo() provides
    return deviceCodeInfo;
  }

  /**
   * Poll for device code authorization completion (for CLI)
   * @param providerId - Provider identifier
   * @param deviceCode - Device code from startDeviceCodeFlow
   * @param interval - Polling interval in seconds
   * @param maxAttempts - Maximum polling attempts before timeout
   */
  async pollDeviceCodeAuth(
    workspaceId: string,
    providerId: string,
    deviceCode: string,
    interval = 5,
    maxAttempts = 60,
  ): Promise<OAuthCompleteResult> {
    const profile = this.registry.get(providerId);
    if (!profile) {
      throw new ProviderNotFoundError(providerId);
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(interval * 1000);

      const result = await profile.pollDeviceCodeAuth(deviceCode);

      if (result.pending) {
        continue; // Still waiting for user to complete auth
      }

      if (result.error) {
        return { success: false, providerId, error: result.error };
      }

      if (result.accessToken) {
        // Auth successful - store credentials
        const encryptedTokens = await this.encryption.encrypt(
          JSON.stringify({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresAt: result.expiresIn
              ? Date.now() + result.expiresIn * 1000
              : undefined,
          }),
        );

        await this.credentialsRepo.upsert(
          workspaceId,
          providerId,
          'device_code',
          encryptedTokens,
        );
        return { success: true, providerId };
      }
    }

    return {
      success: false,
      providerId,
      error: 'Device code authorization timed out',
    };
  }

  /**
   * Reconnect/refresh an expired or failed provider connection
   * @param workspaceId - Workspace ID
   * @param providerId - Provider identifier
   * @param authMethod - Re-authentication method to use
   */
  async reconnect(
    workspaceId: string,
    providerId: string,
    authMethod: 'api_key' | 'oauth' | 'device_code',
    credentials?: string,
  ): Promise<ConnectProviderResponse> {
    // First disconnect existing connection
    await this.disconnect(workspaceId, providerId);

    // Then reconnect with new credentials
    if (authMethod === 'api_key' && credentials) {
      return this.connectWithApiKey(workspaceId, providerId, credentials);
    }

    // For OAuth/device_code, return error indicating user needs to re-authenticate via UI
    return {
      success: false,
      error: `Please reconnect via UI: openaidy providers connect ${providerId}`,
    };
  }

  /**
   * Disconnect provider
   */
  async disconnect(workspaceId: string, providerId: string): Promise<boolean> {
    return this.credentialsRepo.delete(workspaceId, providerId);
  }

  /**
   * Get decrypted credentials for a provider
   */
  async getCredentials(
    workspaceId: string,
    providerId: string,
  ): Promise<string | null> {
    const credential = await this.credentialsRepo.findByWorkspaceAndProvider(
      workspaceId,
      providerId,
    );
    if (!credential) return null;

    await this.credentialsRepo.updateLastUsed(credential.id);
    return this.encryption.decrypt(credential.encryptedCredentials);
  }
}
```

### 3.4 Provider Routes

**`apps/server/src/routes/providers.ts`:**

```typescript
import { getWorkspaceId, assertAdmin } from '../lib/auth-workspace.js';
import {
  ProviderNotFoundError,
  ProviderConnectionError,
  OAuthError,
} from '@openaidy/shared-types/providers.js';

export const providerRoutes: FastifyPluginAsync<ServerRoutesOptions> = async (
  app,
) => {
  // Middleware to ensure admin auth for all provider routes
  app.addHook('preHandler', async (request) => {
    assertAdmin(request);
  });

  // List available providers (public - no auth required)
  app.get('/providers', async () => {
    return providerService.listAvailableProviders();
  });

  // Get provider auth methods (public)
  app.get('/providers/:providerId/auth', async (request) => {
    const { providerId } = request.params as { providerId: string };
    try {
      return await providerService.getAuthMethods(providerId);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        throw { statusCode: 404, message: error.message };
      }
      throw error;
    }
  });

  // Connect with API key
  app.post<{ Params: { providerId: string }; Body: { apiKey: string } }>(
    '/providers/:providerId/connect',
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request);
      const { providerId } = request.params;
      const { apiKey } = request.body;

      if (!apiKey) {
        reply
          .status(400)
          .send({ success: false, error: 'API key is required' });
        return;
      }

      try {
        const result = await providerService.connectWithApiKey(
          workspaceId,
          providerId,
          apiKey,
        );
        if (!result.success) {
          reply.status(400);
        }
        return result;
      } catch (error) {
        if (error instanceof ProviderNotFoundError) {
          reply.status(404).send({ success: false, error: error.message });
          return;
        }
        if (error instanceof ProviderConnectionError) {
          reply.status(400).send({ success: false, error: error.message });
          return;
        }
        throw error;
      }
    },
  );

  // Start OAuth (returns auth URL for web, or device code for CLI)
  app.post('/providers/:providerId/oauth/start', async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const isCLI = request.headers['x-client-type'] === 'cli';

    try {
      if (isCLI) {
        // Return device code for CLI
        const deviceCode =
          await providerService.startDeviceCodeFlow(providerId);
        return { method: 'device_code', deviceCode };
      } else {
        // Return auth URL for web/desktop
        const redirectUri = `${config.appUrl}/api/providers/${providerId}/oauth/callback`;
        const result = await providerService.startOAuthFlow(
          providerId,
          redirectUri,
        );
        return {
          method: 'oauth',
          authorizationUrl: result.authorizationUrl,
          state: result.state,
        };
      }
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        reply.status(404).send({ error: error.message });
        return;
      }
      if (error instanceof ProviderConnectionError) {
        reply.status(400).send({ error: error.message });
        return;
      }
      throw error;
    }
  });

  // Poll device code auth (for CLI)
  app.post<{ Params: { providerId: string }; Body: { deviceCode: string } }>(
    '/providers/:providerId/oauth/poll',
    async (request, reply) => {
      const workspaceId = getWorkspaceId(request);
      const { providerId } = request.params;
      const { deviceCode } = request.body;

      try {
        const result = await providerService.pollDeviceCodeAuth(
          workspaceId,
          providerId,
          deviceCode,
        );
        return result;
      } catch (error) {
        if (error instanceof ProviderNotFoundError) {
          reply.status(404).send({ success: false, error: error.message });
          return;
        }
        throw error;
      }
    },
  );

  // OAuth callback (web only - redirects to UI)
  app.get('/providers/:providerId/oauth/callback', async (request, reply) => {
    const { providerId, code, state, error } =
      request.query as OAuthCallbackParams;

    // Store result in temporary session/cookie for UI to pick up
    // In production, use encrypted cookie or server-side session
    const workspaceId = getWorkspaceId(request);

    if (error) {
      reply.redirect(
        `${config.appUrl}/settings/providers?error=${encodeURIComponent(error)}&provider=${providerId}`,
      );
      return;
    }

    if (!code) {
      reply.redirect(
        `${config.appUrl}/settings/providers?error=missing_code&provider=${providerId}`,
      );
      return;
    }

    try {
      const redirectUri = `${config.appUrl}/api/providers/${providerId}/oauth/callback`;
      const result = await providerService.completeOAuthFlow(
        workspaceId,
        providerId,
        code,
        redirectUri,
      );

      if (result.success) {
        reply.redirect(
          '/settings/providers?connected=true&provider=' + providerId,
        );
      } else {
        reply.redirect(
          `/settings/providers?error=${encodeURIComponent(result.error ?? 'Unknown error')}&provider=${providerId}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      reply.redirect(
        `/settings/providers?error=${encodeURIComponent(errorMessage)}&provider=${providerId}`,
      );
    }
  });

  // Reconnect/refresh provider
  app.post<{
    Params: { providerId: string };
    Body: { authMethod: AuthMethodType; apiKey?: string };
  }>('/providers/:providerId/reconnect', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { providerId } = request.params;
    const { authMethod, apiKey } = request.body;

    try {
      const result = await providerService.reconnect(
        workspaceId,
        providerId,
        authMethod,
        apiKey,
      );
      return result;
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        reply.status(404).send({ success: false, error: error.message });
        return;
      }
      throw error;
    }
  });

  // Disconnect provider
  app.delete('/providers/:providerId', async (request, reply) => {
    const workspaceId = getWorkspaceId(request);
    const { providerId } = request.params as { providerId: string };

    try {
      const success = await providerService.disconnect(workspaceId, providerId);
      return { success };
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        reply.status(404).send({ success: false, error: error.message });
        return;
      }
      throw error;
    }
  });

  // List connected providers for workspace
  app.get('/providers/connected', async (request) => {
    const workspaceId = getWorkspaceId(request);
    return providerService.listConnectedProviders(workspaceId);
  });
};
```

---

## Phase 4: SDK Client

### 4.1 Create SDK Methods

**`apps/server/src/lib/sdk/providers.ts`:**

```typescript
export class ProviderSDK {
  constructor(private client: ApiClient) {}

  /**
   * List available providers
   */
  async list(): Promise<ProviderInfo[]> {
    return this.client.get('/providers');
  }

  /**
   * Get auth methods for a provider
   */
  async authMethods(providerId: string): Promise<AuthMethod[]> {
    return this.client.get(`/providers/${providerId}/auth`);
  }

  /**
   * Connect with API key
   */
  async connect(
    providerId: string,
    apiKey: string,
  ): Promise<ConnectProviderResponse> {
    return this.client.post(`/providers/${providerId}/connect`, { apiKey });
  }

  /**
   * Start OAuth flow
   */
  async startOAuth(providerId: string): Promise<OAuthStartResponse> {
    return this.client.post(`/providers/${providerId}/oauth/start`);
  }

  /**
   * OAuth callback (handled by server redirect, but available for manual use)
   */
  async completeOAuth(
    providerId: string,
    code: string,
  ): Promise<OAuthCompleteResult> {
    return this.client.get(
      `/providers/${providerId}/oauth/callback?code=${code}`,
    );
  }

  /**
   * Disconnect provider
   */
  async disconnect(providerId: string): Promise<{ success: boolean }> {
    return this.client.delete(`/providers/${providerId}`);
  }

  /**
   * List connected providers
   */
  async connected(): Promise<ConnectedProvider[]> {
    return this.client.get('/providers/connected');
  }
}
```

---

## Phase 5: CLI Commands

### 5.1 Provider Commands

**`packages/cli/src/commands/providers/index.ts`:**

```typescript
export const providerCommands = [
  registerCommand('providers', async (args) => {
    // Show help for provider commands
    if (args.includes('-h') || args.includes('--help')) {
      showProviderHelp();
      return { exitCode: 0 };
    }
    // List all provider commands
    console.log(`
Provider Commands:
  openaidy providers list              List all available providers
  openaidy providers connect <id>      Connect to a provider
  openaidy providers disconnect <id>   Disconnect a provider
  openaidy providers status            Show connection status
  openaidy providers auth <id>         Check auth methods for provider
`);
    return { exitCode: 0 };
  }),
  registerCommand('providers list', async (args) => {
    // List available providers with auth methods
    return providersListHandler(args);
  }),
  registerCommand('providers connect', async (args) => {
    // Interactive or automated connect flow
    return providersConnectHandler(args);
  }),
  registerCommand('providers disconnect', async (args) => {
    // Disconnect a provider
    return providersDisconnectHandler(args);
  }),
  registerCommand('providers status', async (args) => {
    // Show connected providers status
    return providersStatusHandler(args);
  }),
  registerCommand('providers auth', async (args) => {
    // Show auth methods for a provider
    return providersAuthHandler(args);
  }),
];
```

**`packages/cli/src/commands/providers/connect.ts`:**

```typescript
import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

export async function providersConnectHandler(
  args: string[],
): Promise<CommandResult> {
  // Parse arguments
  const providerId = args[0];
  const useApiKey = args.includes('--api-key');
  const useOAuth = args.includes('--oauth');

  // If no provider specified, show interactive picker
  if (!providerId) {
    const selected = await p.select({
      message: 'Select a provider to connect:',
      options: [
        { label: 'OpenAI', value: 'openai' },
        { label: 'Anthropic', value: 'anthropic' },
        { label: 'Google Gemini', value: 'google' },
        { label: 'Groq', value: 'groq' },
        { label: 'DeepSeek', value: 'deepseek' },
      ],
    });
    if (p.isCancel(selected)) {
      return { exitCode: 0 };
    }
    args.unshift(selected as string);
  }

  const [id, ...rest] = args;
  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  // Get available auth methods
  const authMethods = await fetchAuthMethods(id, token.token, config.httpUrl);
  if (!authMethods) {
    p.log.error(`Provider ${id} not found`);
    return { exitCode: 1, error: `Provider ${id} not found` };
  }

  // Determine auth method
  let authMethod: 'api_key' | 'oauth' | 'device_code' = 'api_key';

  if (useApiKey) {
    authMethod = 'api_key';
  } else if (useOAuth || authMethods.some((m) => m.type === 'device_code')) {
    // Prefer device code for CLI
    authMethod = 'device_code';
  } else if (authMethods.some((m) => m.type === 'oauth')) {
    authMethod = 'oauth';
  }

  if (authMethod === 'api_key') {
    return connectWithApiKey(id, config, token.token);
  } else if (authMethod === 'device_code') {
    return connectWithDeviceCode(id, config, token.token);
  } else {
    return connectWithOAuth(id, config, token.token);
  }
}

async function connectWithApiKey(
  providerId: string,
  config: CLIConfig,
  token: string,
): Promise<CommandResult> {
  const apiKey = await p.password({
    message: `Enter API key for ${providerId}:`,
    mask: true,
  });

  if (!apiKey) {
    p.log.error('API key is required');
    return { exitCode: 1, error: 'API key is required' };
  }

  const s = p.spinner();
  s.start('Connecting...');

  try {
    const res = await fetch(
      `${config.httpUrl}/providers/${providerId}/connect`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Client-Type': 'cli',
        },
        body: JSON.stringify({ apiKey }),
      },
    );

    if (!res.ok) {
      s.stop('Failed.');
      const error = await res.json().catch(() => ({ error: res.statusText }));
      p.log.error(`Connection failed: ${error.error ?? res.statusText}`);
      return { exitCode: 1, error: error.error ?? res.statusText };
    }

    s.stop('Connected!');
    p.log.success(`Successfully connected to ${providerId}`);
    return { exitCode: 0 };
  } catch (err) {
    s.stop('Failed.');
    p.log.error(
      `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { exitCode: 1, error: String(err) };
  }
}

async function connectWithDeviceCode(
  providerId: string,
  config: CLIConfig,
  token: string,
): Promise<CommandResult> {
  const s = p.spinner();
  s.start('Starting device code flow...');

  try {
    // Start device code flow
    const startRes = await fetch(
      `${config.httpUrl}/providers/${providerId}/oauth/start`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Client-Type': 'cli',
        },
      },
    );

    if (!startRes.ok) {
      s.stop('Failed.');
      const error = await startRes
        .json()
        .catch(() => ({ error: startRes.statusText }));
      p.log.error(
        `Failed to start device code flow: ${error.error ?? startRes.statusText}`,
      );
      return { exitCode: 1, error: error.error ?? startRes.statusText };
    }

    const { deviceCode } = (await startRes.json()) as {
      deviceCode: DeviceCodeResponse;
    };

    s.stop('Device code received.');
    p.log.info(`
┌─────────────────────────────────────────────────────────┐
│  Visit: ${deviceCode.verificationUrl.padEnd(43)}│
│  Enter code: ${deviceCode.userCode.padEnd(43)}│
└─────────────────────────────────────────────────────────┘
    `);

    // Poll for completion
    s.start('Waiting for authorization...');
    const pollRes = await fetch(
      `${config.httpUrl}/providers/${providerId}/oauth/poll`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Client-Type': 'cli',
        },
        body: JSON.stringify({ deviceCode: deviceCode.deviceCode }),
      },
    );

    if (!pollRes.ok) {
      s.stop('Failed.');
      const error = await pollRes
        .json()
        .catch(() => ({ error: pollRes.statusText }));
      p.log.error(`Polling failed: ${error.error ?? pollRes.statusText}`);
      return { exitCode: 1, error: error.error ?? pollRes.statusText };
    }

    const result = (await pollRes.json()) as {
      success: boolean;
      error?: string;
    };

    if (result.success) {
      s.stop('Connected!');
      p.log.success(`Successfully connected to ${providerId}`);
    } else {
      s.stop('Failed.');
      p.log.error(`Connection failed: ${result.error ?? 'Unknown error'}`);
    }

    return { exitCode: result.success ? 0 : 1, error: result.error };
  } catch (err) {
    s.stop('Failed.');
    p.log.error(
      `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { exitCode: 1, error: String(err) };
  }
}

async function connectWithOAuth(
  providerId: string,
  config: CLIConfig,
  token: string,
): Promise<CommandResult> {
  // For OAuth in CLI, we can either:
  // 1. Use device code (preferred)
  // 2. Show URL and ask for callback code
  // For simplicity, use device code if available
  return connectWithDeviceCode(providerId, config, token);
}
```

---

## Phase 6: Web UI Components

### 6.1 Provider Selection Dialog

**`apps/web/src/components/providers/DialogConnectProvider.tsx`:**

- Provider selection list with icons
- Auth method selection (API key vs OAuth)
- API key input form
- OAuth flow UI (device code display, polling status)
- Error handling and retry

### 6.2 Provider Settings Page

**`apps/web/src/components/providers/SettingsProviders.tsx`:**

- List connected providers
- Connection status indicators
- Disconnect action
- Add new provider button

---

## SOLID Principles Applied

### Single Responsibility Principle (SRP)

- `ProviderCredentialsRepository` - only handles database operations for credentials
- `ProviderService` - handles business logic, delegates to repositories
- Each provider profile class handles only its provider's specific behavior

### Open/Closed Principle (OCP)

- `ProviderProfile` base class is open for extension (subclassing) but closed for modification
- New providers can be added by creating new profile classes without modifying existing code

### Liskov Substitution Principle (LSP)

- All provider profile subclasses can be used interchangeably via the `ProviderProfile` interface
- Auth methods are returned as `AuthMethod` union type, allowing each method to be handled uniformly

### Interface Segregation Principle (ISP)

- `ProviderProfile` has focused methods: `getAvailableAuthMethods()`, `validateApiKey()`, `getOAuthAuthorizationUrl()`
- Large provider interface is split into focused hooks in `@openaidy/providers`

### Dependency Inversion Principle (DIP)

- `ProviderService` depends on `ProviderRegistry` abstraction, not concrete implementations
- Database operations abstracted behind `ProviderCredentialsRepository` interface

---

## Scalability Considerations

1. **Lazy-loaded provider profiles** - Only loaded when needed
2. **Encryption service abstraction** - Easy to swap encryption implementations
3. **Repository pattern** - Easy to add caching, different storage backends
4. **SDK layer** - Client applications only interact with typed SDK, not raw HTTP
5. **Shared types** - Single source of truth for types across all packages

---

## Implementation Order

1. **Phase 1:** Shared types (`packages/shared-types/src/providers.ts`)
2. **Phase 2:** Provider registry enhancement (extend `ProviderProfile`)
3. **Phase 3:** Server implementation (routes, services, repository)
4. **Phase 4:** SDK client methods
5. **Phase 5:** CLI commands
6. **Phase 6:** Web UI components

---

## Files to Create/Modify

### New Files

- `packages/shared-types/src/providers.ts` - Shared types
- `packages/db/drizzle/provider-credentials.sql` - Database schema
- `packages/db/src/repositories/provider-credentials.ts` - Repository
- `apps/server/src/providers/service.ts` - Service layer
- `apps/server/src/routes/providers.ts` - API routes
- `apps/server/src/lib/sdk/providers.ts` - SDK methods
- `packages/cli/src/commands/providers/` - CLI commands
- `apps/web/src/components/providers/` - UI components

### Files to Modify

- `packages/shared-types/src/index.ts` - Export providers
- `packages/providers/src/types.ts` - Add connection methods
- `packages/providers/src/registry.ts` - Add registration helper
- `apps/server/src/app.ts` - Register provider routes
- `apps/server/src/lib/sdk/index.ts` - Export ProviderSDK
- `packages/cli/src/commands/index.ts` - Register provider commands
- `packages/cli/src/lib/sdk.ts` - Add provider methods to CLI SDK
