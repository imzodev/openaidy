import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema/addons';
import { AddonsRepository } from './addons';

type Database = NodePgDatabase<typeof schema>;

/**
 * Integration tests for AddonsRepository.
 *
 * Requires a running PostgreSQL database with the schema applied.
 * Set DATABASE_URL to run, e.g.:
 *   DATABASE_URL=postgres://... pnpm vitest run src/repositories/addons.test.ts
 */
describe('AddonsRepository (integration)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  const shouldRun = !!databaseUrl;
  const test = shouldRun ? it : it.skip;

  let pool: Pool | undefined;
  let db: Database | undefined;
  let repo: AddonsRepository | undefined;

  beforeEach(async () => {
    if (!shouldRun || !databaseUrl) return;

    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema }) as Database;
    repo = new AddonsRepository(db);

    await db.delete(schema.addonUsage);
    await db.delete(schema.addonPermissionChanges);
    await db.delete(schema.addons);
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    test('inserts a row and returns it', async () => {
      const manifest = {
        id: 'test-addon',
        name: 'Test Addon',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: ['sessions.read'],
      };

      const row = await repo!.create({
        addonId: 'test-addon',
        name: 'Test Addon',
        version: '1.0.0',
        manifest,
        permissions: ['sessions.read'],
        config: { debug: true },
        installedBy: 'admin',
      });

      expect(row.id).toBeDefined();
      expect(row.addonId).toBe('test-addon');
      expect(row.name).toBe('Test Addon');
      expect(row.version).toBe('1.0.0');
      expect(row.status).toBe('installed');
      expect(row.installedBy).toBe('admin');
    });

    test('applies default values for optional fields', async () => {
      const manifest = {
        id: 'minimal-addon',
        name: 'Minimal Addon',
        version: '1.0.0',
        openaidy: { minVersion: '1.0.0' },
        entry: 'dist/index.js',
        permissions: [],
      };

      const row = await repo!.create({
        addonId: 'minimal-addon',
        name: 'Minimal Addon',
        version: '1.0.0',
        manifest,
        installedBy: 'admin',
      });

      expect(row.permissions).toEqual([]);
      expect(row.config).toEqual({});
      expect(row.status).toBe('installed');
    });
  });

  // -------------------------------------------------------------------------
  // findById / findByAddonId
  // -------------------------------------------------------------------------
  describe('findById', () => {
    test('returns null when not found', async () => {
      const result = await repo!.findById('nonexistent');
      expect(result).toBeNull();
    });

    test('returns the row when found', async () => {
      const created = await repo!.create({
        addonId: 'find-test',
        name: 'Find Test',
        version: '1.0.0',
        manifest: {
          id: 'find-test',
          name: 'Find Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      const result = await repo!.findById(created.id);
      expect(result).not.toBeNull();
      expect(result!.addonId).toBe('find-test');
    });
  });

  describe('findByAddonId', () => {
    test('returns null when not found', async () => {
      const result = await repo!.findByAddonId('nonexistent');
      expect(result).toBeNull();
    });

    test('returns the row when found', async () => {
      const created = await repo!.create({
        addonId: 'find-by-addon-id',
        name: 'Find By Addon ID',
        version: '1.0.0',
        manifest: {
          id: 'find-by-addon-id',
          name: 'Find By Addon ID',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      const result = await repo!.findByAddonId('find-by-addon-id');
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  describe('list', () => {
    test('returns empty list when no addons', async () => {
      const result = await repo!.list();
      expect(result.addons).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('returns all addons with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await repo!.create({
          addonId: `list-test-${i}`,
          name: `List Test ${i}`,
          version: '1.0.0',
          manifest: {
            id: `list-test-${i}`,
            name: `List Test ${i}`,
            version: '1.0.0',
            openaidy: { minVersion: '1.0.0' },
            entry: 'dist/index.js',
            permissions: [],
          },
          installedBy: 'admin',
        });
      }

      const result = await repo!.list({ limit: 3, offset: 0 });
      expect(result.addons.length).toBe(3);
      expect(result.total).toBe(5);
    });

    test('filters by status', async () => {
      const addon1 = await repo!.create({
        addonId: 'status-test-1',
        name: 'Status Test 1',
        version: '1.0.0',
        manifest: {
          id: 'status-test-1',
          name: 'Status Test 1',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      await repo!.create({
        addonId: 'status-test-2',
        name: 'Status Test 2',
        version: '1.0.0',
        manifest: {
          id: 'status-test-2',
          name: 'Status Test 2',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      await repo!.updateStatus(addon1.id, 'enabled');

      const enabledResult = await repo!.list({ status: 'enabled' });
      expect(enabledResult.addons.length).toBe(1);
      expect(enabledResult.addons[0]!.addonId).toBe('status-test-1');

      const installedResult = await repo!.list({ status: 'installed' });
      expect(installedResult.addons.length).toBe(1);
      expect(installedResult.addons[0]!.addonId).toBe('status-test-2');
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  describe('update', () => {
    test('updates only provided fields', async () => {
      const created = await repo!.create({
        addonId: 'update-test',
        name: 'Update Test',
        version: '1.0.0',
        manifest: {
          id: 'update-test',
          name: 'Update Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      const updated = await repo!.update(created.id, { name: 'Updated Name' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.version).toBe('1.0.0'); // unchanged
      expect(updated!.addonId).toBe('update-test'); // unchanged
    });

    test('returns null when addon not found', async () => {
      const result = await repo!.update('nonexistent', { name: 'New Name' });
      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    test('updates status correctly', async () => {
      const created = await repo!.create({
        addonId: 'status-update-test',
        name: 'Status Update Test',
        version: '1.0.0',
        manifest: {
          id: 'status-update-test',
          name: 'Status Update Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      const updated = await repo!.updateStatus(created.id, 'enabled');

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('enabled');
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------
  describe('delete', () => {
    test('deletes existing addon', async () => {
      const created = await repo!.create({
        addonId: 'delete-test',
        name: 'Delete Test',
        version: '1.0.0',
        manifest: {
          id: 'delete-test',
          name: 'Delete Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      const deleted = await repo!.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repo!.findById(created.id);
      expect(found).toBeNull();
    });

    test('returns false when addon not found', async () => {
      const result = await repo!.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // recordPermissionChange
  // -------------------------------------------------------------------------
  describe('recordPermissionChange', () => {
    test('records permission change', async () => {
      const addon = await repo!.create({
        addonId: 'perm-change-test',
        name: 'Perm Change Test',
        version: '1.0.0',
        manifest: {
          id: 'perm-change-test',
          name: 'Perm Change Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        permissions: ['sessions.read'],
        installedBy: 'admin',
      });

      const change = await repo!.recordPermissionChange({
        addonId: addon.id,
        changedBy: 'admin',
        oldPermissions: ['sessions.read'],
        newPermissions: ['sessions.read', 'sessions.write'],
        reason: 'User requested more permissions',
      });

      expect(change.id).toBeDefined();
      expect(change.addonId).toBe(addon.id);
      expect(change.oldPermissions).toEqual(['sessions.read']);
      expect(change.newPermissions).toEqual([
        'sessions.read',
        'sessions.write',
      ]);
      expect(change.reason).toBe('User requested more permissions');
    });

    test('getPermissionChanges returns changes in order', async () => {
      const addon = await repo!.create({
        addonId: 'perm-history-test',
        name: 'Perm History Test',
        version: '1.0.0',
        manifest: {
          id: 'perm-history-test',
          name: 'Perm History Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      await repo!.recordPermissionChange({
        addonId: addon.id,
        changedBy: 'admin',
        oldPermissions: null,
        newPermissions: ['sessions.read'],
      });

      await repo!.recordPermissionChange({
        addonId: addon.id,
        changedBy: 'admin',
        oldPermissions: ['sessions.read'],
        newPermissions: ['sessions.read', 'sessions.write'],
      });

      const history = await repo!.getPermissionChanges(addon.id);
      expect(history.length).toBe(2);
      // Most recent first
      expect(history[0]!.newPermissions).toEqual([
        'sessions.read',
        'sessions.write',
      ]);
      expect(history[1]!.newPermissions).toEqual(['sessions.read']);
    });
  });

  // -------------------------------------------------------------------------
  // recordUsage
  // -------------------------------------------------------------------------
  describe('recordUsage', () => {
    test('records usage and increments count', async () => {
      const addon = await repo!.create({
        addonId: 'usage-test',
        name: 'Usage Test',
        version: '1.0.0',
        manifest: {
          id: 'usage-test',
          name: 'Usage Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        installedBy: 'admin',
      });

      await repo!.recordUsage({ addonId: addon.id, endpoint: '/api/test' });
      await repo!.recordUsage({ addonId: addon.id, endpoint: '/api/test' });
      await repo!.recordUsage({ addonId: addon.id, endpoint: '/api/test' });

      const usage = await repo!.getUsage(addon.id);
      expect(usage.length).toBe(1);
      expect(usage[0]!.requestCount).toBe(3);
      expect(usage[0]!.endpoint).toBe('/api/test');
    });
  });
});
