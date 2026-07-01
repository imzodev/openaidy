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
  extractFromQuery: (_q: Record<string, string | undefined>) => null,
  hasCapability: () => true,
} as unknown as AuthMiddleware;

const noAuthMiddleware = {
  validateToken: async () => null,
  extractFromHeader: (_h: string) => null,
  extractFromQuery: (_q: Record<string, string | undefined>) => null,
  hasCapability: () => false,
} as unknown as AuthMiddleware;

// Authenticated with a valid token but WITHOUT the admin scope.
const nonAdminAuthMiddleware = {
  validateToken: async () => ({
    sub: 'test',
    scopes: ['sessions.read'],
    type: 'access' as const,
    iat: 0,
    exp: 9999999999,
  }),
  extractFromHeader: (_h: string) => 'test-token',
  extractFromQuery: (_q: Record<string, string | undefined>) => null,
  hasCapability: (_scopes: string[], cap: string) => cap !== '*',
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
  await app.register(
    async (instance: FastifyInstance) => {
      await registerMcpRoutes(instance, {
        mcpService,
        configService,
        authMiddleware,
      });
    },
    { prefix: '/api' },
  );
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
      const res = await app.inject({ method: 'GET', url: '/api/mcp/servers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.servers).toHaveLength(2);
    });

    it('reflects live connection status', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/mcp/servers' });
      const body = res.json();
      const a = body.servers.find((s: { id: string }) => s.id === 'srv-a');
      const b = body.servers.find((s: { id: string }) => s.id === 'srv-b');
      expect(a.connected).toBe(true);
      expect(b.connected).toBe(false);
    });

    it('includes toolCount for connected servers', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/mcp/servers' });
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
        url: '/api/mcp/servers',
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
        url: '/api/mcp/servers/srv-a',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.server.id).toBe('srv-a');
      expect(body.server.connected).toBe(true);
    });

    it('returns 404 for unknown id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/servers/ghost',
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
        url: '/api/mcp/servers/srv-a',
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
        url: '/api/mcp/servers/connected-srv/tools',
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
        url: '/api/mcp/servers/disconnected-srv/tools',
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
        url: '/api/mcp/servers',
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
        url: '/api/mcp/servers',
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
        url: '/api/mcp/servers',
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
        url: '/api/mcp/servers',
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
        url: '/api/mcp/servers/srv-a',
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
        url: '/api/mcp/servers/ghost',
        headers: { 'content-type': 'application/json' },
        payload: { name: 'New Name' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('persists the update via configService.save', async () => {
      await app.inject({
        method: 'PATCH',
        url: '/api/mcp/servers/srv-a',
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
        url: '/api/mcp/servers/srv-a',
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
        url: '/api/mcp/servers/srv-a',
      });
      expect(res.statusCode).toBe(204);
    });

    it('disconnects the server if connected', async () => {
      await app.inject({ method: 'DELETE', url: '/api/mcp/servers/srv-a' });
      expect(mcpService.disconnect).toHaveBeenCalledWith('srv-a');
    });

    it('returns 404 for unknown server', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/mcp/servers/ghost',
      });
      expect(res.statusCode).toBe(404);
    });

    it('persists removal via configService.save', async () => {
      await app.inject({ method: 'DELETE', url: '/api/mcp/servers/srv-a' });
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
        url: '/api/mcp/servers/srv-a',
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
        url: '/api/mcp/servers/srv-a/connect',
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
        url: '/api/mcp/servers/srv-a/connect',
      });
      expect(res.statusCode).toBe(200);
      expect(mcpService.connect).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown server', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers/ghost/connect',
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
        url: '/api/mcp/servers/srv-a/connect',
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
        url: '/api/mcp/servers/srv-a/disconnect',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.disconnected).toBe(true);
      expect(mcpService.disconnect).toHaveBeenCalledWith('srv-a');
    });

    it('returns 404 for unknown server', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers/ghost/disconnect',
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
        url: '/api/mcp/servers/srv-a/disconnect',
      });
      expect(res.statusCode).toBe(401);
      await unauthApp.close();
    });
  });

  // -------------------------------------------------------------------------
  describe('secret redaction', () => {
    beforeEach(async () => {
      const servers = [
        makeServerConfig({
          id: 'http-srv',
          transport: 'http',
          command: undefined,
          args: undefined,
          url: 'https://api.githubcopilot.com/mcp/',
          headers: { Authorization: 'Bearer ${GH_TOKEN}' },
          env: { INLINE: 'raw-secret-value', PLACEHOLDER: '${SOME_VAR}' },
        }),
      ];
      mcpService = makeMcpService(servers, []);
      configService = makeConfigService(servers);
      app = await buildApp(mcpService, configService);
    });

    it('masks mixed/inlined secret values but preserves ${VAR} placeholders', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/servers/http-srv',
      });
      expect(res.statusCode).toBe(200);
      const { server } = res.json();
      // Bearer ${GH_TOKEN} embeds a placeholder → treated as a secret → masked.
      expect(server.headers.Authorization).not.toContain('${GH_TOKEN}');
      expect(server.headers.Authorization).toBe('••••••');
      // Inlined raw value masked; pure placeholder preserved.
      expect(server.env.INLINE).toBe('••••••');
      expect(server.env.PLACEHOLDER).toBe('${SOME_VAR}');
    });

    it('never leaks secrets in the list endpoint either', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/mcp/servers' });
      const body = res.json();
      expect(JSON.stringify(body)).not.toContain('raw-secret-value');
    });
  });

  // -------------------------------------------------------------------------
  describe('admin scope enforcement', () => {
    beforeEach(async () => {
      mcpService = makeMcpService([], []);
      configService = makeConfigService([]);
    });

    it('rejects a create from a non-admin (authenticated) token with 403', async () => {
      app = await buildApp(mcpService, configService, nonAdminAuthMiddleware);
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers',
        headers: { 'content-type': 'application/json' },
        payload: { config: { id: 'x', transport: 'stdio', command: 'echo' } },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('INSUFFICIENT_SCOPE');
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /mcp/servers/import', () => {
    beforeEach(async () => {
      mcpService = makeMcpService([], []);
      configService = makeConfigService([]);
      app = await buildApp(mcpService, configService);
    });

    it('imports the Claude-Desktop http map format and connects', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers/import',
        headers: { 'content-type': 'application/json' },
        payload: {
          mcpServers: {
            github: {
              type: 'http',
              url: 'https://api.githubcopilot.com/mcp/',
              headers: {
                Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}',
              },
            },
          },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.servers).toHaveLength(1);
      expect(body.servers[0].id).toBe('github');
      expect(body.servers[0].transport).toBe('http');
      // Persisted with transport (not the raw "type") and connected.
      const stored = configService.getMcpServer('github');
      expect(stored?.transport).toBe('http');
      expect(mcpService.connect).toHaveBeenCalled();
      // Secret still redacted in the response.
      expect(body.servers[0].headers.Authorization).toBe('••••••');
    });

    it('imports multiple servers in one call', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers/import',
        headers: { 'content-type': 'application/json' },
        payload: {
          mcpServers: {
            github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
            fs: { command: 'npx', args: ['-y', 'server-fs'] },
          },
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().servers).toHaveLength(2);
    });

    it('returns 400 for an invalid entry (nothing persisted)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers/import',
        headers: { 'content-type': 'application/json' },
        payload: { mcpServers: { bad: { type: 'sse', url: 'https://e.com' } } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CONFIG');
      expect(configService.save).not.toHaveBeenCalled();
    });

    it('returns 409 when an id already exists (all-or-nothing)', async () => {
      configService = makeConfigService([makeServerConfig({ id: 'github' })]);
      app = await buildApp(mcpService, configService);
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers/import',
        headers: { 'content-type': 'application/json' },
        payload: {
          mcpServers: {
            github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
          },
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('CONFLICT');
      expect(configService.save).not.toHaveBeenCalled();
    });

    it('requires admin scope (403 for non-admin token)', async () => {
      app = await buildApp(mcpService, configService, nonAdminAuthMiddleware);
      const res = await app.inject({
        method: 'POST',
        url: '/api/mcp/servers/import',
        headers: { 'content-type': 'application/json' },
        payload: {
          mcpServers: { github: { type: 'http', url: 'https://e.com/mcp' } },
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('PATCH secret round-trip safety', () => {
    it('keeps the stored secret when the client echoes back a masked value', async () => {
      const servers = [
        makeServerConfig({
          id: 'http-srv',
          transport: 'http',
          command: undefined,
          args: undefined,
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer ${GH_TOKEN}' },
        }),
      ];
      mcpService = makeMcpService(servers, []);
      configService = makeConfigService(servers);
      app = await buildApp(mcpService, configService);

      await app.inject({
        method: 'PATCH',
        url: '/api/mcp/servers/http-srv',
        headers: { 'content-type': 'application/json' },
        // Client re-sends the masked value it received from a GET.
        payload: { headers: { Authorization: '••••••' } },
      });

      const stored = configService.getMcpServer('http-srv');
      expect(stored?.headers?.Authorization).toBe('Bearer ${GH_TOKEN}');
    });
  });
});
