import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceService } from '../../workspace/service';
import {
  createWorkspaceReadTool,
  createWorkspaceWriteTool,
  createWorkspaceListTool,
  createWorkspaceDeleteTool,
  createWorkspaceTools,
} from './index';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

describe('workspace tools', () => {
  let testBaseDir: string;
  let workspace: ReturnType<typeof createWorkspaceService>;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `tools-test-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    workspace = createWorkspaceService({ baseDir: testBaseDir });
    await workspace.ensureWorkspace(CTX.agentId);
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  // ─── createWorkspaceTools factory ──────────────────────────────────────────

  describe('createWorkspaceTools', () => {
    it('returns all four workspace tools', () => {
      const tools = createWorkspaceTools(workspace);
      const names = tools.map((t) => t.name);
      expect(names).toContain('workspace_read');
      expect(names).toContain('workspace_write');
      expect(names).toContain('workspace_list');
      expect(names).toContain('workspace_delete');
      expect(names).toHaveLength(4);
    });
  });

  // ─── workspace_write ───────────────────────────────────────────────────────

  describe('workspace_write', () => {
    it('writes a file and returns success', async () => {
      const tool = createWorkspaceWriteTool(workspace);
      const result = await tool.execute(
        { path: 'hello.txt', content: 'world' },
        CTX,
      );
      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        'hello.txt',
      );
    });

    it('creates nested directories automatically', async () => {
      const tool = createWorkspaceWriteTool(workspace);
      const result = await tool.execute(
        { path: 'sub/dir/file.txt', content: 'nested' },
        CTX,
      );
      expect(result.ok).toBe(true);
    });

    it('returns error when path is missing', async () => {
      const tool = createWorkspaceWriteTool(workspace);
      const result = await tool.execute({ content: 'hi' }, CTX);
      expect(result.ok).toBe(false);
    });

    it('returns error when content is missing', async () => {
      const tool = createWorkspaceWriteTool(workspace);
      const result = await tool.execute({ path: 'file.txt' }, CTX);
      expect(result.ok).toBe(false);
    });
  });

  // ─── workspace_read ────────────────────────────────────────────────────────

  describe('workspace_read', () => {
    it('reads an existing file', async () => {
      await workspace.writeFile(CTX.agentId, 'read-me.txt', 'file content');
      const tool = createWorkspaceReadTool(workspace);
      const result = await tool.execute({ path: 'read-me.txt' }, CTX);
      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toBe(
        'file content',
      );
    });

    it('returns error for a non-existent file', async () => {
      const tool = createWorkspaceReadTool(workspace);
      const result = await tool.execute({ path: 'ghost.txt' }, CTX);
      expect(result.ok).toBe(false);
    });

    it('returns error when path is missing', async () => {
      const tool = createWorkspaceReadTool(workspace);
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
    });

    it('returns error on path traversal attempt', async () => {
      const tool = createWorkspaceReadTool(workspace);
      const result = await tool.execute({ path: '../../etc/passwd' }, CTX);
      expect(result.ok).toBe(false);
    });
  });

  // ─── workspace_list ────────────────────────────────────────────────────────

  describe('workspace_list', () => {
    it('lists files in the workspace root', async () => {
      await workspace.writeFile(CTX.agentId, 'a.txt', 'a');
      await workspace.writeFile(CTX.agentId, 'b.txt', 'b');
      const tool = createWorkspaceListTool(workspace);
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(true);
      const entries = JSON.parse(
        (result as { ok: true; content: string }).content,
      ) as Array<{ name: string }>;
      const names = entries.map((e) => e.name);
      expect(names).toContain('a.txt');
      expect(names).toContain('b.txt');
    });

    it('lists files in a subdirectory', async () => {
      await workspace.writeFile(CTX.agentId, 'sub/nested.txt', 'nested');
      const tool = createWorkspaceListTool(workspace);
      const result = await tool.execute({ path: 'sub' }, CTX);
      expect(result.ok).toBe(true);
      const entries = JSON.parse(
        (result as { ok: true; content: string }).content,
      ) as Array<{ name: string }>;
      expect(entries.map((e) => e.name)).toContain('nested.txt');
    });

    it('returns empty array for an empty workspace', async () => {
      const tool = createWorkspaceListTool(workspace);
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(true);
      const entries = JSON.parse(
        (result as { ok: true; content: string }).content,
      );
      expect(entries).toEqual([]);
    });

    it('returns entries with expected shape', async () => {
      await workspace.writeFile(CTX.agentId, 'shape.txt', 'data');
      const tool = createWorkspaceListTool(workspace);
      const result = await tool.execute({}, CTX);
      const entries = JSON.parse(
        (result as { ok: true; content: string }).content,
      ) as Array<{
        name: string;
        path: string;
        isDirectory: boolean;
        size: number;
      }>;
      const file = entries.find((e) => e.name === 'shape.txt');
      expect(file).toBeDefined();
      expect(typeof file!.path).toBe('string');
      expect(typeof file!.isDirectory).toBe('boolean');
      expect(typeof file!.size).toBe('number');
    });
  });

  // ─── workspace_delete ──────────────────────────────────────────────────────

  describe('workspace_delete', () => {
    it('deletes an existing file', async () => {
      await workspace.writeFile(CTX.agentId, 'to-delete.txt', 'bye');
      const tool = createWorkspaceDeleteTool(workspace);
      const result = await tool.execute({ path: 'to-delete.txt' }, CTX);
      expect(result.ok).toBe(true);

      // Confirm it's gone
      const readResult = await createWorkspaceReadTool(workspace).execute(
        { path: 'to-delete.txt' },
        CTX,
      );
      expect(readResult.ok).toBe(false);
    });

    it('returns error for a non-existent file', async () => {
      const tool = createWorkspaceDeleteTool(workspace);
      const result = await tool.execute({ path: 'ghost.txt' }, CTX);
      expect(result.ok).toBe(false);
    });

    it('returns error when path is missing', async () => {
      const tool = createWorkspaceDeleteTool(workspace);
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
    });
  });
});
