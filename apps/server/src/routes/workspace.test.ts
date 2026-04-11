import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { workspaceRoutes } from './workspace';
import { createAgentRegistry, type AgentRegistry } from '../agents/registry';
import { createWorkspaceService, WorkspaceService } from '../workspace/service';
import type { Agent } from '../agents/schema';

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
    await app.register(workspaceRoutes, {
      agentRegistry: registry,
      workspaceService,
      workspaceBaseDir: testBaseDir,
    });
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
    it('should return 401 without X-Agent-Id header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/workspace/test-agent/files',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: 'Missing X-Agent-Id header',
        code: 'UNAUTHORIZED',
      });
    });

    it('should return 403 when source agent not found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/workspace/test-agent/files',
        headers: { 'X-Agent-Id': 'unknown-agent' },
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
        url: '/workspace/agent-1/files',
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
        url: '/workspace/agent-1/files/test.txt',
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

    it('should return 403 for unauthorized access', async () => {
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
      const agent2: Agent = {
        id: 'agent-2',
        name: 'Agent 2',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          workspaces: [{ path: '/project' }],
        },
      };
      addAgents([agent1, agent2]);
      await workspaceService.ensureWorkspace('agent-1');
      await workspaceService.writeFile('agent-1', 'secret.txt', 'secret');

      const response = await app.inject({
        method: 'GET',
        url: '/workspace/agent-1/files/secret.txt',
        headers: { 'X-Agent-Id': 'agent-2' },
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
        url: '/workspace/agent-1/files/new-file.txt',
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
        url: '/workspace/agent-1/files/',
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
        url: '/workspace/agent-1/files/unauthorized.txt',
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
        url: '/workspace/agent-1/files/existing.txt',
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
        url: '/workspace/agent-1/files/nonexistent.txt',
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
        url: '/workspace/agent-1/files/binary.bin',
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
        url: '/workspace/agent-1/files/to-delete.txt',
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
        url: '/workspace/agent-1/files/protected.txt',
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
        url: '/workspace/agent-1/files/nonexistent.txt',
        headers: { 'X-Agent-Id': 'agent-1' },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
