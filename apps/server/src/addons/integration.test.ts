/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import { createAddonService } from './service';
import type { ManifestValidator } from './manifest-validator';

// Mock addon type
interface MockAddon {
  id: string;
  addonId: string;
  name: string;
  version: string;
  manifest: Record<string, unknown>;
  status: string;
  permissions: string[];
  config: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
  installedBy: string;
}

// Create a simple mock repository
function createMockRepository() {
  const addons = new Map<string, MockAddon>();
  const permissionChanges: any[] = [];
  const usageRecords: any[] = [];
  let idCounter = 0;

  return {
    addons,
    permissionChanges,
    usageRecords,

    async create(input: any): Promise<MockAddon> {
      idCounter++;
      const addon: MockAddon = {
        id: `addon-${idCounter}`,
        addonId: input.addonId,
        name: input.name,
        version: input.version,
        manifest: input.manifest,
        status: 'installed',
        permissions: input.permissions ?? [],
        config: input.config ?? {},
        installedAt: new Date(),
        updatedAt: new Date(),
        installedBy: input.installedBy,
      };
      addons.set(addon.id, addon);
      return addon;
    },

    async findById(id: string): Promise<MockAddon | null> {
      return addons.get(id) ?? null;
    },

    async findByAddonId(addonId: string): Promise<MockAddon | null> {
      for (const addon of addons.values()) {
        if (addon.addonId === addonId) return addon;
      }
      return null;
    },

    async list({ status }: { status?: string } = {}): Promise<{
      addons: MockAddon[];
      total: number;
    }> {
      const all = Array.from(addons.values());
      const filtered = status ? all.filter((a) => a.status === status) : all;
      return { addons: filtered, total: filtered.length };
    },

    async update(id: string, input: any): Promise<MockAddon | null> {
      const addon = addons.get(id);
      if (!addon) return null;
      Object.assign(addon, input, { updatedAt: new Date() });
      return addon;
    },

    async updateStatus(id: string, status: string): Promise<MockAddon | null> {
      const addon = addons.get(id);
      if (!addon) return null;
      addon.status = status;
      addon.updatedAt = new Date();
      return addon;
    },

    async delete(id: string): Promise<boolean> {
      return addons.delete(id);
    },

    async recordPermissionChange(input: any): Promise<any> {
      const change = {
        id: `change-${Date.now()}`,
        ...input,
        createdAt: new Date(),
      };
      permissionChanges.push(change);
      return change;
    },

    async recordUsage(input: any): Promise<void> {
      usageRecords.push(input);
    },
  };
}

// Create mock validator
function createMockValidator(): ManifestValidator {
  return {
    validate: (manifest: unknown, _existingAddonIds: string[] = []) => {
      if (!manifest || typeof manifest !== 'object') {
        return { valid: false, errors: [] };
      }
      const m = manifest as Record<string, unknown>;
      if (!m.id || !m.name || !m.version || !m.openaidy || !m.entry) {
        return {
          valid: false,
          errors: [
            {
              field: 'required',
              message: 'Missing required fields',
              code: 'REQUIRED',
            },
          ],
        };
      }

      return { valid: true, manifest: manifest as any };
    },
    validateSchema: (manifest: unknown) => {
      return createMockValidator().validate(manifest) as any;
    },
    validateWithIssues: (
      manifest: unknown,
      existingAddonIds: string[] = [],
    ) => {
      const result = createMockValidator().validate(manifest, existingAddonIds);
      const issues = {
        errors: result.valid ? [] : ((result as any).errors ?? []),
        warnings: [],
      };
      return { result, issues };
    },

    config: { openAidyVersion: '1.0.0' } as any,
    setConfig: () => {},
    getConfig: () => ({ openAidyVersion: '1.0.0' }),
  } as any;
}

describe('AddonService Integration', () => {
  let mockRepo: ReturnType<typeof createMockRepository>;

  let validator: ManifestValidator;

  let service: any;

  beforeEach(() => {
    mockRepo = createMockRepository();
    validator = createMockValidator();
    service = createAddonService({
      repository: mockRepo as any,
      validator,
      jwtSecret: 'test-secret',
      openAidyVersion: '1.0.0',
    });
  });

  describe('installAddon', () => {
    it('should install a valid addon', async () => {
      const manifest = {
        id: 'test-addon',
        name: 'Test Addon',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: ['sessions.read'],
      };

      const result = await service.installAddon({
        manifest,
        installedBy: 'admin',
      });

      expect(result.addon).toBeDefined();
      expect(result.addon.addonId).toBe('test-addon');
      expect(result.permissions).toEqual(['sessions.read']);
      expect(result.requiresApproval).toBe(true);
    });

    it('should reject duplicate addon ID', async () => {
      const manifest = {
        id: 'duplicate-addon',
        name: 'Duplicate',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: [],
      };

      await service.installAddon({ manifest, installedBy: 'admin' });

      await expect(
        service.installAddon({ manifest, installedBy: 'admin' }),
      ).rejects.toThrow();
    });

    it('should not require approval for no-permission addon', async () => {
      const manifest = {
        id: 'no-perm-addon',
        name: 'No Permission Addon',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: [],
      };

      const result = await service.installAddon({
        manifest,
        installedBy: 'admin',
      });

      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('enableAddon', () => {
    it('should enable an installed addon', async () => {
      const manifest = {
        id: 'enable-test',
        name: 'Enable Test',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: ['sessions.read', 'sessions.write'],
      };

      await service.installAddon({ manifest, installedBy: 'admin' });

      const enableResult = await service.enableAddon({
        addonId: 'enable-test',
        approvedPermissions: ['sessions.read'],
        approvedBy: 'admin',
      });

      expect(enableResult.addon.status).toBe('enabled');
      expect(enableResult.accessToken).toBeDefined();
    });

    it('should reject invalid permissions not in manifest', async () => {
      const manifest = {
        id: 'perm-test',
        name: 'Permission Test',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: ['sessions.read'],
      };

      await service.installAddon({ manifest, installedBy: 'admin' });

      await expect(
        service.enableAddon({
          addonId: 'perm-test',
          approvedPermissions: ['sessions.write'], // Not requested
          approvedBy: 'admin',
        }),
      ).rejects.toThrow();
    });

    it('should reject non-existent addon', async () => {
      await expect(
        service.enableAddon({
          addonId: 'non-existent',
          approvedPermissions: [],
          approvedBy: 'admin',
        }),
      ).rejects.toThrow();
    });
  });

  describe('disableAddon', () => {
    it('should disable an enabled addon', async () => {
      const manifest = {
        id: 'disable-test',
        name: 'Disable Test',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: ['sessions.read'],
      };

      await service.installAddon({ manifest, installedBy: 'admin' });
      await service.enableAddon({
        addonId: 'disable-test',
        approvedPermissions: ['sessions.read'],
        approvedBy: 'admin',
      });

      const result = await service.disableAddon({
        addonId: 'disable-test',
        disabledBy: 'admin',
      });

      expect(result.status).toBe('disabled');
    });
  });

  describe('uninstallAddon', () => {
    it('should uninstall an addon', async () => {
      const manifest = {
        id: 'uninstall-test',
        name: 'Uninstall Test',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: [],
      };

      await service.installAddon({ manifest, installedBy: 'admin' });
      await service.uninstallAddon('uninstall-test', 'admin');

      const addon = await service.getAddon('uninstall-test');
      expect(addon).toBeNull();
    });
  });

  describe('listAddons', () => {
    it('should list all addons', async () => {
      await service.installAddon({
        manifest: {
          id: 'addon-1',
          name: 'Addon 1',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      await service.installAddon({
        manifest: {
          id: 'addon-2',
          name: 'Addon 2',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      const result = await service.listAddons();
      expect(result.addons.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('should filter by status', async () => {
      await service.installAddon({
        manifest: {
          id: 'status-addon-1',
          name: 'Status Addon 1',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: ['sessions.read'],
        },
        installedBy: 'admin',
      });

      await service.installAddon({
        manifest: {
          id: 'status-addon-2',
          name: 'Status Addon 2',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: ['sessions.read'],
        },
        installedBy: 'admin',
      });

      await service.enableAddon({
        addonId: 'status-addon-1',
        approvedPermissions: ['sessions.read'],
        approvedBy: 'admin',
      });

      const enabledResult = await service.listAddons({ status: 'enabled' });
      expect(enabledResult.addons.length).toBe(1);
      expect(enabledResult.addons[0]?.addonId).toBe('status-addon-1');

      const installedResult = await service.listAddons({ status: 'installed' });
      expect(installedResult.addons.length).toBe(1);
      expect(installedResult.addons[0]?.addonId).toBe('status-addon-2');
    });
  });

  describe('getAddon', () => {
    it('should return null for non-existent addon', async () => {
      const result = await service.getAddon('non-existent');
      expect(result).toBeNull();
    });

    it('should return addon when found', async () => {
      const manifest = {
        id: 'get-test',
        name: 'Get Test',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: [],
      };

      await service.installAddon({ manifest, installedBy: 'admin' });
      const result = await service.getAddon('get-test');

      expect(result).not.toBeNull();
      expect(result?.addonId).toBe('get-test');
    });
  });

  describe('updateAddonConfig', () => {
    it('should update addon config', async () => {
      const manifest = {
        id: 'config-test',
        name: 'Config Test',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: [],
      };

      await service.installAddon({ manifest, installedBy: 'admin' });

      const result = await service.updateAddonConfig({
        addonId: 'config-test',
        config: { debug: true },
        updatedBy: 'admin',
      });

      expect(result.config).toHaveProperty('debug', true);
    });
  });

  describe('access token validation', () => {
    it('should reject invalid tokens', async () => {
      const validation = service.validateAccessToken('invalid-token');
      expect(validation).toBeNull();
    });
  });
});
