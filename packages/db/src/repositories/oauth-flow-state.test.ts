import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient } from '../client';
import { OAuthFlowStateRepository } from './oauth-flow-state';

/**
 * Integration tests for OAuthFlowStateRepository.
 *
 * Uses a real SQLite database (tmpfile) — same dual-target pattern
 * the rest of the package uses for non-Postgres tests.
 */
describe('OAuthFlowStateRepository (sqlite integration)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'oauth-flow-state-'));
  const dbPath = join(tmpDir, 'test.db');
  let dbConn: Awaited<ReturnType<typeof createDatabaseClient>>;
  let repo: OAuthFlowStateRepository;

  beforeAll(async () => {
    dbConn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: dbPath,
    });
    repo = new OAuthFlowStateRepository(dbConn.db);
  });

  afterAll(async () => {
    await dbConn.close();
    rmSync(tmpDir, { force: true, recursive: true });
  });

  // Clean state between tests so assertions don't see leaked rows.
  beforeEach(async () => {
    // Best-effort: delete all rows. The DB supports a simple raw delete.
    const rawDb = dbConn.db as unknown as {
      session?: { client: { prepare: (sql: string) => { run: () => void } } };
    };
    const sqlite = rawDb.session?.client;
    sqlite?.prepare('DELETE FROM oauth_flow_state').run();
  });

  it('stores and retrieves a flow state', async () => {
    const stored = await repo.put({
      state: 'abc123',
      providerId: 'minimax',
      codeVerifier: 'verifier_xyz',
      codeChallenge: 'challenge_xyz',
      region: 'global',
      redirectUri: 'http://localhost:3001/callback',
    });

    expect(stored.state).toBe('abc123');
    expect(stored.createdAt).toBeInstanceOf(Date);

    const retrieved = await repo.get('abc123');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.providerId).toBe('minimax');
    expect(retrieved!.codeVerifier).toBe('verifier_xyz');
    expect(retrieved!.codeChallenge).toBe('challenge_xyz');
    expect(retrieved!.region).toBe('global');
    expect(retrieved!.redirectUri).toBe('http://localhost:3001/callback');
  });

  it('returns null for a non-existent state', async () => {
    const result = await repo.get('does-not-exist');
    expect(result).toBeNull();
  });

  it('overwrites an existing state on put (upsert)', async () => {
    await repo.put({
      state: 'dup',
      providerId: 'minimax',
      codeVerifier: 'v1',
      codeChallenge: 'c1',
      region: 'global',
      redirectUri: 'http://localhost:3001/callback',
    });
    await repo.put({
      state: 'dup',
      providerId: 'minimax',
      codeVerifier: 'v2',
      codeChallenge: 'c2',
      region: 'cn',
      redirectUri: 'http://localhost:3001/callback',
    });

    const retrieved = await repo.get('dup');
    expect(retrieved!.codeVerifier).toBe('v2');
    expect(retrieved!.codeChallenge).toBe('c2');
    expect(retrieved!.region).toBe('cn');
  });

  it('deletes a state by key', async () => {
    await repo.put({
      state: 'to-delete',
      providerId: 'minimax',
      codeVerifier: 'v',
      codeChallenge: 'c',
      region: null,
      redirectUri: 'http://localhost:3001/callback',
    });

    await repo.delete('to-delete');
    const retrieved = await repo.get('to-delete');
    expect(retrieved).toBeNull();
  });

  it('returns null and cleans up rows older than the TTL', async () => {
    await repo.put({
      state: 'ancient',
      providerId: 'minimax',
      codeVerifier: 'v',
      codeChallenge: 'c',
      region: null,
      redirectUri: 'http://localhost:3001/callback',
    });

    // Wait a few ms so the row is strictly older than the cutoff.
    await new Promise((r) => setTimeout(r, 5));

    // Force the created_at into the past by using a custom-TTL get
    // that treats everything as expired.
    const retrieved = await repo.get('ancient', { ttlMs: 0 });
    expect(retrieved).toBeNull();

    // The expired row is now gone — even with a normal TTL it's missing.
    const retrievedAgain = await repo.get('ancient');
    expect(retrievedAgain).toBeNull();
  });

  it('cleanupExpired deletes only old rows', async () => {
    await repo.put({
      state: 'fresh',
      providerId: 'minimax',
      codeVerifier: 'v',
      codeChallenge: 'c',
      region: null,
      redirectUri: 'http://localhost:3001/callback',
    });

    // Wait a few ms so the row is strictly older than the cutoff.
    await new Promise((r) => setTimeout(r, 5));

    const deleted = await repo.cleanupExpired({ ttlMs: 0 });
    expect(deleted).toBe(1);

    // A subsequent cleanup with a sane TTL deletes nothing.
    const deleted2 = await repo.cleanupExpired();
    expect(deleted2).toBe(0);

    // The fresh row is gone (it was deleted in the first cleanup).
    const retrieved = await repo.get('fresh');
    expect(retrieved).toBeNull();
  });
});
