import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { workspaceRoutes } from './workspace';
import { createAgentRegistry, type AgentRegistry } from '../agents/registry';
import { createWorkspaceService, WorkspaceService } from '../workspace/service';
import type { Agent } from '../agents/schema';
import type { AuthMiddleware } from '../websocket/middleware/auth';

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

describe('workspace routes', () => {
  let app: ReturnType<typeof Fastify>;
  let registry: AgentRegistry;
  let workspaceService: WorkspaceService;
  let testBaseDir: string;
  let testAgents: Agent[];

  beforeEach(async () => {
    // Create temp directory for workspaces
    testBaseDir = join(tmpdir(), `workspace-routes-test-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });

    // Initialize test agents array
    testAgents = [];

    // Create registry and service
    registry = createAgentRegistry({ initialAgents: [] });
    workspaceService = createWorkspaceService({ baseDir: testBaseDir });

    // Create Fastify app
    app = Fastify();
    await app.register(
      async (api: FastifyInstance) => {
        await api.register(workspaceRoutes, {
          agentRegistry: registry,
          workspaceService,
          workspaceBaseDir: testBaseDir,
          authMiddleware: mockAuthMiddleware,
        });
      },
      { prefix: '/api' },
    );
  });

  afterEach(async () => {
    await app.close();
    try {
      await rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper to add agents to registry
  function addAgent(agent: Agent) {
    testAgents.push(agent);
    registry.replaceAll(testAgents);
  }

  function addAgents(agents: Agent[]) {
    testAgents.push(...agents);
    registry.replaceAll(testAgents);
  }

  describe('GET /workspace/:agentId/files', () => {
    it('does not require an X-Agent-Id header (identity is server-derived)', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);
      await workspaceService.ensureWorkspace('agent-1');
      await workspaceService.writeFile('agent-1', 'a.txt', 'hi');

      // No X-Agent-Id header at all — access is evaluated as the target
      // agent's own (self) workspace permissions.
      const response = await app.inject({
        method: 'GET',
        url: '/api/workspace/agent-1/files',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 403 when target agent not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/workspace/test-agent/files',
      });

      expect(response.statusCode).toBe(403);
    });

    it('should list files with valid permissions', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);

      // Create a test file
      await workspaceService.ensureWorkspace('agent-1');
      await workspaceService.writeFile('agent-1', 'test.txt', 'hello');

      const response = await app.inject({
        method: 'GET',
        url: '/api/workspace/agent-1/files',
        headers: { 'X-Agent-Id': 'agent-1' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.items).toHaveLength(1);
      expect(json.items[0].name).toBe('test.txt');
    });
  });

  describe('GET /workspace/:agentId/files/*', () => {
    it('should read file content', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);
      await workspaceService.ensureWorkspace('agent-1');
      await workspaceService.writeFile('agent-1', 'test.txt', 'file content');

      const response = await app.inject({
        method: 'GET',
        url: '/api/workspace/agent-1/files/test.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        content: 'file content',
        path: 'test.txt',
        isText: true,
        mimeType: 'text/plain',
        size: 12,
      });
    });

    it('ignores a spoofed X-Agent-Id and cannot escalate beyond the target agent permissions', async () => {
      // Target agent-1 has read/list only (fallback — no write).
      const agent1: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          workspaces: [{ path: '/project' }],
        },
      };
      // Attacker-controlled agent-2 has full write/delete permissions.
      const agent2: Agent = {
        id: 'agent-2',
        name: 'Agent 2',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: true,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgents([agent1, agent2]);
      await workspaceService.ensureWorkspace('agent-1');

      // Attempt to WRITE into agent-1's workspace while claiming, via the
      // spoofable header, to be the privileged agent-2. The header must be
      // ignored: identity is the target (agent-1), which lacks write.
      const response = await app.inject({
        method: 'POST',
        url: '/api/workspace/agent-1/files/evil.txt',
        headers: { 'X-Agent-Id': 'agent-2' },
        payload: { content: 'pwned' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /workspace/:agentId/raw/*', () => {
    const readableAgent = (id: string): Agent => ({
      id,
      name: id,
      enabled: true,
      systemPrompt: 'test',
      model: 'openai/gpt-4o-mini',
      version: 1,
      workspace: {
        enabled: true,
        workspaces: [{ path: '/project' }],
      },
    });

    it('serves raw image bytes with a media type', async () => {
      addAgent(readableAgent('agent-1'));
      await workspaceService.ensureWorkspace('agent-1');
      const wsPath = workspaceService.getWorkspacePath('agent-1');
      await mkdir(join(wsPath, 'screenshots'), { recursive: true });
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03,
      ]);
      await writeFile(join(wsPath, 'screenshots', 'shot.png'), png);

      const response = await app.inject({
        method: 'GET',
        url: '/api/workspace/agent-1/raw/screenshots/shot.png',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
      expect(response.rawPayload.equals(png)).toBe(true);
    });

    it('returns 404 for a missing file', async () => {
      addAgent(readableAgent('agent-1'));
      await workspaceService.ensureWorkspace('agent-1');

      const response = await app.inject({
        method: 'GET',
        url: '/api/workspace/agent-1/raw/missing.png',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when the agent lacks read permission', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: false,
            write: false,
            delete: false,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);
      await workspaceService.ensureWorkspace('agent-1');

      const response = await app.inject({
        method: 'GET',
        url: '/api/workspace/agent-1/raw/anything.png',
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /workspace/:agentId/files/*', () => {
    it('should create a new file', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: false,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);

      const response = await app.inject({
        method: 'POST',
        url: '/api/workspace/agent-1/files/new-file.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
        payload: { content: 'new content' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().success).toBe(true);

      // Verify file was created
      const content = await workspaceService.readFile(
        'agent-1',
        'new-file.txt',
      );
      expect(content).toBe('new content');
    });

    it('should return 400 without file path', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: { enabled: true, workspaces: [] },
      };
      addAgent(agent);

      const response = await app.inject({
        method: 'POST',
        url: '/api/workspace/agent-1/files/',
        headers: { 'X-Agent-Id': 'agent-1' },
        payload: { content: 'content' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 403 for write without permission', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);

      const response = await app.inject({
        method: 'POST',
        url: '/api/workspace/agent-1/files/unauthorized.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
        payload: { content: 'content' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PUT /workspace/:agentId/files/*', () => {
    it('should update existing file', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: false,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);
      await workspaceService.ensureWorkspace('agent-1');
      await workspaceService.writeFile('agent-1', 'existing.txt', 'original');

      const response = await app.inject({
        method: 'PUT',
        url: '/api/workspace/agent-1/files/existing.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
        payload: { content: 'updated' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('should return 404 for non-existent file', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: false,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/workspace/agent-1/files/nonexistent.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
        payload: { content: 'content' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 415 when updating a non-text file', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: false,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);
      await workspaceService.ensureWorkspace('agent-1');

      const workspacePath = workspaceService.getWorkspacePath('agent-1');
      await writeFile(
        resolve(workspacePath, 'binary.bin'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/api/workspace/agent-1/files/binary.bin',
        headers: { 'X-Agent-Id': 'agent-1' },
        payload: { content: 'attempted text overwrite' },
      });

      expect(response.statusCode).toBe(415);
      expect(response.json()).toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
    });
  });

  describe('DELETE /workspace/:agentId/files/*', () => {
    it('should delete file with permission', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: true,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);
      await workspaceService.ensureWorkspace('agent-1');
      await workspaceService.writeFile('agent-1', 'to-delete.txt', 'delete me');

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/workspace/agent-1/files/to-delete.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('should return 403 for delete without permission', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: false,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);
      await workspaceService.ensureWorkspace('agent-1');
      await workspaceService.writeFile(
        'agent-1',
        'protected.txt',
        'cannot delete',
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/workspace/agent-1/files/protected.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for non-existent file', async () => {
      const agent: Agent = {
        id: 'agent-1',
        name: 'Agent 1',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: {
            read: true,
            write: true,
            delete: true,
            list: true,
          },
          workspaces: [{ path: '/project' }],
        },
      };
      addAgent(agent);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/workspace/agent-1/files/nonexistent.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
