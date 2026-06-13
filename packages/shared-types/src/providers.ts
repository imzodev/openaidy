/**
 * Provider Connection Types
 *
 * Shared types for provider connection functionality across
 * server, CLI, web, and desktop applications.
 */

// ── Error Types ─────────────────────────────────────────────────────────────

/**
 * Provider not found error
 */
export class ProviderNotFoundError extends Error {
  public readonly providerId: string;

  constructor(providerId: string) {
    super(`Provider ${providerId} not found`);
    this.name = 'ProviderNotFoundError';
    this.providerId = providerId;
  }
}

/**
 * Provider connection error
 */
export class ProviderConnectionError extends Error {
  public readonly providerId: string;
  public readonly isRetryable: boolean;

  constructor(providerId: string, message: string, isRetryable = false) {
    super(message);
    this.name = 'ProviderConnectionError';
    this.providerId = providerId;
    this.isRetryable = isRetryable;
  }
}

/**
 * OAuth flow error
 */
export class OAuthError extends Error {
  public readonly providerId: string;
  public readonly errorCode?: string;

  constructor(message: string, providerId: string, errorCode?: string) {
    super(message);
    this.name = 'OAuthError';
    this.providerId = providerId;
    if (errorCode !== undefined) {
      this.errorCode = errorCode;
    }
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
  method: 'code' | 'auto';
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
 * Connected provider with status (no credentials exposed)
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
 * Device code response for CLI/desktop OAuth flows (RFC 8628).
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

/**
 * Start OAuth request (CLI can set preferCLI flag)
 */
export type StartOAuthRequest = {
  providerId: string;
  preferCLI?: boolean;
};

/**
 * Poll device code request
 */
export type PollDeviceCodeRequest = {
  providerId: string;
  deviceCode: string;
};

/**
 * Reconnect provider request
 */
export type ReconnectProviderRequest = {
  providerId: string;
  authMethod: AuthMethodType;
  apiKey?: string;
};

/**
 * Provider connection list item
 */
export type ProviderConnectionListItem = {
  providerId: string;
  authMethod: AuthMethodType;
  status: ProviderConnectionStatus;
  connectedAt: string;
  lastUsedAt?: string;
  error?: string;
};

/**
 * Resolves the current credential (e.g. an OAuth access token) for
 * a given provider at request time. Returning `null` means "no
 * override — fall back to the SDK default `Authorization` header".
 *
 * Used by the OpenAI-compatible adapter (minimax, etc.) to inject
 * fresh tokens on every outgoing HTTP request, so credentials
 * persisted to `provider_credentials` after server startup actually
 * reach the upstream provider.
 */
export type CredentialProvider = (providerId: string) => Promise<string | null>;

/**
 * Drops any cached credential for the given provider so the next
 * request re-reads it from the source of truth. Called from the
 * credential-write paths (API-key connect, OAuth completion,
 * disconnect) so in-memory caches stay in sync with the DB.
 */
export type CredentialInvalidator = (providerId: string) => void;
