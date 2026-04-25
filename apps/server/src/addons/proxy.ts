/**
 * Addon Proxy Service
 *
 * Secure intermediary between addons and OpenAidy's internal APIs.
 * Enforces permissions, provides audit logging, and rate limiting.
 */

import type { AddonService } from './service';
import type { Addon } from '@openaidy/db';
import type { ProxyResult } from './types';

/**
 * AddonProxyService
 *
 * Handles secure proxying of addon requests to internal APIs.
 */
export class AddonProxyService {
  constructor(
    private readonly addonService: AddonService,
    private readonly internalApiBaseUrl: string,
  ) {}

  /**
   * Check if an addon has a specific permission
   */
  hasPermission(addon: Addon, permission: string): boolean {
    const permissions = (addon.permissions as string[]) ?? [];
    return permissions.includes(permission) || permissions.includes('*');
  }

  /**
   * Check if an addon has access to a specific agent.
   *
   * Two tiers, checked in order:
   *   1. Unscoped: `agents.invoke`, `agents.*`, or `*` — access to all agents.
   *   2. Scoped:   `agents.invoke:<agentId>`           — access to that agent only.
   *
   * Access is determined solely by the permissions the user approved at enable
   * time. The manifest `agents` array declares agents the addon *provides*, not
   * agents it may invoke, so it plays no role here.
   */
  hasAgentAccess(addon: Addon, agentId: string): boolean {
    const permissions = (addon.permissions as string[]) ?? [];

    // Tier 1: unscoped — grants access to all agents
    if (
      permissions.includes('agents.invoke') ||
      permissions.includes('agents.*') ||
      permissions.includes('*')
    ) {
      return true;
    }

    // Tier 2: scoped — grants access to one specific agent
    return permissions.includes(`agents.invoke:${agentId}`);
  }

  /**
   * Validate an addon access token
   */
  async validateToken(token: string): Promise<{
    valid: boolean;
    addonId?: string;
    permissions?: string[];
    error?: string;
  }> {
    const result = this.addonService.validateAccessToken(token);

    if (!result) {
      return { valid: false, error: 'Invalid or expired token' };
    }

    // Verify addon is still enabled
    const addon = await this.addonService.getAddon(result.addonId);
    if (!addon) {
      return { valid: false, error: 'Addon not found' };
    }

    if (addon.status !== 'enabled') {
      return { valid: false, error: 'Addon is not enabled' };
    }

    return {
      valid: true,
      addonId: result.addonId,
      permissions: result.permissions,
    };
  }

  /**
   * Check if a permission matches a pattern
   */
  private matchesPermission(granted: string[], requested: string): boolean {
    for (const g of granted) {
      if (g === '*') return true;
      if (g === requested) return true;

      // Check wildcard permission (e.g., "agents.*" matches "agents.read")
      if (g.endsWith('.*')) {
        const prefix = g.slice(0, -2);
        if (requested.startsWith(prefix + '.')) return true;
      }

      // Check scope-specific permission (e.g., "agents.invoke:price-analyzer")
      if (g.startsWith(requested.split(':')[0] + ':')) return true;
    }
    return false;
  }

  /**
   * Authorize a proxy request
   */
  authorize(
    addon: Addon,
    requiredPermission: string,
  ): { authorized: boolean; error?: string } {
    const permissions = (addon.permissions as string[]) ?? [];

    if (!this.matchesPermission(permissions, requiredPermission)) {
      return {
        authorized: false,
        error: `Missing required permission: ${requiredPermission}`,
      };
    }

    return { authorized: true };
  }

  /**
   * Record usage for an addon
   */
  async recordUsage(addonId: string, endpoint: string): Promise<void> {
    await this.addonService.recordUsage(addonId, endpoint);
  }

  /**
   * Create a proxy error response
   */
  createError(
    code: string,
    message: string,
    _status: number = 403,
  ): ProxyResult {
    return {
      success: false,
      error: { error: code, message, code },
    };
  }
}

/**
 * Create an addon proxy service
 */
export function createAddonProxyService(
  addonService: AddonService,
  internalApiBaseUrl: string,
): AddonProxyService {
  return new AddonProxyService(addonService, internalApiBaseUrl);
}
