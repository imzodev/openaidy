/**
 * Addon Service
 *
 * Core business logic for addon lifecycle management.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import type { Addon } from '@openaidy/db';
import {
  type AddonServiceOptions,
  type InstallAddonRequest,
  type InstallAddonResult,
  type EnableAddonRequest,
  type EnableAddonResult,
  type DisableAddonRequest,
  type UpdateAddonConfigRequest,
  type ListAddonsFilters,
  AddonServiceError,
  createAddonNotFoundError,
  createDuplicateAddonError,
  createInvalidManifestError,
  createInvalidPermissionsError,
  createInvalidConfigError,
  AddonErrorCodes,
} from './types.js';

/**
 * Addon Service
 *
 * Handles all addon business logic including installation, activation,
 * configuration, and lifecycle management.
 */
export class AddonService {
  private readonly repository: AddonServiceOptions['repository'];
  private readonly validator: AddonServiceOptions['validator'];
  private readonly jwtSecret: string;
  private readonly openAidyVersion: string;

  constructor(options: AddonServiceOptions) {
    this.repository = options.repository;
    this.validator = options.validator;
    this.jwtSecret = options.jwtSecret;
    this.openAidyVersion = options.openAidyVersion;
  }

  /**
   * Install a new addon
   */
  async installAddon(
    request: InstallAddonRequest,
  ): Promise<InstallAddonResult> {
    const { manifest, installedBy } = request;

    // Validate the manifest
    const existingAddonIds: string[] = [];
    const validationResult = this.validator.validate(
      manifest,
      existingAddonIds,
    );

    if (!validationResult.valid) {
      throw createInvalidManifestError(validationResult.errors);
    }

    // Check if addon already exists
    const existing = await this.repository.findByAddonId(manifest.id);
    if (existing) {
      throw createDuplicateAddonError(manifest.id);
    }

    // Check if permissions require approval
    const requiresApproval = manifest.permissions.length > 0;

    // Create the addon record
    const addon = await this.repository.create({
      addonId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest: manifest as unknown as Record<string, unknown>,
      permissions: manifest.permissions,
      config: manifest.config?.defaults ?? {},
      installedBy,
    });

    return {
      addon,
      permissions: manifest.permissions,
      requiresApproval,
    };
  }

  /**
   * Enable an addon with approved permissions
   */
  async enableAddon(request: EnableAddonRequest): Promise<EnableAddonResult> {
    const { addonId, approvedPermissions, approvedBy } = request;

    // Find the addon
    const addon = await this.repository.findByAddonId(addonId);
    if (!addon) {
      throw createAddonNotFoundError(addonId);
    }

    // Validate that the addon can be enabled
    if (addon.status === 'enabled') {
      throw new AddonServiceError(
        'Addon is already enabled',
        AddonErrorCodes.ADDON_NOT_DISABLED,
      );
    }

    // Get the manifest permissions
    const manifest = addon.manifest as unknown as { permissions?: string[] };
    const requestedPermissions = manifest.permissions ?? [];

    // Validate approved permissions are a subset of requested
    const invalidPermissions = approvedPermissions.filter(
      (p) => !requestedPermissions.includes(p),
    );
    if (invalidPermissions.length > 0) {
      throw createInvalidPermissionsError(
        invalidPermissions,
        requestedPermissions,
      );
    }

    // Record the permission change
    await this.repository.recordPermissionChange({
      addonId: addon.id,
      changedBy: approvedBy,
      oldPermissions: (addon.permissions as string[]) ?? [],
      newPermissions: approvedPermissions,
      reason: 'Enabled addon',
    });

    // Update the addon status and permissions
    const updatedAddon = await this.repository.update(addon.id, {
      status: 'enabled',
      permissions: approvedPermissions,
    });

    if (!updatedAddon) {
      throw new AddonServiceError(
        'Failed to enable addon',
        AddonErrorCodes.INSTALLATION_FAILED,
      );
    }

    // Generate access token (use addonId, not DB row id, for lookups)
    const accessToken = this.generateAccessToken(
      addon.addonId,
      approvedPermissions,
    );

    return {
      addon: updatedAddon,
      accessToken,
    };
  }

  /**
   * Disable an addon
   */
  async disableAddon(request: DisableAddonRequest): Promise<Addon> {
    const { addonId, disabledBy } = request;

    // Find the addon
    const addon = await this.repository.findByAddonId(addonId);
    if (!addon) {
      throw createAddonNotFoundError(addonId);
    }

    // Check if already disabled
    if (addon.status === 'disabled') {
      throw new AddonServiceError(
        'Addon is already disabled',
        AddonErrorCodes.ADDON_NOT_DISABLED,
      );
    }

    // Record the permission change
    await this.repository.recordPermissionChange({
      addonId: addon.id,
      changedBy: disabledBy,
      oldPermissions: (addon.permissions as string[]) ?? [],
      newPermissions: null,
      reason: 'Disabled addon',
    });

    // Update the addon status
    const updatedAddon = await this.repository.updateStatus(
      addon.id,
      'disabled',
    );

    if (!updatedAddon) {
      throw new AddonServiceError(
        'Failed to disable addon',
        AddonErrorCodes.INSTALLATION_FAILED,
      );
    }

    return updatedAddon;
  }

  /**
   * Uninstall an addon
   */
  async uninstallAddon(addonId: string, _uninstalledBy: string): Promise<void> {
    // Find the addon
    const addon = await this.repository.findByAddonId(addonId);
    if (!addon) {
      throw createAddonNotFoundError(addonId);
    }

    // Delete the addon (cascade should handle related records)
    const deleted = await this.repository.delete(addon.id);

    if (!deleted) {
      throw new AddonServiceError(
        'Failed to uninstall addon',
        AddonErrorCodes.UNINSTALLATION_FAILED,
      );
    }
  }

  /**
   * List addons with filtering
   */
  async listAddons(filters?: ListAddonsFilters): Promise<{
    addons: Addon[];
    total: number;
  }> {
    return this.repository.list({
      status: filters?.status,
      limit: filters?.limit,
      offset: filters?.offset,
    } as {
      status?: 'installed' | 'enabled' | 'disabled' | 'error';
      limit?: number;
      offset?: number;
    });
  }

  /**
   * Get a single addon by ID
   */
  async getAddon(addonId: string): Promise<Addon | null> {
    return this.repository.findByAddonId(addonId);
  }

  /**
   * Update addon configuration
   */
  async updateAddonConfig(request: UpdateAddonConfigRequest): Promise<Addon> {
    const { addonId, config } = request;

    // Find the addon
    const addon = await this.repository.findByAddonId(addonId);
    if (!addon) {
      throw createAddonNotFoundError(addonId);
    }

    // Validate the config against the schema if provided
    const manifest = addon.manifest as unknown as {
      config?: {
        schema?: { type?: string; properties?: Record<string, unknown> };
      };
    };
    if (manifest.config?.schema) {
      // Basic validation - in production you'd use a proper JSON schema validator
      const schema = manifest.config.schema;
      if (schema.type === 'object' && typeof config !== 'object') {
        throw createInvalidConfigError('Config must be an object');
      }
    }

    // Update the config
    const updatedAddon = await this.repository.update(addon.id, {
      config: { ...(addon.config as Record<string, unknown>), ...config },
    });

    if (!updatedAddon) {
      throw new AddonServiceError(
        'Failed to update addon config',
        AddonErrorCodes.INSTALLATION_FAILED,
      );
    }

    return updatedAddon;
  }

  /**
   * Re-issue an access token for an already-enabled addon.
   *
   * Useful when the client loses the token (e.g. localStorage cleared,
   * different browser, or server restart re-keying).
   */
  async refreshAddonToken(addonId: string): Promise<{ accessToken: string }> {
    const addon = await this.repository.findByAddonId(addonId);
    if (!addon) {
      throw createAddonNotFoundError(addonId);
    }

    if (addon.status !== 'enabled') {
      throw new AddonServiceError(
        'Addon is not enabled',
        AddonErrorCodes.ADDON_NOT_ENABLED,
      );
    }

    const accessToken = this.generateAccessToken(
      addon.addonId,
      (addon.permissions as string[]) ?? [],
    );

    return { accessToken };
  }

  /**
   * Generate a JWT access token for an addon (HS256, matches AuthMiddleware).
   */
  private generateAccessToken(addonId: string, permissions: string[]): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 30 * 24 * 60 * 60; // 30 days
    const payload = {
      type: 'addon',
      addonId,
      permissions,
      iat: now,
      exp,
      jti: randomBytes(16).toString('hex'),
    };

    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  /**
   * Validate an addon access token and return its payload.
   */
  validateAccessToken(token: string): {
    addonId: string;
    permissions: string[];
  } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [header, body, signature] = parts as [string, string, string];

      const expectedSig = createHmac('sha256', this.jwtSecret)
        .update(`${header}.${body}`)
        .digest('base64url');

      const provided = Buffer.from(signature, 'utf-8');
      const expected = Buffer.from(expectedSig, 'utf-8');
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf-8'),
      ) as {
        type: string;
        addonId: string;
        permissions: string[];
        exp: number;
      };

      if (payload.type !== 'addon') return null;
      if (payload.exp * 1000 < Date.now()) return null;

      return { addonId: payload.addonId, permissions: payload.permissions };
    } catch {
      return null;
    }
  }

  /**
   * Record addon usage for analytics
   */
  async recordUsage(addonId: string, endpoint: string): Promise<void> {
    const addon = await this.repository.findByAddonId(addonId);
    if (!addon) {
      throw createAddonNotFoundError(addonId);
    }

    await this.repository.recordUsage({
      addonId: addon.id,
      endpoint,
    });
  }
}

/**
 * Create an addon service instance
 */
export function createAddonService(options: AddonServiceOptions): AddonService {
  return new AddonService(options);
}
