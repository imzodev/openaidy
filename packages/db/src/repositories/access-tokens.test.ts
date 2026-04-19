import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema/access-tokens';
import { AccessTokensRepository } from './access-tokens';

type Database = NodePgDatabase<typeof schema>;

/**
 * Integration tests for AccessTokensRepository.
 *
 * Requires a running PostgreSQL database with the schema applied.
 * Set DATABASE_URL to run, e.g.:
 *   DATABASE_URL=postgres://... pnpm vitest run src/repositories/access-tokens.test.ts
 */
describe('AccessTokensRepository (integration)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  const shouldRun = !!databaseUrl;
  const test = shouldRun ? it : it.skip;

  let pool: Pool | undefined;
  let db: Database | undefined;
  let repo: AccessTokensRepository | undefined;

  beforeEach(async () => {
    if (!shouldRun || !databaseUrl) return;

    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema }) as Database;
    repo = new AccessTokensRepository(db);

    await db.delete(schema.accessTokens);
  });

  afterEach(async () => {
    if (pool) await pool.end();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    test('inserts a row and returns it', async () => {
      const row = await repo!.create({
        name: 'CI Pipeline',
        keyHash: 'hash-aaa',
        keyPrefix: 'oat_aabb',
        scopes: ['sessions.read', 'sessions.stream'],
        createdBy: 'bootstrap-admin',
      });

      expect(row.id).toBeDefined();
      expect(row.name).toBe('CI Pipeline');
      expect(row.keyHash).toBe('hash-aaa');
      expect(row.keyPrefix).toBe('oat_aabb');
      expect(row.scopes).toBe(
        JSON.stringify(['sessions.read', 'sessions.stream']),
      );
      expect(row.createdBy).toBe('bootstrap-admin');
      expect(row.revoked).toBeFalsy();
      expect(row.expiresAt).toBeNull();
      expect(row.lastUsedAt).toBeNull();
    });

    test('stores expiresAt when provided', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00Z');
      const row = await repo!.create({
        name: 'Expiring',
        keyHash: 'hash-bbb',
        keyPrefix: 'oat_bbcc',
        scopes: ['*'],
        createdBy: 'admin',
        expiresAt,
      });

      expect(row.expiresAt).toBeInstanceOf(Date);
      expect(row.expiresAt!.toISOString()).toBe(expiresAt.toISOString());
    });

    test('enforces unique key_hash constraint', async () => {
      await repo!.create({
        name: 'First',
        keyHash: 'hash-unique',
        keyPrefix: 'oat_aaaa',
        scopes: ['*'],
        createdBy: 'admin',
      });

      await expect(
        repo!.create({
          name: 'Duplicate Hash',
          keyHash: 'hash-unique',
          keyPrefix: 'oat_bbbb',
          scopes: ['*'],
          createdBy: 'admin',
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // findByHash
  // -------------------------------------------------------------------------
  describe('findByHash', () => {
    test('returns the row for a known hash', async () => {
      const created = await repo!.create({
        name: 'Lookup',
        keyHash: 'hash-lookup',
        keyPrefix: 'oat_look',
        scopes: ['sessions.read'],
        createdBy: 'admin',
      });

      const found = await repo!.findByHash('hash-lookup');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test('returns null for an unknown hash', async () => {
      const found = await repo!.findByHash('hash-does-not-exist');
      expect(found).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------
  describe('findById', () => {
    test('returns the row for a known id', async () => {
      const created = await repo!.create({
        name: 'By ID',
        keyHash: 'hash-by-id',
        keyPrefix: 'oat_byid',
        scopes: ['*'],
        createdBy: 'admin',
      });

      const found = await repo!.findById(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('By ID');
    });

    test('returns null for an unknown id', async () => {
      const found = await repo!.findById('nonexistent-id');
      expect(found).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  describe('list', () => {
    test('returns all rows ordered newest-first', async () => {
      await repo!.create({
        name: 'First',
        keyHash: 'hash-1',
        keyPrefix: 'oat_1111',
        scopes: ['*'],
        createdBy: 'admin',
      });
      await repo!.create({
        name: 'Second',
        keyHash: 'hash-2',
        keyPrefix: 'oat_2222',
        scopes: ['*'],
        createdBy: 'admin',
      });
      await repo!.create({
        name: 'Third',
        keyHash: 'hash-3',
        keyPrefix: 'oat_3333',
        scopes: ['*'],
        createdBy: 'admin',
      });

      const rows = await repo!.list();
      expect(rows).toHaveLength(3);
      expect(rows[0]!.name).toBe('Third');
      expect(rows[2]!.name).toBe('First');
    });

    test('returns empty array when no tokens exist', async () => {
      const rows = await repo!.list();
      expect(rows).toHaveLength(0);
    });

    test('includes both active and revoked tokens', async () => {
      const tok = await repo!.create({
        name: 'Active',
        keyHash: 'hash-a',
        keyPrefix: 'oat_aaaa',
        scopes: ['*'],
        createdBy: 'admin',
      });
      await repo!.create({
        name: 'Revoked',
        keyHash: 'hash-r',
        keyPrefix: 'oat_rrrr',
        scopes: ['*'],
        createdBy: 'admin',
      });
      await repo!.revoke(tok.id);

      const rows = await repo!.list();
      expect(rows).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // revoke
  // -------------------------------------------------------------------------
  describe('revoke', () => {
    test('marks the token as revoked and returns the updated row', async () => {
      const created = await repo!.create({
        name: 'Revokable',
        keyHash: 'hash-rev',
        keyPrefix: 'oat_revv',
        scopes: ['sessions.read'],
        createdBy: 'admin',
      });

      expect(created.revoked).toBeFalsy();

      const revoked = await repo!.revoke(created.id);
      expect(revoked).not.toBeNull();
      expect(revoked!.revoked).toBeTruthy();
      expect(revoked!.id).toBe(created.id);
    });

    test('returns null for a non-existent id', async () => {
      const result = await repo!.revoke('no-such-id');
      expect(result).toBeNull();
    });

    test('revoking twice is idempotent', async () => {
      const created = await repo!.create({
        name: 'Double Revoke',
        keyHash: 'hash-dbl',
        keyPrefix: 'oat_dddd',
        scopes: ['*'],
        createdBy: 'admin',
      });

      await repo!.revoke(created.id);
      const second = await repo!.revoke(created.id);
      expect(second!.revoked).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // touchLastUsed
  // -------------------------------------------------------------------------
  describe('touchLastUsed', () => {
    test('sets lastUsedAt on the row', async () => {
      const before = Date.now();
      const created = await repo!.create({
        name: 'Touch',
        keyHash: 'hash-touch',
        keyPrefix: 'oat_tttt',
        scopes: ['*'],
        createdBy: 'admin',
      });

      expect(created.lastUsedAt).toBeNull();

      await repo!.touchLastUsed(created.id);

      const updated = await repo!.findById(created.id);
      expect(updated!.lastUsedAt).toBeInstanceOf(Date);
      expect(updated!.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    test('updates lastUsedAt on repeated calls', async () => {
      const created = await repo!.create({
        name: 'Touch Again',
        keyHash: 'hash-touch2',
        keyPrefix: 'oat_tttu',
        scopes: ['*'],
        createdBy: 'admin',
      });

      await repo!.touchLastUsed(created.id);
      const first = (await repo!.findById(created.id))!.lastUsedAt!.getTime();

      await new Promise((r) => setTimeout(r, 10));
      await repo!.touchLastUsed(created.id);
      const second = (await repo!.findById(created.id))!.lastUsedAt!.getTime();

      expect(second).toBeGreaterThanOrEqual(first);
    });
  });
});
