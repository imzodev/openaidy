/**
 * Control Plane - Shared Types
 * 
 * Normalized result and error shapes for workflow operations.
 * These types are designed to be:
 * - CLI-friendly (easy to render as human-readable output)
 * - JSON-serializable (for future machine-readable output)
 * - Reusable across different admin surfaces
 */

// ============================================================================
// Result Status
// ============================================================================

/**
 * Standard status codes for control-plane operations
 */
export type ControlPlaneStatus = 
  | 'success'
  | 'error'
  | 'not_found'
  | 'invalid'
  | 'unauthorized'
  | 'disabled';

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for control-plane operations
 */
export type ControlPlaneErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'DISABLED'
  | 'ALREADY_EXISTS'
  | 'EXPIRED'
  | 'INTERNAL_ERROR';

/**
 * Normalized error shape for control-plane operations
 */
export interface ControlPlaneError {
  /** Error code for programmatic handling */
  code: ControlPlaneErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional error context */
  details?: Record<string, unknown>;
}

/**
 * Create a normalized error
 */
export function createError(
  code: ControlPlaneErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ControlPlaneError {
  return { code, message, ...(details && { details }) };
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Base result shape for all control-plane operations
 */
export interface ControlPlaneResult<T = void> {
  /** Operation status */
  status: ControlPlaneStatus;
  /** Result data (if successful) */
  data?: T;
  /** Error information (if failed) */
  error?: ControlPlaneError;
}

/**
 * Create a successful result
 */
export function success<T>(data?: T): ControlPlaneResult<T> {
  return { status: 'success', ...(data !== undefined && { data }) };
}

/**
 * Create an error result
 */
export function failure(
  status: Exclude<ControlPlaneStatus, 'success'>,
  error: ControlPlaneError,
): ControlPlaneResult<never> {
  return { status, error };
}

// ============================================================================
// Bootstrap Admin Types
// ============================================================================

/**
 * Bootstrap admin token status
 */
export type BootstrapAdminTokenStatus =
  | 'valid'
  | 'disabled'
  | 'missing'
  | 'malformed'
  | 'invalid'
  | 'expired';

/**
 * Bootstrap admin token data
 */
export interface BootstrapAdminTokenData {
  clientId: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
}

/**
 * Bootstrap admin inspection result
 */
export interface BootstrapAdminInspectResult {
  status: BootstrapAdminTokenStatus;
  tokenPath: string;
  enabled: boolean;
  token?: BootstrapAdminTokenData;
  error?: string;
}

/**
 * Bootstrap admin validate result
 */
export interface BootstrapAdminValidateResult {
  valid: boolean;
  status: BootstrapAdminTokenStatus;
  clientId?: string;
  expiresAt?: string;
  error?: string;
}

// ============================================================================
// Pairing Types
// ============================================================================

/**
 * Pairing request status
 */
export type PairingRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

/**
 * Pairing request data
 */
export interface PairingRequestData {
  requestId: string;
  pairingCode: string;
  deviceName: string;
  deviceType: string;
  capabilities: string[];
  status: PairingRequestStatus;
  requestedAt: number;
  expiresAt: number;
  approvedAt?: number;
  approvedBy?: string;
  deniedAt?: number;
  deniedBy?: string;
  nodeId?: string;
}

/**
 * Device list filters
 */
export interface DeviceListFilters {
  status?: PairingRequestStatus;
  limit?: number;
}

/**
 * Pairing approval options
 */
export interface PairingApprovalOptions {
  requestId: string;
  approvedBy: string;
  scopes?: string[];
}

/**
 * Pairing denial options
 */
export interface PairingDenialOptions {
  requestId: string;
  deniedBy: string;
  reason?: string;
}

/**
 * Pairing approval result
 */
export interface PairingApprovalResult {
  requestId: string;
  status: 'approved';
  nodeId: string;
  token: string;
  scopes: string[];
  deviceName: string;
}

/**
 * Pairing denial result
 */
export interface PairingDenialResult {
  requestId: string;
  status: 'denied';
  deviceName: string;
}

// ============================================================================
// Workflow Options
// ============================================================================

/**
 * Base options for all control-plane workflows
 */
export interface WorkflowOptions {
  /** Logger instance for workflow operations */
  logger?: {
    info: (msg: string, data?: Record<string, unknown>) => void;
    warn: (msg: string, data?: Record<string, unknown>) => void;
    error: (msg: string, data?: Record<string, unknown>) => void;
    debug: (msg: string, data?: Record<string, unknown>) => void;
  };
}

/**
 * Bootstrap admin workflow options
 */
export interface BootstrapAdminWorkflowOptions extends WorkflowOptions {
  /** Whether bootstrap-admin is enabled */
  enabled: boolean;
  /** Path to token file */
  tokenPath: string;
  /** JWT secret for token validation */
  jwtSecret: string;
}

/**
 * Pairing workflow options
 */
export interface PairingWorkflowOptions extends WorkflowOptions {
  /** Pairing service instance */
  pairingService: {
    getPendingRequests: () => Array<PairingRequestData>;
    getAllRequests: () => Array<PairingRequestData>;
    getRequest: (id: string) => PairingRequestData | undefined;
    approveRequest: (id: string, by: string, scopes?: string[]) => Promise<PairingRequestData | null>;
    denyRequest: (id: string, by: string) => PairingRequestData | null;
  };
}
