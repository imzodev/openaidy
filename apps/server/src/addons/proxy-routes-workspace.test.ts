/**
 * Addon proxy routes — workspace file-sharing endpoint
 *
 * Tests the HTTP layer for:
 *   POST /api/addon-proxy/workspace/:agentId/files
 *
 * Uses a minimal Fastify instance with the addonProxyRoutes plugin plus a
 * real WorkspaceService backed by a temp directory, so path-traversal
 * guarding and actual file writes are exercised end to end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addonProxyRoutes } from './proxy-routes';
import { AddonService } from './service';
import { createWorkspaceService, type WorkspaceService } from '../workspace';
import type { Addon } from '@openaidy/db';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

function makeAddon(addonId: string, permissions: string[]): Addon {
  return {
    id: 'db-row-id',
    addonId,
    name: 'Workspace Addon',
    version: '1.0.0',
    status: 'enabled',
    permissions,
    manifest: { permissions },
    config: {},
    installedAt: new Date(),
    updatedAt: new Date(),
    installedBy: 'admin',
  } as unknown as Addon;
}

async function buildApp(opts: {
  addon: Addon;
  workspaceService?: WorkspaceService;
}): Promise<{ app: FastifyInstance; token: string }> {
  const addonSvc = new AddonService({
    repository: null as never,
    validator: null as never,
    jwtSecret: JWT_SECRET,
    openAidyVersion: '0.0.0',
  });
  const token = (
    addonSvc as unknown as {
      generateAccessToken: (id: string, perms: string[]) => string;
    }
  ).generateAccessToken(opts.addon.addonId, opts.addon.permissions as string[]);

  vi.spyOn(addonSvc as never, 'getAddon' as never).mockResolvedValue(
    opts.addon as never,
  );
  vi.spyOn(addonSvc as never, 'recordUsage' as never).mockResolvedValue(
    undefined as never,
  );

  const app = Fastify({ logger: false });
  await app.register(
    async (api: FastifyInstance) => {
      await api.register(addonProxyRoutes, {
        addonService: addonSvc,
        authMiddleware: null as never,
        internalApiBaseUrl: '',
        ...(opts.workspaceService
          ? { workspaceService: opts.workspaceService }
          : {}),
      });
    },
    { prefix: '/api' },
  );

  return { app, token };
}

describe('POST /api/addon-proxy/workspace/:agentId/files', () => {
  let baseDir: string;
  let workspaceService: WorkspaceService;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'addon-workspace-test-'));
    workspaceService = createWorkspaceService({ baseDir });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const { app } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write']),
      workspaceService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      payload: { path: 'note.txt', data: Buffer.from('hi').toString('base64') },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when addon lacks workspace.write permission', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['sessions.write']), // no workspace.write
      workspaceService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: { path: 'note.txt', data: Buffer.from('hi').toString('base64') },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PERMISSION_DENIED');
  });

  it('returns 403 when addon is scoped to a different agent', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write:agent-2']),
      workspaceService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: { path: 'note.txt', data: Buffer.from('hi').toString('base64') },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('AGENT_NOT_ALLOWED');
  });

  it('returns 400 when path or data is missing', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write']),
      workspaceService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: { path: 'note.txt' }, // missing data
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_REQUEST');
  });

  it('returns 400 when the path attempts to escape the workspace', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write']),
      workspaceService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        path: '../../etc/passwd',
        data: Buffer.from('hi').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('PATH_TRAVERSAL_BLOCKED');
  });

  it('returns 413 when the decoded file exceeds the size cap', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write']),
      workspaceService,
    });
    const oversized = Buffer.alloc(26 * 1024 * 1024).toString('base64'); // > 25MB cap
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: { path: 'big.bin', data: oversized },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('FILE_TOO_LARGE');
  });

  it('returns 503 when no workspaceService is wired', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write']),
      // no workspaceService
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: { path: 'note.txt', data: Buffer.from('hi').toString('base64') },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('SERVICE_UNAVAILABLE');
  });

  it('writes the file into the agent workspace with unscoped permission', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write']),
      workspaceService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        path: 'shared/report.csv',
        data: Buffer.from('a,b\n1,2').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      agentId: 'agent-1',
      path: 'shared/report.csv',
    });

    const written = readFileSync(
      join(baseDir, 'agent-1', 'shared', 'report.csv'),
      'utf-8',
    );
    expect(written).toBe('a,b\n1,2');
  });

  it('writes the file with a scoped workspace.write:<agentId> permission', async () => {
    const { app, token } = await buildApp({
      addon: makeAddon('test-addon', ['workspace.write:agent-1']),
      workspaceService,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/workspace/agent-1/files',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        path: 'note.txt',
        data: Buffer.from('hello').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(201);

    const written = readFileSync(join(baseDir, 'agent-1', 'note.txt'), 'utf-8');
    expect(written).toBe('hello');
  });
});
