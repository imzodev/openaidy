/**
 * Auth token verify request body
 */
export type AuthVerifyRequest = {
  token: string;
};

/**
 * Auth token verify response on success
 */
export type AuthVerifyResponse =
  | { valid: true; clientId: string; scopes: string[]; expiresAt: string }
  | { valid: false; error: string };

/**
 * API key record (safe to return to clients — no hash, no raw key)
 */
export type ApiKeyRecord = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdBy: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
};

/**
 * Response when creating a new API key (raw key shown once)
 */
export type CreateApiKeyResponse = {
  key: ApiKeyRecord;
  rawKey: string;
};

/**
 * Request body for creating an API key
 */
export type CreateApiKeyRequest = {
  name: string;
  scopes: string[];
  expiresAt?: string;
};

/**
 * API error response shape returned by the server on non-OK responses.
 */
export type ApiError = {
  error: string;
  message?: string;
  sessionId?: string;
};

/**
 * Typed error thrown when an API request returns a non-OK HTTP status.
 * Carries the parsed ApiError payload alongside a human-readable message.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message ?? body.error ?? `Request failed: ${status}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}
