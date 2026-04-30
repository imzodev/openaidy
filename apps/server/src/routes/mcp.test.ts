import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { registerMcpRoutes } from './mcp';
import type { McpClientService } from '../mcp/client';
import type { AppConfigService } from '../config/service';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import type { McpServerConfig } from '@openaidy/config';

// ---------------------------------------------------------------------------
// Helpers / stubs
// ---------------------------------------------------------------------------

const mockAuthMiddleware = {
  validateToken: async () => ({
    sub: 'test',
    scopes: ['*'],
    type: 'access' as const,
    iat: 0,
    exp: 9999999999,
  }),
  extractFromHeader: (_h: string) => 'test-token',
  hasCapability: () => true,
} as unknown as AuthMiddleware;

const noAuthMiddleware = {
  validateToken: async () => null,
  extractFromHeader: (_h: string) => null,
  hasCapability: () => false,
} as unknown as AuthMiddleware;

function makeServerConfig(
  overrides: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    id: 'test-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    ...overrides,
  } as McpServerConfig;
}

function makeMcpService(
  _servers: McpServerConfig[] = [],
  connected: string[] = [],
): McpClientService {
  return {
    isConnected: vi.fn((id: string) => connected.includes(id)),
    getConnectedServers: vi.fn(() => connected),
    getTools: vi.fn((_id: string) => [
      {
        name: 'tool-one',
        description: 'Does one',
        inputSchema: { type: 'object' },
      },
    ]),
    connect: vi.fn(),
    disconnect: vi.fn(),
    callTool: vi.fn(),
  } as unknown as McpClientService;
}

function makeConfigService(servers: McpServerConfig[] = []): AppConfigService {
  let currentServers = [...servers];
  return {
    getConfig: vi.fn(() => ({
      version: 1,
      defaults: { providerId: 'openai', modelId: 'gpt-4o-mini' },
      providers: [],
      agents: [],
      mcpServers: currentServers,
    })),
    getMcpServers: vi.fn(() => currentServers),
    getMcpServer: vi.fn((id: string) =>
      currentServers.find((s) => s.id === id),
    ),
    save: vi.fn(async (cfg: { mcpServers?: McpServerConfig[] }) => {
      currentServers = cfg.mcpServers ?? [];
      return cfg;
    }),
  } as unknown as AppConfigService;
}

async function buildApp(
  mcpService: McpClientService,
  configService: AppConfigService,
  authMiddleware: AuthMiddleware = mockAuthMiddleware,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: '*' });
  await app.register(sensible);
  await app.register(websocket);
  await app.register(async (instance) => {
    await registerMcpRoutes(instance, {
      mcpService,
      configService,
      authMiddleware,
    });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Routes', () => {
  let app: FastifyInstance;
  let mcpService: McpClientService;
  let configService: AppConfigService;

  afterEach(async () => {
    await app?.close();
  });

  // -------------------------------------------------------------------------
  describe('GET /mcp/servers', () => {
    beforeEach(async () => {
      const servers = [
        makeServerConfig({ id: 'srv-a' }),
        makeServerConfig({ id: 'srv-b' }),
      ];
      mcpService = makeMcpService(servers, ['srv-a']);
      configService = makeConfigService(servers);
      app = await buildApp(mcpService, configService);
    });

    it('returns 200 with all configured servers', async () => {
      const res = await app.inject({ method: 'GET', url: '/mcp/servers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.servers).toHaveLength(2);
    });

    it('reflects live connection status', async () => {
      const res = await app.inject({ method: 'GET', url: '/mcp/servers' });
      const body = res.json();
      const a = body.servers.find((s: { id: string }) => s.id === 'srv-a');
      const b = body.servers.find((s: { id: string }) => s.id === 'srv-b');
      expect(a.connected).toBe(true);
      expect(b.connected).toBe(false);
    });

    it('includes toolCount for connected servers', async () => {
      const res = await app.inject({ method: 'GET', url: '/mcp/servers' });
      const body = res.json();
      const a = body.servers.find((s: { id: string }) => s.id === 'srv-a');
      expect(a.toolCount).toBe(1);
    });

    it('requires no auth (public endpoint)', async () => {
      const unauthApp = await buildApp(
        mcpService,
        configService,
        noAuthMiddleware,
      );
      const res = await unauthApp.inject({
        method: 'GET',
        url: '/mcp/servers',
      });
      expect(res.statusCode).toBe(200);
      await unauthApp.close();
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /mcp/servers/:id', () => {
    beforeEach(async () => {
      const servers = [makeServerConfig({ id: 'srv-a' })];
      mcpService = makeMcpService(servers, ['srv-a']);
      configService = makeConfigService(servers);
      app = await buildApp(mcpService, configService);
    });

    it('returns 200 with server record', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/servers/srv-a',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.server.id).toBe('srv-a');
      expect(body.server.connected).toBe(true);
    });

    it('returns 404 for unknown id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/servers/ghost',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('NOT_FOUND');
    });

    it('requires no auth (public endpoint)', async () => {
      const unauthApp = await buildApp(
        mcpService,
        configService,
        noAuthMiddleware,
      );
      const res = await unauthApp.inject({
        method: 'GET',
        url: '/mcp/servers/srv-a',
      });
      expect(res.statusCode).toBe(200);
      await unauthApp.close();
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /mcp/servers/:id/tools', () => {
    beforeEach(async () => {
      const servers = [
        makeServerConfig({ id: 'connected-srv' }),
        makeServerConfig({ id: 'disconnected-srv' }),
      ];
      mcpService = makeMcpService(servers, ['connected-srv']);
      configService = makeConfigService(servers);
      app = await buildApp(mcpService, configService);
    });

    it('returns 200 with tools for a connected server', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/servers/connected-srv/tools',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('tool-one');
      expect(body.tools[0].inputSchema).toBeDefined();
    });

    it('returns 503 (not 409) when server is not connected', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/servers/disconnected-srv/tools',
      });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error).toBe('NOT_CONNECTED');
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /mcp/servers', () => {
    beforeEach(async () => {
      mcpService = makeMcpService([], []);
      configService = makeConfigService([]);
      app = await buildApp(mcpService, configService);
    });

    it('returns 201 and creates a new server', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/mcp/servers',
        headers: { 'content-type': 'application/json' },
        payload: {
          config: { id: 'new-srv', transport: 'stdio', command: 'npx' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.server.id).toBe('new-srv');
    });

    it('returns 409 when server id already exists', async () => {
      configService = makeConfigService([makeServerConfig({ id: 'existing' })]);
      app = await buildApp(mcpService, configService);

      const res = await app.inject({
        method: 'POST',
        url: '/mcp/servers',
        headers: { 'content-type': 'application/json' },
        payload: { config: { id: 'existing', transport: 'stdio' } },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error).toBe('CONFLICT');
    });

    it('persists the new server config via configService.save', async () => {
      await app.inject({
        method: 'POST',
        url: '/mcp/servers',
        headers: { 'content-type': 'application/json' },
        payload: {
          config: { id: 'saved-srv', transport: 'stdio', command: 'echo' },
        },
      });
      expect(configService.save).toHaveBeenCalled();
    });

    it('returns 401 when no auth token provided', async () => {
      const unauthApp = await buildApp(
        mcpService,
        configService,
        noAuthMiddleware,
      );
      const res = await unauthApp.inject({
        method: 'POST',
        url: '/mcp/servers',
        headers: { 'content-type': 'application/json' },
        payload: { config: { id: 'new-srv', transport: 'stdio' } },
      });
      expect(res.statusCode).toBe(401);
      await unauthApp.close();
    });
  });

  // -------------------------------------------------------------------------
  describe('PATCH /mcp/servers/:id', () => {
    beforeEach(async () => {
      mcpService = makeMcpService([makeServerConfig({ id: 'srv-a' })], []);
      configService = makeConfigService([
        makeServerConfig({ id: 'srv-a', name: 'Old Name' }),
      ]);
      app = await buildApp(mcpService, configService);
    });

    it('returns 200 with updated server', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/mcp/servers/srv-a',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'New Name' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.server.id).toBe('srv-a');
    });

    it('returns 404 for unknown server', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/mcp/servers/ghost',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'New Name' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('persists the update via configService.save', async () => {
      await app.inject({
        method: 'PATCH',
        url: '/mcp/servers/srv-a',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'Updated' },
      });
      expect(configService.save).toHaveBeenCalled();
    });

    it('returns 401 without auth', async () => {
      const unauthApp = await buildApp(
        mcpService,
        configService,
        noAuthMiddleware,
      );
      const res = await unauthApp.inject({
        method: 'PATCH',
        url: '/mcp/servers/srv-a',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(401);
      await unauthApp.close();
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /mcp/servers/:id', () => {
    beforeEach(async () => {
      mcpService = makeMcpService(
        [makeServerConfig({ id: 'srv-a' })],
        ['srv-a'],
      );
      configService = makeConfigService([makeServerConfig({ id: 'srv-a' })]);
      app = await buildApp(mcpService, configService);
    });

    it('returns 204 and removes the server', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/mcp/servers/srv-a',
      });
      expect(res.statusCode).toBe(204);
    });

    it('disconnects the server if connected', async () => {
      await app.inject({ method: 'DELETE', url: '/mcp/servers/srv-a' });
      expect(mcpService.disconnect).toHaveBeenCalledWith('srv-a');
    });

    it('returns 404 for unknown server', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/mcp/servers/ghost',
      });
      expect(res.statusCode).toBe(404);
    });

    it('persists removal via configService.save', async () => {
      await app.inject({ method: 'DELETE', url: '/mcp/servers/srv-a' });
      expect(configService.save).toHaveBeenCalled();
    });

    it('returns 401 without auth', async () => {
      const unauthApp = await buildApp(
        mcpService,
        configService,
        noAuthMiddleware,
      );
      const res = await unauthApp.inject({
        method: 'DELETE',
        url: '/mcp/servers/srv-a',
      });
      expect(res.statusCode).toBe(401);
      await unauthApp.close();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /mcp/servers/:id/connect', () => {
    beforeEach(async () => {
      mcpService = makeMcpService([makeServerConfig({ id: 'srv-a' })], []);
      configService = makeConfigService([makeServerConfig({ id: 'srv-a' })]);
      app = await buildApp(mcpService, configService);
    });

    it('returns 200 and connects successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/mcp/servers/srv-a/connect',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connected).toBe(true);
      expect(mcpService.connect).toHaveBeenCalled();
    });

    it('returns immediately if already connected (idempotent)', async () => {
      mcpService = makeMcpService(
        [makeServerConfig({ id: 'srv-a' })],
        ['srv-a'],
      );
      configService = makeConfigService([makeServerConfig({ id: 'srv-a' })]);
      app = await buildApp(mcpService, configService);

      const res = await app.inject({
        method: 'POST',
        url: '/mcp/servers/srv-a/connect',
      });
      expect(res.statusCode).toBe(200);
      expect(mcpService.connect).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown server', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/mcp/servers/ghost/connect',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const unauthApp = await buildApp(
        mcpService,
        configService,
        noAuthMiddleware,
      );
      const res = await unauthApp.inject({
        method: 'POST',
        url: '/mcp/servers/srv-a/connect',
      });
      expect(res.statusCode).toBe(401);
      await unauthApp.close();
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /mcp/servers/:id/disconnect', () => {
    beforeEach(async () => {
      mcpService = makeMcpService(
        [makeServerConfig({ id: 'srv-a' })],
        ['srv-a'],
      );
      configService = makeConfigService([makeServerConfig({ id: 'srv-a' })]);
      app = await buildApp(mcpService, configService);
    });

    it('returns 200 and disconnects', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/mcp/servers/srv-a/disconnect',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disconnected).toBe(true);
      expect(mcpService.disconnect).toHaveBeenCalledWith('srv-a');
    });

    it('returns 404 for unknown server', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/mcp/servers/ghost/disconnect',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const unauthApp = await buildApp(
        mcpService,
        configService,
        noAuthMiddleware,
      );
      const res = await unauthApp.inject({
        method: 'POST',
        url: '/mcp/servers/srv-a/disconnect',
      });
      expect(res.statusCode).toBe(401);
      await unauthApp.close();
    });
  });
});
