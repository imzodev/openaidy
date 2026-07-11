/**
 * Permission System
 *
 * Fine-grained permission checking and validation for addon access control.
 */

import type { Addon } from '@openaidy/db';

// ============================================================================
// Permission Types
// ============================================================================

/**
 * Permission resource types
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

/**
 * Permission action types
 */
export const PERMISSION_ACTIONS = [
  'read',
  'write',
  'delete',
  'invoke',
  'manage',
] as const;

/**
 * Parsed permission structure
 */
export interface ParsedPermission {
  resource: string;
  action: string;
  scope?: string;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Permission audit log entry
 */
export interface PermissionAuditEntry {
  addonId: string;
  permission: string;
  action: 'granted' | 'denied' | 'requested';
  timestamp: Date;
  context?: Record<string, unknown>;
}

// ============================================================================
// Permission Parser
// ============================================================================

/**
 * Parse a permission string into its components
 */
export function parsePermission(permission: string): ParsedPermission | null {
  const match = permission.match(/^([a-z][a-z0-9_]*)\.([a-z]+)(?::(.+))?$/);
  if (!match) return null;

  const result: ParsedPermission = {
    resource: match[1]!,
    action: match[2]!,
  };
  if (match[3] !== undefined) {
    result.scope = match[3];
  }
  return result;
}

/**
 * Format a permission from components
 */
export function formatPermission(
  resource: string,
  action: string,
  scope?: string,
): string {
  if (scope) {
    return `${resource}.${action}:${scope}`;
  }
  return `${resource}.${action}`;
}

// ============================================================================
// Permission Checker
// ============================================================================

/**
 * Permission checker class
 */
export class PermissionChecker {
  constructor(private readonly strictMode: boolean = true) {}

  /**
   * Check if a permission is allowed for an addon
   */
  check(addon: Addon, permission: string): PermissionCheckResult {
    const granted: string[] = (addon.permissions as string[]) ?? [];

    // Direct match
    if (granted.includes(permission)) {
      return { allowed: true };
    }

    // Wildcard match
    if (granted.includes('*')) {
      return { allowed: true, reason: 'Wildcard permission' };
    }

    // Check for resource wildcard (e.g., "agents.*")
    const parsed = parsePermission(permission);
    if (!parsed) {
      return { allowed: false, reason: 'Invalid permission format' };
    }

    // Check resource wildcard
    if (granted.includes(`${parsed.resource}.*`)) {
      return {
        allowed: true,
        reason: `Resource wildcard: ${parsed.resource}.*`,
      };
    }

    // Check action wildcard on resource
    if (granted.includes(`${parsed.resource}.${parsed.action}`)) {
      return { allowed: true };
    }

    // Check scoped permissions
    if (parsed.scope) {
      const scopedPermission = `${parsed.resource}.${parsed.action}:${parsed.scope}`;
      if (granted.includes(scopedPermission)) {
        return { allowed: true };
      }
    }

    // In strict mode, deny everything else
    if (this.strictMode) {
      return {
        allowed: false,
        reason: `Permission not granted: ${permission}`,
      };
    }

    // In non-strict mode, allow if at least resource matches
    const hasResourcePermission = granted.some((p) => {
      const parsed2 = parsePermission(p);
      return parsed2 && parsed2.resource === parsed.resource;
    });

    if (hasResourcePermission) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Permission not granted: ${permission}`,
    };
  }

  /**
   * Check multiple permissions at once
   */
  checkAll(
    addon: Addon,
    permissions: string[],
  ): { allowed: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const permission of permissions) {
      const result = this.check(addon, permission);
      if (!result.allowed) {
        missing.push(permission);
      }
    }

    return {
      allowed: missing.length === 0,
      missing,
    };
  }

  /**
   * Check if any of the permissions are granted
   */
  checkAny(
    addon: Addon,
    permissions: string[],
  ): { allowed: boolean; granted: string[] } {
    const granted: string[] = [];

    for (const permission of permissions) {
      const result = this.check(addon, permission);
      if (result.allowed) {
        granted.push(permission);
      }
    }

    return {
      allowed: granted.length > 0,
      granted,
    };
  }
}

// ============================================================================
// Permission Validator
// ============================================================================

/**
 * Validate a permission string format
 */
export function isValidPermission(permission: string): boolean {
  // Check for reserved/dangerous permissions
  const dangerousPermissions = [
    'system.addons.manage',
    'system.manage',
    '*.manage',
  ];

  if (dangerousPermissions.includes(permission)) {
    return false;
  }

  return parsePermission(permission) !== null;
}

/**
 * Get all unique resources from permissions
 */
export function getPermissionResources(permissions: string[]): string[] {
  const resources = new Set<string>();

  for (const permission of permissions) {
    const parsed = parsePermission(permission);
    if (parsed) {
      resources.add(parsed.resource);
    }
  }

  return Array.from(resources);
}

/**
 * Get all unique actions from permissions
 */
export function getPermissionActions(permissions: string[]): string[] {
  const actions = new Set<string>();

  for (const permission of permissions) {
    const parsed = parsePermission(permission);
    if (parsed) {
      actions.add(parsed.action);
    }
  }

  return Array.from(actions);
}

/**
 * Group permissions by resource
 */
export function groupPermissionsByResource(
  permissions: string[],
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const permission of permissions) {
    const parsed = parsePermission(permission);
    if (parsed) {
      if (!groups[parsed.resource]) {
        groups[parsed.resource] = [];
      }
      groups[parsed.resource]!.push(permission);
    }
  }

  return groups;
}

// ============================================================================
// Default Checker Instance
// ============================================================================

const defaultChecker = new PermissionChecker();

export function checkAddonPermission(
  addon: Addon,
  permission: string,
): PermissionCheckResult {
  return defaultChecker.check(addon, permission);
}

export function checkAddonPermissions(
  addon: Addon,
  permissions: string[],
): { allowed: boolean; missing: string[] } {
  return defaultChecker.checkAll(addon, permissions);
}

// ============================================================================
// Permission Comparison
// ============================================================================

/**
 * Check if new permissions are a subset of existing permissions
 */
export function isPermissionSubset(
  existing: string[],
  requested: string[],
): boolean {
  const existingSet = new Set(existing);
  return requested.every((p) => existingSet.has(p));
}

/**
 * Check if permissions have changed
 */
export function havePermissionsChanged(
  oldPermissions: string[] | null,
  newPermissions: string[],
): boolean {
  if (!oldPermissions) return true;
  if (oldPermissions.length !== newPermissions.length) return true;

  const oldSet = new Set(oldPermissions);
  const newSet = new Set(newPermissions);

  if (oldSet.size !== newSet.size) return true;

  for (const p of oldSet) {
    if (!newSet.has(p)) return true;
  }

  return false;
}
