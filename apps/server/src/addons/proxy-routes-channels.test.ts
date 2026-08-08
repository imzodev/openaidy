/**
 * Addon proxy routes — channel endpoints
 *
 * Tests the HTTP layer for:
 *   GET  /api/addon-proxy/channels
 *   GET  /api/addon-proxy/channels/:id/status
 *   POST /api/addon-proxy/channels/:id/connect
 *   POST /api/addon-proxy/channels/:id/disconnect
 *
 * Uses a minimal Fastify instance with the addonProxyRoutes plugin so we
 * exercise the full request → auth → permission → service path without
 * spinning up the entire application.
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { addonProxyRoutes } from './proxy-routes';
import { AddonService } from './service';
import { ChannelRegistry } from '../channels/registry';
import type { IChannel } from '../channels/interface';
import type { Addon } from '@openaidy/db';

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

function makeAddonService() {
  return new AddonService({
    repository: null as never,
    validator: null as never,
    jwtSecret: JWT_SECRET,
    openAidyVersion: '0.0.0',
  });
}

function makeEnabledAddon(addonId: string, permissions: string[]): Addon {
  return {
    id: 'db-row-id',
    addonId,
    name: 'Test Addon',
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

function makeChannel(id: string): IChannel {
  return {
    id,
    type: 'whatsapp',
    agentId: 'default',
    getStatus: vi.fn().mockReturnValue('connected'),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    onStatusChange: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as IChannel;
}

function makeChannelRegistry(channels: IChannel[] = []): ChannelRegistry {
  const registry = new ChannelRegistry();
  for (const channel of channels) registry.register(channel);
  return registry;
}

async function buildProxyApp(opts: {
  addon: Addon | null;
  channelRegistry?: ChannelRegistry;
}): Promise<{ app: FastifyInstance; token: string }> {
  const addonSvc = makeAddonService();

  const permissions = (opts.addon?.permissions as string[]) ?? [];
  const addonId = opts.addon?.addonId ?? 'test-addon';
  const token = (
    addonSvc as unknown as {
      generateAccessToken: (id: string, perms: string[]) => string;
    }
  ).generateAccessToken(addonId, permissions);

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
        ...(opts.channelRegistry
          ? { channelRegistry: opts.channelRegistry }
          : {}),
      });
    },
    { prefix: '/api' },
  );

  return { app, token };
}

describe('GET /api/addon-proxy/channels', () => {
  it('returns 403 when addon lacks channels.list permission', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.read']),
      channelRegistry: makeChannelRegistry([makeChannel('wa-1')]),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/channels',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PERMISSION_DENIED');
  });

  it('returns empty items when no channelRegistry is wired', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.list']),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/channels',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('lists channels with their status', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.list']),
      channelRegistry: makeChannelRegistry([makeChannel('wa-1')]),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/channels',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([
      { id: 'wa-1', type: 'whatsapp', status: 'connected', agentId: 'default' },
    ]);
  });
});

describe('GET /api/addon-proxy/channels/:id/status', () => {
  it('returns 404 when the channel is not found', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.read']),
      channelRegistry: makeChannelRegistry(),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/channels/missing/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns the channel status', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.read']),
      channelRegistry: makeChannelRegistry([makeChannel('wa-1')]),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/addon-proxy/channels/wa-1/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 'wa-1',
      type: 'whatsapp',
      status: 'connected',
      agentId: 'default',
    });
  });
});

describe('POST /api/addon-proxy/channels/:id/connect', () => {
  it('returns 403 when addon lacks channels.manage permission', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.list']),
      channelRegistry: makeChannelRegistry([makeChannel('wa-1')]),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/channels/wa-1/connect',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('calls connect() on the channel', async () => {
    const channel = makeChannel('wa-1');
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.manage']),
      channelRegistry: makeChannelRegistry([channel]),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/channels/wa-1/connect',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(channel.connect).toHaveBeenCalled();
  });
});

describe('POST /api/addon-proxy/channels/:id/disconnect', () => {
  it('calls disconnect() on the channel', async () => {
    const channel = makeChannel('wa-1');
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.manage']),
      channelRegistry: makeChannelRegistry([channel]),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/channels/wa-1/disconnect',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(channel.disconnect).toHaveBeenCalled();
  });

  it('returns 404 when the channel is not found', async () => {
    const { app, token } = await buildProxyApp({
      addon: makeEnabledAddon('test-addon', ['channels.manage']),
      channelRegistry: makeChannelRegistry(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/addon-proxy/channels/missing/disconnect',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
