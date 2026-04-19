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
