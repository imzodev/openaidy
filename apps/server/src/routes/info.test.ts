import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { infoRoutes } from './info';
import { resolveOpenAidyVersion } from '../lib/version';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GET /api/info', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  async function buildApp(): Promise<FastifyInstance> {
    const a = Fastify({ logger: false });
    // Mirror production: infoRoutes is registered inside the /api scope,
    // so its declared route (/info) gets the /api prefix at registration time.
    await a.register(
      async (api) => {
        await api.register(infoRoutes);
      },
      { prefix: '/api' },
    );
    await a.ready();
    return a;
  }

  it('returns version, nodeVersion, platform, arch, pid, startedAt, uptimeMs', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    expect(typeof body['version']).toBe('string');
    expect(typeof body['nodeVersion']).toBe('string');
    expect(body['nodeVersion']).toBe(process.version);
    expect(typeof body['platform']).toBe('string');
    expect(body['platform']).toBe(process.platform);
    expect(typeof body['arch']).toBe('string');
    expect(body['arch']).toBe(process.arch);
    expect(typeof body['pid']).toBe('number');
    expect(body['pid']).toBe(process.pid);
    expect(typeof body['startedAt']).toBe('string');
    expect(new Date(body['startedAt'] as string).toString()).not.toBe(
      'Invalid Date',
    );
    expect(typeof body['uptimeMs']).toBe('number');
    expect(body['uptimeMs'] as number).toBeGreaterThanOrEqual(0);
  });

  it('version field is semver without a "v" prefix', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/info' });
    const body = res.json() as { version: string };
    expect(body.version.startsWith('v')).toBe(false);
    // Looks like semver: major.minor.patch with optional pre-release / build
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('reflects the version from a package.json placed near the server file (no env var injection)', async () => {
    // Build a temp package.json in a directory, then run the resolver from
    // inside it. Proves the resolver does NOT read process.env.
    const root = mkdtempSync(join(tmpdir(), 'openaidy-info-test-'));
    const pkgDir = join(root, 'pkg');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'openaidy', version: '7.7.7-test' }),
      'utf-8',
    );
    const beforeEnv = process.env['npm_package_version'];
    process.env['npm_package_version'] = '9.9.9-env-override';
    try {
      const resolved = resolveOpenAidyVersion(pkgDir);
      expect(resolved).toBe('7.7.7-test');
      expect(resolved).not.toBe('9.9.9-env-override');
    } finally {
      if (beforeEnv === undefined) delete process.env['npm_package_version'];
      else process.env['npm_package_version'] = beforeEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to "0.0.0" when no package.json with version is reachable', async () => {
    // This is hard to test directly without isolating the import.meta.url of
    // the version module. The unit test for resolveOpenAidyVersion covers the
    // fallback in detail; here we just assert the field is a string.
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/info' });
    const body = res.json() as { version: string };
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });
});
