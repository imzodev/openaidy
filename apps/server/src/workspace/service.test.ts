import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  WorkspaceService,
  createWorkspaceService,
  WorkspaceError,
} from './service';
import type { Agent } from '../agents/schema';
import { tmpdir } from 'node:os';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let testBaseDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testBaseDir = join(tmpdir(), `workspace-test-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    service = createWorkspaceService({ baseDir: testBaseDir });
  });

  describe('readFileWithType', () => {
    it('should return text metadata for text files', async () => {
      const agentId = 'typed-read-agent';
      await service.ensureWorkspace(agentId);
      await service.writeFile(agentId, 'typed.txt', 'typed content');

      const result = await service.readFileWithType(agentId, 'typed.txt');
      expect(result.isText).toBe(true);
      expect(result.mimeType).toBe('text/plain');
      expect(result.content).toBe('typed content');
      expect(result.isTooLarge).toBe(false);
      expect(result.modifiedAt).toBeTruthy();
    });

    it('should mark oversized files as too large and skip content', async () => {
      const agentId = 'large-typed-read-agent';
      await service.ensureWorkspace(agentId);
      const largeContent = 'a'.repeat(3000);
      await service.writeFile(agentId, 'large.txt', largeContent);

      const result = await service.readFileWithType(agentId, 'large.txt', {
        maxContentBytes: 1000,
      });

      expect(result.isText).toBe(true);
      expect(result.isTooLarge).toBe(true);
      expect(result.maxEditableBytes).toBe(1000);
      expect(result.content).toBe('');
      expect(result.size).toBeGreaterThan(1000);
    });
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await rm(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getWorkspacePath', () => {
    it('should return workspace path for agent', () => {
      const path = service.getWorkspacePath('test-agent');
      expect(path).toBe(join(testBaseDir, 'test-agent'));
    });

    it('should return different paths for different agents', () => {
      const path1 = service.getWorkspacePath('agent-1');
      const path2 = service.getWorkspacePath('agent-2');
      expect(path1).not.toBe(path2);
    });
  });

  describe('ensureWorkspace', () => {
    it('should create workspace directory if it does not exist', async () => {
      await service.ensureWorkspace('new-agent');

      // Verify directory exists by trying to read it
      const files = await service.listFiles('new-agent');
      expect(files).toEqual([]);
    });

    it('should not fail if workspace already exists', async () => {
      await service.ensureWorkspace('existing-agent');
      await service.ensureWorkspace('existing-agent');
      // Should not throw
    });
  });

  describe('validatePath', () => {
    it('should allow paths within workspace', () => {
      const validPath = service.validatePath('test-agent', 'some/file.txt');
      expect(validPath).toBe(join(testBaseDir, 'test-agent', 'some/file.txt'));
    });

    it('should block path traversal attempts with ..', () => {
      expect(() => {
        service.validatePath('test-agent', '../other-agent/file.txt');
      }).toThrow(WorkspaceError);
    });

    it('should block path traversal attempts with absolute path', () => {
      expect(() => {
        service.validatePath('test-agent', '/etc/passwd');
      }).toThrow(WorkspaceError);
    });

    it('should block path traversal with multiple ..', () => {
      expect(() => {
        service.validatePath('test-agent', '../../.. /etc/passwd');
      }).toThrow(WorkspaceError);
    });

    it('should block path traversal with mixed separators', () => {
      expect(() => {
        service.validatePath('test-agent', '..\\..\\..\\etc\\passwd');
      }).toThrow(WorkspaceError);
    });

    it('should block access through a symlink that escapes the workspace', async () => {
      const agentId = 'symlink-agent';
      await service.ensureWorkspace(agentId);
      const workspacePath = service.getWorkspacePath(agentId);

      // A directory outside the workspace the attacker wants to reach.
      const outside = join(testBaseDir, 'outside-secret');
      await mkdir(outside, { recursive: true });
      await fsWriteFile(join(outside, 'secret.txt'), 'top secret');

      // Create a symlink INSIDE the workspace pointing at it (as exec_run
      // could). Skip if the platform/account can't create symlinks.
      const { symlink } = await import('node:fs/promises');
      try {
        await symlink(outside, join(workspacePath, 'escape'), 'dir');
      } catch {
        return; // e.g. Windows without symlink privilege — nothing to assert
      }

      // The lexical path "escape/secret.txt" looks contained, but the real
      // path resolves outside the workspace and must be rejected.
      expect(() => {
        service.validatePath(agentId, 'escape/secret.txt');
      }).toThrow(WorkspaceError);
    });
  });

  describe('listFiles', () => {
    it('should return empty array for non-existent directory', async () => {
      const files = await service.listFiles('non-existent-agent');
      expect(files).toEqual([]);
    });

    it('should list files in workspace', async () => {
      const agentId = 'list-test-agent';
      await service.ensureWorkspace(agentId);
      const workspacePath = service.getWorkspacePath(agentId);

      // Create some test files
      await mkdir(join(workspacePath, 'subdir'), { recursive: true });
      await fsWriteFile(join(workspacePath, 'file1.txt'), 'content1');
      await fsWriteFile(join(workspacePath, 'file2.txt'), 'content2');

      const files = await service.listFiles(agentId);
      expect(files).toHaveLength(3);
      expect(files.map((f) => f.name).sort()).toEqual([
        'file1.txt',
        'file2.txt',
        'subdir',
      ]);
    });

    it('should include file metadata', async () => {
      const agentId = 'metadata-test-agent';
      await service.ensureWorkspace(agentId);
      const workspacePath = service.getWorkspacePath(agentId);

      await fsWriteFile(join(workspacePath, 'test.txt'), 'test content');
      const files = await service.listFiles(agentId);

      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe('test.txt');
      expect(files[0]!.isDirectory).toBe(false);
      expect(files[0]!.size).toBe(12); // 'test content'.length
      expect(files[0]!.modifiedAt).toBeInstanceOf(Date);
    });

    it('should list files in subdirectory', async () => {
      const agentId = 'subdir-test-agent';
      await service.ensureWorkspace(agentId);
      const workspacePath = service.getWorkspacePath(agentId);

      await mkdir(join(workspacePath, 'subdir'), { recursive: true });
      await fsWriteFile(join(workspacePath, 'subdir', 'nested.txt'), 'nested');

      const files = await service.listFiles(agentId, 'subdir');
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe('nested.txt');
      // `path` uses OS-native separators (relative()), so compare with join().
      expect(files[0]!.path).toBe(join('subdir', 'nested.txt'));
    });
  });

  describe('readFile', () => {
    it('should read file content', async () => {
      const agentId = 'read-test-agent';
      await service.ensureWorkspace(agentId);
      const workspacePath = service.getWorkspacePath(agentId);

      await fsWriteFile(join(workspacePath, 'test.txt'), 'test content');
      const content = await service.readFile(agentId, 'test.txt');
      expect(content).toBe('test content');
    });

    it('should throw error for non-existent file', async () => {
      const agentId = 'read-nonexistent-agent';
      await service.ensureWorkspace(agentId);

      await expect(
        service.readFile(agentId, 'nonexistent.txt'),
      ).rejects.toThrow(WorkspaceError);
    });

    it('should block path traversal in read', async () => {
      const agentId = 'read-traversal-agent';
      await service.ensureWorkspace(agentId);

      await expect(
        service.readFile(agentId, '../../../etc/passwd'),
      ).rejects.toThrow(WorkspaceError);
    });
  });

  describe('writeFile', () => {
    it('should write file content', async () => {
      const agentId = 'write-test-agent';
      await service.ensureWorkspace(agentId);

      await service.writeFile(agentId, 'new-file.txt', 'new content');

      const content = await service.readFile(agentId, 'new-file.txt');
      expect(content).toBe('new content');
    });

    it('should create nested directories', async () => {
      const agentId = 'write-nested-agent';
      await service.ensureWorkspace(agentId);

      await service.writeFile(
        agentId,
        'deeply/nested/file.txt',
        'nested content',
      );

      const content = await service.readFile(agentId, 'deeply/nested/file.txt');
      expect(content).toBe('nested content');
    });

    it('should overwrite existing file', async () => {
      const agentId = 'write-overwrite-agent';
      await service.ensureWorkspace(agentId);

      await service.writeFile(agentId, 'file.txt', 'original');
      await service.writeFile(agentId, 'file.txt', 'updated');

      const content = await service.readFile(agentId, 'file.txt');
      expect(content).toBe('updated');
    });

    it('should block path traversal in write', async () => {
      const agentId = 'write-traversal-agent';
      await service.ensureWorkspace(agentId);

      await expect(
        service.writeFile(agentId, '../../../tmp/malicious.txt', 'bad'),
      ).rejects.toThrow(WorkspaceError);
    });
  });

  describe('deleteFile', () => {
    it('should delete existing file', async () => {
      const agentId = 'delete-test-agent';
      await service.ensureWorkspace(agentId);
      const workspacePath = service.getWorkspacePath(agentId);

      await fsWriteFile(join(workspacePath, 'to-delete.txt'), 'delete me');
      await service.deleteFile(agentId, 'to-delete.txt');

      const files = await service.listFiles(agentId);
      expect(files).toHaveLength(0);
    });

    it('should throw error for non-existent file', async () => {
      const agentId = 'delete-nonexistent-agent';
      await service.ensureWorkspace(agentId);

      await expect(
        service.deleteFile(agentId, 'nonexistent.txt'),
      ).rejects.toThrow(WorkspaceError);
    });

    it('should block path traversal in delete', async () => {
      const agentId = 'delete-traversal-agent';
      await service.ensureWorkspace(agentId);

      await expect(
        service.deleteFile(agentId, '../../../tmp/important.txt'),
      ).rejects.toThrow(WorkspaceError);
    });
  });

  describe('renameFile', () => {
    it('should rename an existing file', async () => {
      const agentId = 'rename-test-agent';
      await service.ensureWorkspace(agentId);
      await service.writeFile(agentId, 'old.txt', 'content');

      await service.renameFile(agentId, 'old.txt', 'new.txt');

      await expect(service.readFile(agentId, 'old.txt')).rejects.toThrow(
        WorkspaceError,
      );
      await expect(service.readFile(agentId, 'new.txt')).resolves.toBe(
        'content',
      );
    });

    it('should reject rename when destination exists', async () => {
      const agentId = 'rename-conflict-agent';
      await service.ensureWorkspace(agentId);
      await service.writeFile(agentId, 'first.txt', 'first');
      await service.writeFile(agentId, 'second.txt', 'second');

      await expect(
        service.renameFile(agentId, 'first.txt', 'second.txt'),
      ).rejects.toMatchObject({ code: 'FILE_ALREADY_EXISTS' });
    });
  });

  describe('hasWorkspaceAccess', () => {
    it('should return true for agent with workspace enabled', () => {
      const agent = {
        id: 'workspace-agent',
        name: 'Workspace Agent',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        workspace: {
          enabled: true,
          workspaces: [{ path: '/project' }],
        },
      } as Agent;

      expect(service.hasWorkspaceAccess(agent)).toBe(true);
    });

    it('should return false for agent without workspace config', () => {
      const agent = {
        id: 'no-workspace-agent',
        name: 'No Workspace Agent',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
      } as unknown as Agent;

      expect(service.hasWorkspaceAccess(agent)).toBe(false);
    });

    it('should return false for agent with disabled workspace', () => {
      const agent = {
        id: 'disabled-workspace-agent',
        name: 'Disabled Workspace Agent',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        workspace: {
          enabled: false,
          workspaces: [{ path: '/project' }],
        },
      } as unknown as Agent;

      expect(service.hasWorkspaceAccess(agent)).toBe(false);
    });

    it('should return false for agent with empty workspaces array', () => {
      const agent = {
        id: 'empty-workspace-agent',
        name: 'Empty Workspace Agent',
        enabled: true,
        systemPrompt: 'test',
        model: 'openai/gpt-4o-mini',
        workspace: {
          enabled: true,
          workspaces: [],
        },
      } as unknown as Agent;

      expect(service.hasWorkspaceAccess(agent)).toBe(false);
    });
  });

  describe('WorkspaceError', () => {
    it('should have correct error properties', () => {
      const cause = new Error('original error');
      const error = new WorkspaceError('test message', 'TEST_CODE', cause);

      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.cause).toBe(cause);
      expect(error.name).toBe('WorkspaceError');
    });
  });
});
