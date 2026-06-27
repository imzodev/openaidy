/**
 * Addon Service Types
 *
 * Type definitions for the addon service layer.
 */

import type { AddonManifest } from '@openaidy/shared-types';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { SessionMessageService } from '../sessions/service';
import type { AgentRegistry } from '../agents/registry';

// Forward declaration to avoid circular dependency
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AddonsRepository = any;

/**
 * Options for addon proxy routes
 */
export interface AddonProxyRoutesOptions {
  addonService: import('./service').AddonService;
  authMiddleware: AuthMiddleware;
  internalApiBaseUrl: string;
  sessionService?: SessionMessageService;
  agentRegistry?: AgentRegistry;
}

/**
 * Body for invoking an agent through the addon proxy
 */
export interface InvokeAgentBody {
  input: string;
  context?: Record<string, unknown>;
}

/**
 * Proxy request descriptor
 */
export interface ProxyRequest {
  addonId: string;
  permissions: string[];
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Proxy response descriptor
 */
export interface ProxyResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Proxy error descriptor
 */
export interface ProxyError {
  error: string;
  message: string;
  code: string;
}

/**
 * Proxy result (success or failure)
 */
export type ProxyResult =
  | { success: true; response: ProxyResponse }
  | { success: false; error: ProxyError };

/**
 * Result of an addon agent invocation
 */
export type AddonAgentInvokeResult =
  | { ok: true; agentId: string; sessionId: string; message: string }
  | { ok: false; error: { code: string; message: string } };

/**
 * Options for creating an AddonService
 */
export interface AddonServiceOptions {
  /** Database repository for addon addon persistence */
  repository: AddonsRepository;
  /** Manifest validator */
  validator: import('./manifest-validator').ManifestValidator;
  /** JWT secret for token generation */
  jwtSecret: string;
  /** Current OpenAidy version */
  openAidyVersion: string;
}

/**
 * Addon installation request
 */
export interface InstallAddonRequest {
  manifest: AddonManifest;
  installedBy: string;
}

/**
 * Addon installation result
 */
export interface InstallAddonResult {
  addon: import('@openaidy/db').Addon;
  permissions: string[];
  requiresApproval: boolean;
}

/**
 * Enable addon request
 */
export interface EnableAddonRequest {
  addonId: string;
  approvedPermissions: string[];
  approvedBy: string;
}

/**
 * Enable addon result
 */
export interface EnableAddonResult {
  addon: import('@openaidy/db').Addon;
  accessToken: string;
}

/**
 * Disable addon request
 */
export interface DisableAddonRequest {
  addonId: string;
  disabledBy: string;
}

/**
 * Update addon config request
 */
export interface UpdateAddonConfigRequest {
  addonId: string;
  config: Record<string, unknown>;
  updatedBy: string;
}

/**
 * Update addon request — replaces the stored manifest (name, version,
 * permissions, etc.) of an already-installed addon. Used by the
 * `addon_update` tool to keep the DB record in sync with on-disk addon.json
 * edits.
 */
export interface UpdateAddonRequest {
  addonId: string;
  manifest: AddonManifest;
  updatedBy: string;
}

/**
 * List addons filters
 */
export interface ListAddonsFilters {
  status?: import('@openaidy/db').AddonStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Service errors
 */
export class AddonServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AddonServiceError';
  }
}

/**
 * Error codes
 */
export const AddonErrorCodes = {
  ADDON_NOT_FOUND: 'ADDON_NOT_FOUND',
  DUPLICATE_ADDON_ID: 'DUPLICATE_ADDON_ID',
  INVALID_MANIFEST: 'INVALID_MANIFEST',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_PERMISSIONS: 'INVALID_PERMISSIONS',
  INVALID_CONFIG: 'INVALID_CONFIG',
  ADDON_NOT_DISABLED: 'ADDON_NOT_DISABLED',
  ADDON_NOT_ENABLED: 'ADDON_NOT_ENABLED',
  INSTALLATION_FAILED: 'INSTALLATION_FAILED',
  UNINSTALLATION_FAILED: 'UNINSTALLATION_FAILED',
} as const;

/**
 * Create a not found error
 */
export function createAddonNotFoundError(addonId: string): AddonServiceError {
  return new AddonServiceError(
    `Addon not found: ${addonId}`,
    AddonErrorCodes.ADDON_NOT_FOUND,
    { addonId },
  );
}

/**
 * Create a duplicate addon error
 */
export function createDuplicateAddonError(addonId: string): AddonServiceError {
  return new AddonServiceError(
    `Addon already exists: ${addonId}`,
    AddonErrorCodes.DUPLICATE_ADDON_ID,
    { addonId },
  );
}

/**
 * Create an invalid manifest error
 */
export function createInvalidManifestError(
  errors: import('@openaidy/shared-types').ValidationError[],
): AddonServiceError {
  return new AddonServiceError(
    'Invalid addon manifest',
    AddonErrorCodes.INVALID_MANIFEST,
    { errors },
  );
}

/**
 * Create an invalid permissions error
 */
export function createInvalidPermissionsError(
  requested: string[],
  allowed: string[],
): AddonServiceError {
  return new AddonServiceError(
    'Some requested permissions are not allowed',
    AddonErrorCodes.INVALID_PERMISSIONS,
    { requested, allowed },
  );
}

/**
 * Create an invalid config error
 */
export function createInvalidConfigError(message: string): AddonServiceError {
  return new AddonServiceError(
    `Invalid addon configuration: ${message}`,
    AddonErrorCodes.INVALID_CONFIG,
  );
}
