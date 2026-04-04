import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { workspaceRoutes } from './workspace';
import { createWorkspaceService } from '../workspace/service';
import { createAgentRegistry } from '../agents';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';

describe('workspace routes', () => {
  let app: FastifyInstance;
  let testBaseDir: string;
  let workspaceService: ReturnType<typeof createWorkspaceService>;
  let agentRegistry: ReturnType<typeof createAgentRegistry>;

  beforeEach(async () => {
    // Create unique temp directory
    testBaseDir = join(tmpdir(), `workspace-routes-test-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });

    // Create services
    workspaceService = createWorkspaceService({ baseDir: testBaseDir });
    agentRegistry = createAgentRegistry({ initialAgents: [] });

        // Register test agents using replaceAll
    agentRegistry.replaceAll([
      {
        id: 'test-agent',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'Test agent',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          defaultPermissions: { read: true, write: true, delete: true, list: true },
          workspaces: [{ path: '/project' }],
        },
      },
      {
        id: 'other-agent',
        name: 'Other Agent',
        enabled: true,
        systemPrompt: 'Other agent',
        model: 'openai/gpt-4o-mini',
        version: 1,
        workspace: {
          enabled: true,
          // No defaultPermissions, so defaults to read-only
          workspaces: [{ path: '/project2' }],
        },
      },
    ]);

    // Build Fastify app with workspace routes
    app = Fastify();
    await app.register(workspaceRoutes, {
      agentRegistry,
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

    it('should return empty list for new workspace', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/workspace/test-agent/files',
        headers: { 'x-agent-id': 'test-agent' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [] });
    });

    it('should list files in workspace', async () => {
      // Create test file
      await workspaceService.ensureWorkspace('test-agent');
      await workspaceService.writeFile('test-agent', 'test.txt', 'content');

      const response = await app.inject({
        method: 'GET',
        url: '/workspace/test-agent/files',
        headers: { 'x-agent-id': 'test-agent' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { items: Array<{ name: string }> };
      expect(json.items).toHaveLength(1);
      expect(json.items[0].name).toBe('test.txt');
    });
  });

  describe('POST /workspace/:agentId/files/*', () => {
    it('should create a new file', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspace/test-agent/files/hello.txt',
        headers: {
          'x-agent-id': 'test-agent',
          'content-type': 'application/json',
        },
        payload: { content: 'Hello World' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        success: true,
        path: 'hello.txt',
      });
    });

    it('should return 403 for agent without write permission', async () => {
      // other-agent has no write permissions (defaults to read-only)
      const response = await app.inject({
        method: 'POST',
        url: '/workspace/test-agent/files/hello.txt',
        headers: {
          'x-agent-id': 'other-agent',
          'content-type': 'application/json',
        },
        payload: { content: 'Hello World' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /workspace/:agentId/files/*', () => {
    it('should read file content', async () => {
      // Create test file
      await workspaceService.writeFile('test-agent', 'readme.txt', 'Read me');

      const response = await app.inject({
        method: 'GET',
        url: '/workspace/test-agent/files/readme.txt',
        headers: { 'x-agent-id': 'test-agent' },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { content: string };
      expect(json.content).toBe('Read me');
    });

    it('should return empty items for non-existent path (treated as empty directory)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/workspace/test-agent/files/nonexistent.txt',
        headers: { 'x-agent-id': 'test-agent' },
      });

      // Non-existent paths are treated as empty directories
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [], path: 'nonexistent.txt' });
    });
  });

  describe('PUT /workspace/:agentId/files/*', () => {
    it('should update existing file', async () => {
      // Create test file
      await workspaceService.writeFile('test-agent', 'update.txt', 'Original');

      const response = await app.inject({
        method: 'PUT',
        url: '/workspace/test-agent/files/update.txt',
        headers: {
          'x-agent-id': 'test-agent',
          'content-type': 'application/json',
        },
        payload: { content: 'Updated' },
      });

      expect(response.statusCode).toBe(200);

      // Verify content was updated
      const content = await workspaceService.readFile('test-agent', 'update.txt');
      expect(content).toBe('Updated');
    });

    it('should return 404 for non-existent file', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/workspace/test-agent/files/nonexistent.txt',
        headers: {
          'x-agent-id': 'test-agent',
          'content-type': 'application/json',
        },
        payload: { content: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /workspace/:agentId/files/*', () => {
    it('should delete file', async () => {
      // Create test file
      await workspaceService.writeFile('test-agent', 'delete.txt', 'Delete me');

      const response = await app.inject({
        method: 'DELETE',
        url: '/workspace/test-agent/files/delete.txt',
        headers: { 'x-agent-id': 'test-agent' },
      });

      expect(response.statusCode).toBe(200);

      // Verify file was deleted
      await expect(
        workspaceService.readFile('test-agent', 'delete.txt'),
      ).rejects.toThrow();
    });

    it('should return 404 for non-existent file', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/workspace/test-agent/files/nonexistent.txt',
        headers: { 'x-agent-id': 'test-agent' },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
