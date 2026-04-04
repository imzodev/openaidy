import { mkdir, readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { createLogger } from '../lib/logger';
import type { Agent } from '../agents/schema';

const log = createLogger('workspace');

/**
 * File information returned by listFiles
 */
export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}

/**
 * Workspace error types
 */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/**
 * Options for WorkspaceService
 */
export interface WorkspaceServiceOptions {
  /** Base directory for all workspaces */
  baseDir: string;
}

/**
 * WorkspaceService handles file operations within agent workspaces.
 * Provides secure file access with path traversal prevention.
 */
export class WorkspaceService {
  private readonly baseDir: string;

  constructor(options: WorkspaceServiceOptions) {
    this.baseDir = resolve(options.baseDir);
    log.info('WorkspaceService initialized with baseDir:', this.baseDir);
  }

  /**
   * Get the workspace directory path for an agent
   */
  getWorkspacePath(agentId: string): string {
    return join(this.baseDir, agentId);
  }

  /**
   * Ensure the workspace directory exists for an agent
   */
  async ensureWorkspace(agentId: string): Promise<void> {
    const workspacePath = this.getWorkspacePath(agentId);
    try {
      await mkdir(workspacePath, { recursive: true });
      log.debug('Workspace ensured:', workspacePath);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to create workspace:', workspacePath, err);
      throw new WorkspaceError(
        `Failed to create workspace for agent ${agentId}`,
        'WORKSPACE_CREATE_FAILED',
        err,
      );
    }
  }

  /**
   * Validate that a requested path is within the agent's workspace.
   * Returns the validated absolute path or throws an error.
   */
  validatePath(agentId: string, requestedPath: string): string {
    const workspacePath = this.getWorkspacePath(agentId);
    const absolutePath = resolve(workspacePath, requestedPath);

    // Check if the resolved path is within the workspace
    const relativePath = relative(workspacePath, absolutePath);
    if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
      log.warn('Path traversal attempt blocked:', {
        agentId,
        requestedPath,
        workspacePath,
        resolvedPath: absolutePath,
      });
      throw new WorkspaceError(
        'Path traversal attempt blocked: path escapes workspace',
        'PATH_TRAVERSAL_BLOCKED',
      );
    }

    return absolutePath;
  }

  /**
   * List files in a workspace directory
   */
  async listFiles(agentId: string, path?: string): Promise<FileInfo[]> {
    const dirPath = this.validatePath(agentId, path ?? '.');
    log.debug('Listing files:', { agentId, path: path ?? '.', dirPath });

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const fileInfos: FileInfo[] = [];

      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);
        let stats;
        try {
          stats = await stat(entryPath);
        } catch {
          // Skip files that can't be stat'd
          continue;
        }

        fileInfos.push({
          name: entry.name,
          path: relative(this.getWorkspacePath(agentId), entryPath),
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime,
        });
      }

      return fileInfos;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // Directory doesn't exist, return empty list
      }
      log.error('Failed to list files:', { agentId, path }, err);
      throw new WorkspaceError(
        `Failed to list files in workspace`,
        'LIST_FILES_FAILED',
        err,
      );
    }
  }

  /**
   * Read a file from the workspace
   */
  async readFile(agentId: string, filePath: string): Promise<string> {
    const absolutePath = this.validatePath(agentId, filePath);
    log.debug('Reading file:', { agentId, filePath, absolutePath });

    try {
      const content = await readFile(absolutePath, 'utf-8');
      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new WorkspaceError(
          `File not found: ${filePath}`,
          'FILE_NOT_FOUND',
          err,
        );
      }
      log.error('Failed to read file:', { agentId, filePath }, err);
      throw new WorkspaceError(
        `Failed to read file: ${filePath}`,
        'READ_FILE_FAILED',
        err,
      );
    }
  }

  /**
   * Write a file to the workspace
   */
  async writeFile(
    agentId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const absolutePath = this.validatePath(agentId, filePath);
    log.debug('Writing file:', { agentId, filePath, absolutePath });

    try {
      // Ensure parent directory exists
      const parentDir = dirname(absolutePath);
      await mkdir(parentDir, { recursive: true });

      await writeFile(absolutePath, content, 'utf-8');
      log.info('File written:', { agentId, filePath });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('Failed to write file:', { agentId, filePath }, err);
      throw new WorkspaceError(
        `Failed to write file: ${filePath}`,
        'WRITE_FILE_FAILED',
        err,
      );
    }
  }

  /**
   * Delete a file from the workspace
   */
  async deleteFile(agentId: string, filePath: string): Promise<void> {
    const absolutePath = this.validatePath(agentId, filePath);
    log.debug('Deleting file:', { agentId, filePath, absolutePath });

    try {
      await unlink(absolutePath);
      log.info('File deleted:', { agentId, filePath });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new WorkspaceError(
          `File not found: ${filePath}`,
          'FILE_NOT_FOUND',
          err,
        );
      }
      log.error('Failed to delete file:', { agentId, filePath }, err);
      throw new WorkspaceError(
        `Failed to delete file: ${filePath}`,
        'DELETE_FILE_FAILED',
        err,
      );
    }
  }

  /**
   * Check if an agent has workspace access configured
   */
  hasWorkspaceAccess(agent: Agent): boolean {
    return !!(agent.workspace?.enabled && agent.workspace.workspaces.length > 0);
  }
}

/**
 * Create a WorkspaceService instance
 */
export function createWorkspaceService(
  options: WorkspaceServiceOptions,
): WorkspaceService {
  return new WorkspaceService(options);
}
