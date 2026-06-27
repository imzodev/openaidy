import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  unlink,
  stat,
  rename,
  open,
} from 'node:fs/promises';
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

export interface FileReadResult {
  content: string;
  isText: boolean;
  mimeType: string;
  size: number;
  modifiedAt: string;
  isTooLarge: boolean;
  maxEditableBytes?: number;
}

export interface ReadFileWithTypeOptions {
  maxContentBytes?: number;
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

  private static readonly BINARY_SIGNATURES: Array<{
    mimeType: string;
    signature: number[];
  }> = [
    { mimeType: 'application/pdf', signature: [0x25, 0x50, 0x44, 0x46] },
    { mimeType: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47] },
    { mimeType: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
    { mimeType: 'image/gif', signature: [0x47, 0x49, 0x46, 0x38] },
    { mimeType: 'image/webp', signature: [0x52, 0x49, 0x46, 0x46] },
    { mimeType: 'application/zip', signature: [0x50, 0x4b, 0x03, 0x04] },
    { mimeType: 'application/gzip', signature: [0x1f, 0x8b] },
    {
      mimeType: 'application/x-7z-compressed',
      signature: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    },
  ];

  constructor(options: WorkspaceServiceOptions) {
    this.baseDir = resolve(options.baseDir);
    log.info('WorkspaceService initialized with baseDir:', this.baseDir);
  }

  private detectMimeTypeFromContent(buffer: Buffer): string {
    for (const item of WorkspaceService.BINARY_SIGNATURES) {
      const matches = item.signature.every(
        (byte, index) => buffer[index] === byte,
      );
      if (matches) {
        return item.mimeType;
      }
    }

    return 'application/octet-stream';
  }

  private isLikelyTextContent(buffer: Buffer): boolean {
    if (buffer.length === 0) {
      return true;
    }

    const sampleSize = Math.min(buffer.length, 8192);
    const sample = buffer.subarray(0, sampleSize);

    for (const byte of sample) {
      if (byte === 0) {
        return false;
      }
    }

    let suspiciousControlBytes = 0;
    for (const byte of sample) {
      const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
      if (isControl) {
        suspiciousControlBytes += 1;
      }
    }

    if (suspiciousControlBytes / sample.length > 0.05) {
      return false;
    }

    const decoded = sample.toString('utf-8');
    const replacementCount = (decoded.match(/\uFFFD/g) ?? []).length;
    if (replacementCount > 0 && replacementCount / decoded.length > 0.02) {
      return false;
    }

    return true;
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

  async readFileWithType(
    agentId: string,
    filePath: string,
    options: ReadFileWithTypeOptions = {},
  ): Promise<FileReadResult> {
    const absolutePath = this.validatePath(agentId, filePath);
    log.debug('Reading file with type detection:', {
      agentId,
      filePath,
      absolutePath,
    });

    try {
      const stats = await stat(absolutePath);
      if (stats.isDirectory()) {
        throw new WorkspaceError(
          `Path is a directory: ${filePath}`,
          'NOT_A_FILE',
        );
      }

      const maxContentBytes = options.maxContentBytes;
      if (maxContentBytes && stats.size > maxContentBytes) {
        const sampleLength = Math.min(stats.size, 8192);
        const fileHandle = await open(absolutePath, 'r');
        try {
          const sample = Buffer.alloc(sampleLength);
          await fileHandle.read(sample, 0, sampleLength, 0);
          const isText = this.isLikelyTextContent(sample);
          const mimeType = isText
            ? 'text/plain'
            : this.detectMimeTypeFromContent(sample);

          return {
            content: '',
            isText,
            mimeType,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            isTooLarge: true,
            maxEditableBytes: maxContentBytes,
          };
        } finally {
          await fileHandle.close();
        }
      }

      const buffer = await readFile(absolutePath);
      const isText = this.isLikelyTextContent(buffer);
      const mimeType = isText
        ? 'text/plain'
        : this.detectMimeTypeFromContent(buffer);

      return {
        content: isText ? buffer.toString('utf-8') : '',
        isText,
        mimeType,
        size: buffer.length,
        modifiedAt: stats.mtime.toISOString(),
        isTooLarge: false,
      };
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
   * Options for walkFiles. Default `excludeDirs` matches the
   * typical noise in a JS/TS workspace: dependencies, build
   * output, and VCS metadata.
   */
  async walkFiles(
    agentId: string,
    path: string = '.',
    options: { excludeDirs?: string[]; maxFiles?: number } = {},
  ): Promise<string[]> {
    const rootPath = this.validatePath(agentId, path);
    const workspaceRoot = this.getWorkspacePath(agentId);
    const excludeDirs = new Set(
      options.excludeDirs ?? ['node_modules', '.git', 'dist', 'build', '.next'],
    );
    const maxFiles = options.maxFiles ?? 10_000;

    const results: string[] = [];
    const stack: string[] = [rootPath];

    while (stack.length > 0) {
      if (results.length >= maxFiles) break;
      const current = stack.pop()!;
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        // Directory gone, permission denied, etc. — skip silently.
        continue;
      }
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        if (entry.isDirectory()) {
          if (excludeDirs.has(entry.name)) continue;
          stack.push(join(current, entry.name));
        } else if (entry.isFile()) {
          results.push(relative(workspaceRoot, join(current, entry.name)));
        }
      }
    }

    return results;
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
   * Returns the absolute path of the written file
   */
  async writeFile(
    agentId: string,
    filePath: string,
    content: string,
  ): Promise<string> {
    const absolutePath = this.validatePath(agentId, filePath);
    log.debug('Writing file:', { agentId, filePath, absolutePath });

    try {
      // Ensure parent directory exists
      const parentDir = dirname(absolutePath);
      await mkdir(parentDir, { recursive: true });

      await writeFile(absolutePath, content, 'utf-8');
      log.info('File written:', { agentId, filePath });
      return absolutePath;
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

  async renameFile(
    agentId: string,
    sourcePath: string,
    destinationPath: string,
  ): Promise<void> {
    const sourceAbsolutePath = this.validatePath(agentId, sourcePath);
    const destinationAbsolutePath = this.validatePath(agentId, destinationPath);

    log.debug('Renaming file:', {
      agentId,
      sourcePath,
      destinationPath,
      sourceAbsolutePath,
      destinationAbsolutePath,
    });

    try {
      await stat(sourceAbsolutePath);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new WorkspaceError(
          `File not found: ${sourcePath}`,
          'FILE_NOT_FOUND',
          err,
        );
      }
      throw err;
    }

    try {
      await stat(destinationAbsolutePath);
      throw new WorkspaceError(
        `File already exists: ${destinationPath}`,
        'FILE_ALREADY_EXISTS',
      );
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        if (error instanceof WorkspaceError) {
          throw error;
        }
        throw new WorkspaceError(
          `Failed to validate destination path: ${destinationPath}`,
          'RENAME_FILE_FAILED',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    try {
      await mkdir(dirname(destinationAbsolutePath), { recursive: true });
      await rename(sourceAbsolutePath, destinationAbsolutePath);
      log.info('File renamed:', { agentId, sourcePath, destinationPath });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error(
        'Failed to rename file:',
        { agentId, sourcePath, destinationPath },
        err,
      );
      throw new WorkspaceError(
        `Failed to rename file: ${sourcePath}`,
        'RENAME_FILE_FAILED',
        err,
      );
    }
  }

  /**
   * Check if an agent has workspace access configured
   */
  hasWorkspaceAccess(agent: Agent): boolean {
    return !!(
      agent.workspace?.enabled && agent.workspace.workspaces.length > 0
    );
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
