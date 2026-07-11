/**
 * OpenAidy Addon System - Types
 *
 * TypeScript interfaces for the addon manifest and related structures.
 */

import { z } from 'zod';

/**
 * Author information for an addon
 */
export const AddonAuthorSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  url: z.string().url().optional(),
});

export type AddonAuthor = z.infer<typeof AddonAuthorSchema>;

/**
 * OpenAidy version compatibility
 */
export const AddonVersionConstraintSchema = z.object({
  minVersion: z.string().optional(),
  maxVersion: z.string().optional(),
});

export type AddonVersionConstraint = z.infer<
  typeof AddonVersionConstraintSchema
>;

/**
 * Sidebar navigation configuration
 */
export const AddonSidebarConfigSchema = z.object({
  icon: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  order: z.number().int().min(0).max(1000).default(100),
});

export type AddonSidebarConfig = z.infer<typeof AddonSidebarConfigSchema>;

/**
 * Route configuration for addon pages
 */
export const AddonRouteSchema = z.object({
  path: z.string().min(1).max(200).startsWith('/'),
  component: z.string().min(1).max(100),
  props: z.record(z.unknown()).optional(),
});

export type AddonRoute = z.infer<typeof AddonRouteSchema>;

/**
 * UI configuration for an addon
 */
export const AddonUIConfigSchema = z.object({
  sidebar: AddonSidebarConfigSchema.optional(),
  routes: z.array(AddonRouteSchema).min(0).max(50),
  styles: z.array(z.string().url()).optional(),
  scripts: z.array(z.string().url()).optional(),
});

export type AddonUIConfig = z.infer<typeof AddonUIConfigSchema>;

/**
 * Agent reference configuration
 */
export const AddonAgentReferenceSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  required: z.boolean().default(false),
  description: z.string().max(500).optional(),
});

export type AddonAgentReference = z.infer<typeof AddonAgentReferenceSchema>;

/**
 * Configuration schema for addon settings
 */
export const AddonConfigSchemaSchema = z.object({
  type: z.enum(['object', 'array', 'string', 'number', 'boolean']),
  properties: z.record(z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  description: z.string().max(500).optional(),
});

export type AddonConfigSchema = z.infer<typeof AddonConfigSchemaSchema>;

/**
 * Configuration defaults for addon
 */
export const AddonConfigDefaultsSchema = z.record(z.unknown());

export type AddonConfigDefaults = z.infer<typeof AddonConfigDefaultsSchema>;

/**
 * Addon configuration block
 */
export const AddonConfigBlockSchema = z.object({
  schema: AddonConfigSchemaSchema.optional(),
  defaults: AddonConfigDefaultsSchema.optional(),
});

export type AddonConfigBlock = z.infer<typeof AddonConfigBlockSchema>;

/**
 * Permission string format: resource.action or resource.action:scope
 * Examples: "sessions.list", "agents.invoke:price-analyzer", "config.write:pricing"
 */
export const AddonPermissionSchema = z
  .string()
  .regex(
    /^([a-z][a-z0-9]*)\.(list|read|write|delete|invoke|manage|list:\S+|read:\S+|write:\S+|invoke:\S+)$/,
    'Invalid permission format. Expected: resource.action or resource.action:scope',
  );

export type AddonPermission = z.infer<typeof AddonPermissionSchema>;

/**
 * OpenAidy compatibility section
 */
export const AddonOpenAidySchema = z.object({
  minVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format'),
  maxVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format')
    .optional(),
});

export type AddonOpenAidy = z.infer<typeof AddonOpenAidySchema>;

/**
 * Addon storage block — declares the addon's own per-addon SQLite storage.
 *
 * `migrations` is an ordered list of DDL/DML statements the host applies once,
 * by index, the first time the addon's DB is opened (and again for any newly
 * added entries after an upgrade). Declaring the schema here — rather than
 * having the UI create tables on first load — means the tables exist even when
 * no addon UI has run (e.g. an agent writing to the store headless). Each entry
 * must be plain SQL without its own BEGIN/COMMIT; `ATTACH`/`DETACH` are rejected.
 */
export const AddonStorageConfigSchema = z.object({
  migrations: z.array(z.string().min(1).max(20_000)).max(200).optional(),
});

export type AddonStorageConfig = z.infer<typeof AddonStorageConfigSchema>;

/**
 * Main addon manifest structure
 */
export const AddonManifestSchema = z.object({
  $schema: z
    .string()
    .url()
    .startsWith('https://openaidy.dev/schemas/')
    .optional()
    .default('https://openaidy.dev/schemas/addon-v1.json'),
  id: z
    .string()
    .min(3)
    .max(100)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      'ID must start with lowercase letter, contain only lowercase letters, numbers, and hyphens',
    ),
  name: z.string().min(1).max(255),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format'),
  description: z.string().max(1000).optional(),
  author: AddonAuthorSchema.optional(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  license: z.string().max(100).default('MIT'),
  openaidy: AddonOpenAidySchema,
  entry: z.string().min(1).max(500),
  permissions: z.array(AddonPermissionSchema).min(0).max(100),
  ui: AddonUIConfigSchema.optional(),
  agents: z.array(AddonAgentReferenceSchema).optional(),
  config: AddonConfigBlockSchema.optional(),
  storage: AddonStorageConfigSchema.optional(),
  dependencies: z.record(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  /**
   * External domains this addon is allowed to fetch from directly (browser-side).
   * Each entry must be a bare hostname or hostname:port (e.g. "api.open-meteo.com").
   * Enforced via CSP connect-src. Use this for API calls made with fetch().
   *
   * TODO: Before an addon with externalDomains is enabled, prompt the user to
   * review and approve the listed domains — similar to the permissions approval flow.
   */
  externalDomains: z
    .array(
      z
        .string()
        .regex(
          /^[a-zA-Z0-9.-]+(:\d+)?$/,
          'externalDomains entries must be bare hostnames (e.g. "api.open-meteo.com")',
        ),
    )
    .max(20)
    .optional(),
  /**
   * External domains this addon is allowed to load images from (browser-side).
   * Each entry must be a bare hostname or hostname:port (e.g. "raw.githubusercontent.com").
   * Enforced via CSP img-src. Use this for <img src="https://..."> and CSS background images.
   *
   * TODO: Before an addon with externalImageDomains is enabled, prompt the user to
   * review and approve the listed domains — similar to the permissions approval flow.
   */
  externalImageDomains: z
    .array(
      z
        .string()
        .regex(
          /^[a-zA-Z0-9.-]+(:\d+)?$/,
          'externalImageDomains entries must be bare hostnames (e.g. "raw.githubusercontent.com")',
        ),
    )
    .max(20)
    .optional(),
  icons: z
    .object({
      16: z.string().url().optional(),
      32: z.string().url().optional(),
      48: z.string().url().optional(),
      128: z.string().url().optional(),
    })
    .optional(),
});

export type AddonManifest = z.infer<typeof AddonManifestSchema>;

/**
 * Addon status in the registry
 */
export type AddonStatus = 'installed' | 'enabled' | 'disabled' | 'error';

/**
 * Database record for an installed addon
 */
export const AddonRecordSchema = z.object({
  id: z.string().uuid(),
  addonId: z.string(),
  name: z.string(),
  version: z.string(),
  manifest: AddonManifestSchema,
  status: z.enum(['installed', 'enabled', 'disabled', 'error']),
  permissions: z.array(AddonPermissionSchema),
  config: z.record(z.unknown()),
  installedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  installedBy: z.string(),
});

export type AddonRecord = z.infer<typeof AddonRecordSchema>;

/**
 * Permission change audit record
 */
export const AddonPermissionChangeSchema = z.object({
  id: z.string().uuid(),
  addonId: z.string().uuid(),
  changedBy: z.string(),
  oldPermissions: z.array(AddonPermissionSchema).nullable(),
  newPermissions: z.array(AddonPermissionSchema).nullable(),
  reason: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type AddonPermissionChange = z.infer<typeof AddonPermissionChangeSchema>;

/**
 * Usage metrics for an addon
 */
export const AddonUsageSchema = z.object({
  id: z.string().uuid(),
  addonId: z.string().uuid(),
  endpoint: z.string(),
  requestCount: z.number().int().min(0),
  lastUsed: z.string().datetime().optional(),
  date: z.string(),
});

export type AddonUsage = z.infer<typeof AddonUsageSchema>;

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to install an addon
 */
export type InstallAddonRequest = {
  manifest: AddonManifest;
  package?: string; // Base64 encoded addon package (future use)
};

/**
 * Response from installing an addon
 */
export type InstallAddonResponse = {
  addon: AddonRecord;
  permissions: string[];
  requiresApproval: boolean;
};

/**
 * Request to enable an addon
 */
export type EnableAddonRequest = {
  approvedPermissions: string[];
};

/**
 * Response from enabling an addon
 */
export type EnableAddonResponse = {
  addon: AddonRecord;
  accessToken: string;
};

/**
 * Request to update addon permissions
 */
export type UpdatePermissionsRequest = {
  permissions: string[];
  reason?: string;
};

/**
 * Response for permission update
 */
export type UpdatePermissionsResponse = {
  addon: AddonRecord;
  previousPermissions: string[];
};

/**
 * Addon list query params
 */
export type ListAddonsQuery = {
  status?: AddonStatus;
  search?: string;
  limit?: number;
  offset?: number;
};

/**
 * Paginated addon list response
 */
export type ListAddonsResponse = {
  addons: AddonRecord[];
  total: number;
  limit: number;
  offset: number;
};

// ============================================================================
// Validation Error Types
// ============================================================================

/**
 * Field-level validation error
 */
export type ValidationError = {
  field: string;
  message: string;
  code: string;
};

/**
 * Result of manifest validation
 */
export type ManifestValidationResult =
  | {
      valid: true;
      manifest: AddonManifest;
    }
  | {
      valid: false;
      errors: ValidationError[];
    };

// ============================================================================
// Permission Validation
// ============================================================================

/**
 * Available permission resources
 */
export const PERMISSION_RESOURCES = [
  'agents',
  'sessions',
  'config',
  'system',
  'tasks',
  'runs',
  'mcp',
  'workspace',
  'logs',
  'storage',
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

/**
 * Available permission actions
 */
export const PERMISSION_ACTIONS = [
  'list',
  'read',
  'write',
  'delete',
  'invoke',
  'manage',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Parse a permission string into its components
 */
export function parsePermission(permission: string): {
  resource: string;
  action: string;
  scope?: string;
} | null {
  const match = permission.match(/^([a-z][a-z0-9]*)\.([a-z]+)(?::(.+))?$/);
  if (!match) return null;
  const result: { resource: string; action: string; scope?: string } = {
    resource: match[1]!,
    action: match[2]!,
  };
  if (match[3] !== undefined) {
    result.scope = match[3];
  }
  return result;
}

/**
 * Check if a permission matches a pattern (supports wildcards)
 */
export function matchesPermission(
  permission: string,
  pattern: string,
): boolean {
  if (pattern === '*') return true;
  if (pattern === permission) return true;

  const permParts = parsePermission(permission);
  const patternParts = parsePermission(pattern);

  if (!permParts || !patternParts) return false;

  if (
    patternParts.resource !== '*' &&
    patternParts.resource !== permParts.resource
  ) {
    return false;
  }
  if (patternParts.action !== '*' && patternParts.action !== permParts.action) {
    return false;
  }
  if (patternParts.scope && patternParts.scope !== permParts.scope) {
    return false;
  }

  return true;
}
