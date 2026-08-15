/**
 * Control Plane - Types
 *
 * Shared result and error types for control-plane workflows.
 * These types are designed to be independent of CLI rendering
 * and suitable for future JSON output.
 */

// ============================================================================
// Workflow Result Types
// ============================================================================

/**
 * Base workflow result - all workflow results extend this.
 */
export type WorkflowResult<T = unknown> = {
  success: boolean;
  data?: T;
  error?: WorkflowError;
};

/**
 * Workflow error shape - normalized for consistent handling.
 */
export type WorkflowError = {
  code: WorkflowErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Standard workflow error codes.
 *
 * These codes are designed to be:
 * - Stable (won't change frequently)
 * - Actionable (can be programmatically handled)
 * - JSON-friendly (suitable for future API responses)
 */
export type WorkflowErrorCode =
  // Bootstrap Admin Errors
  | 'BOOTSTRAP_ADMIN_DISABLED'
  | 'BOOTSTRAP_ADMIN_TOKEN_MISSING'
  | 'BOOTSTRAP_ADMIN_TOKEN_MALFORMED'
  | 'BOOTSTRAP_ADMIN_TOKEN_INVALID'
  | 'BOOTSTRAP_ADMIN_TOKEN_EXPIRED'

  // Pairing Request Errors
  | 'PAIRING_REQUEST_NOT_FOUND'
  | 'PAIRING_REQUEST_NOT_PENDING'
  | 'PAIRING_REQUEST_EXPIRED'
  | 'PAIRING_REQUEST_ALREADY_PROCESSED'

  // General Errors
  | 'INTERNAL_ERROR'
  | 'INVALID_INPUT';

// ============================================================================
// Bootstrap Admin Types
// ============================================================================

/**
 * Bootstrap admin token status.
 */
export type BootstrapAdminTokenStatus =
  | 'disabled'
  | 'missing'
  | 'malformed'
  | 'invalid'
  | 'expired'
  | 'valid';

/**
 * Bootstrap admin token data.
 */
export type BootstrapAdminTokenData = {
  clientId: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

/**
 * Bootstrap admin inspection result.
 */
export type BootstrapAdminInspectResult = WorkflowResult<{
  status: BootstrapAdminTokenStatus;
  tokenPath: string;
  enabled: boolean;
  record?: BootstrapAdminTokenData;
}>;

// ============================================================================
// Pairing Request Types
// ============================================================================

/**
 * Pairing request status.
 */
export type PairingRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired';

/**
 * Pairing request data.
 */
export type PairingRequestData = {
  requestId: string;
  pairingCode: string;
  deviceName: string;
  deviceType: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
  status: PairingRequestStatus;
  requestedAt: number;
  expiresAt: number;
  approvedAt?: number;
  approvedBy?: string;
  deniedAt?: number;
  deniedBy?: string;
  nodeId?: string;
  token?: string;
  scopes?: string[];
};

/**
 * List pairing requests result.
 */
export type ListPairingRequestsResult = WorkflowResult<{
  requests: PairingRequestData[];
  count: number;
}>;

/**
 * Pairing request action result (approve/deny).
 */
export type PairingRequestActionResult = WorkflowResult<PairingRequestData>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a successful workflow result.
 */
export function success<T>(data: T): WorkflowResult<T> {
  return {
    success: true,
    data,
  };
}

/**
 * Create a failed workflow result.
 */
export function failure<T = unknown>(
  code: WorkflowErrorCode,
  message: string,
  details?: Record<string, unknown>,
): WorkflowResult<T> {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
