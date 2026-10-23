import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient } from '../client';
import { McpOAuthCredentialsRepository } from './mcp-oauth-credentials';

describe('McpOAuthCredentialsRepository (sqlite integration)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcp-oauth-credentials-'));
  let dbConn: Awaited<ReturnType<typeof createDatabaseClient>>;
  let repo: McpOAuthCredentialsRepository;

  beforeAll(async () => {
    dbConn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: join(tmpDir, 'test.db'),
    });
    repo = new McpOAuthCredentialsRepository(dbConn.db);
  });

  afterAll(async () => {
    await dbConn.close();
    rmSync(tmpDir, { force: true, recursive: true });
  });

  it('returns null for an unknown server', async () => {
    expect(await repo.get('missing')).toBeNull();
  });

  it('stores, replaces and deletes a server blob', async () => {
    await repo.put('notion', 'cipher-1');
    expect(await repo.get('notion')).toBe('cipher-1');

    await repo.put('notion', 'cipher-2');
    expect(await repo.get('notion')).toBe('cipher-2');

    await repo.delete('notion');
    expect(await repo.get('notion')).toBeNull();
  });

  it('keeps servers independent', async () => {
    await repo.put('a', 'x');
    await repo.put('b', 'y');
    await repo.delete('a');
    expect(await repo.get('a')).toBeNull();
    expect(await repo.get('b')).toBe('y');
  });
});
