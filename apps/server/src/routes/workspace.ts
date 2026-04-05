import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { WorkspaceService, type FileInfo } from '../workspace/service';
import {
  validateWorkspaceAccess,
  type PermissionMode,
} from '../workspace/permissions';
import type { AgentRegistry } from '../agents/registry';

/**
 * Workspace routes options
 */
export type WorkspaceRoutesOptions = {
  agentRegistry: AgentRegistry;
  workspaceService: WorkspaceService;
  /** Base directory for agent workspaces */
  workspaceBaseDir: string;
};

/**
 * Request body for file write operations
 */
export interface FileWriteBody {
  content: string;
  expectedModifiedAt?: string;
}

export interface FileRenameBody {
  sourcePath: string;
  destinationPath: string;
}

/**
 * File metadata response
 */
export interface FileMetadataResponse {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface FileContentResponse {
  content: string;
  path: string;
  isText: boolean;
  mimeType: string;
  size: number;
  modifiedAt: string;
  isTooLarge: boolean;
  maxEditableBytes?: number;
}

/**
 * Error response
 */
export interface WorkspaceErrorResponse {
  error: string;
  code: string;
}

/**
 * Workspace routes plugin
 */
export const workspaceRoutes: FastifyPluginAsync<
  WorkspaceRoutesOptions
> = async (app, options) => {
  const { agentRegistry, workspaceService } = options;
  const MAX_EDITABLE_FILE_BYTES = 1_000_000;

  /**
   * Get requesting agent ID from header
   */
  const getRequestingAgent = (
    headers: Record<string, string | undefined>,
  ): string | null => {
    const agentId = headers['x-agent-id'];
    if (typeof agentId !== 'string' || !agentId) {
      return null;
    }
    return agentId;
  };

  /**
   * Validate access and return error response if denied
   */
  const validateAccess = (
    requestingAgentId: string,
    targetAgentId: string,
    mode: PermissionMode,
  ): { allowed: boolean; error?: WorkspaceErrorResponse } => {
    const result = validateWorkspaceAccess(
      requestingAgentId,
      targetAgentId,
      mode,
      agentRegistry,
    );
    if (!result.allowed) {
      return {
        allowed: false,
        error: { error: result.reason, code: 'ACCESS_DENIED' },
      };
    }
    return { allowed: true };
  };

  /**
   * GET /workspace/:agentId/files
   * List files in workspace root
   */
  app.get(
    '/workspace/:agentId/files',
    async (request: FastifyRequest<{ Params: { agentId: string } }>, reply) => {
      const requestingAgentId = getRequestingAgent(
        request.headers as Record<string, string | undefined>,
      );
      if (!requestingAgentId) {
        reply.code(401);
        return { error: 'Missing X-Agent-Id header', code: 'UNAUTHORIZED' };
      }

      const { agentId: targetAgentId } = request.params;

      // Validate list permission
      const access = validateAccess(requestingAgentId, targetAgentId, 'list');
      if (!access.allowed) {
        reply.code(403);
        return access.error;
      }

      try {
        const files = await workspaceService.listFiles(targetAgentId);
        const response: FileMetadataResponse[] = files.map((f: FileInfo) => ({
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory,
          size: f.size,
          modifiedAt: f.modifiedAt.toISOString(),
        }));
        return { items: response };
      } catch (error) {
        app.log.error(
          'Failed to list files: %s',
          error instanceof Error ? error.message : String(error),
        );
        reply.code(500);
        return { error: 'Failed to list files', code: 'INTERNAL_ERROR' };
      }
    },
  );

  /**
   * GET /workspace/:agentId/files/*
   * List files in subdirectory or read file content
   */
  app.get(
    '/workspace/:agentId/files/*',
    async (
      request: FastifyRequest<{ Params: { agentId: string; '*': string } }>,
      reply,
    ) => {
      const requestingAgentId = getRequestingAgent(
        request.headers as Record<string, string | undefined>,
      );
      if (!requestingAgentId) {
        reply.code(401);
        return { error: 'Missing X-Agent-Id header', code: 'UNAUTHORIZED' };
      }

      const { agentId: targetAgentId, '*': filePath } = request.params;
      const fullPath = filePath || '';

      // Check if it's a file or directory by trying to read as file first
      try {
        // Try reading as file
        const access = validateAccess(requestingAgentId, targetAgentId, 'read');
        if (!access.allowed) {
          reply.code(403);
          return access.error;
        }

        const file = await workspaceService.readFileWithType(
          targetAgentId,
          fullPath,
          { maxContentBytes: MAX_EDITABLE_FILE_BYTES },
        );
        const response: FileContentResponse = {
          content: file.content,
          path: fullPath,
          isText: file.isText,
          mimeType: file.mimeType,
          size: file.size,
          modifiedAt: file.modifiedAt,
          isTooLarge: file.isTooLarge,
          ...(file.maxEditableBytes !== undefined
            ? { maxEditableBytes: file.maxEditableBytes }
            : {}),
        };
        return response;
      } catch {
        // If read fails, try listing as directory
        const access = validateAccess(requestingAgentId, targetAgentId, 'list');
        if (!access.allowed) {
          reply.code(403);
          return access.error;
        }

        try {
          const files = await workspaceService.listFiles(
            targetAgentId,
            fullPath,
          );
          const response: FileMetadataResponse[] = files.map((f: FileInfo) => ({
            name: f.name,
            path: f.path,
            isDirectory: f.isDirectory,
            size: f.size,
            modifiedAt: f.modifiedAt.toISOString(),
          }));
          return { items: response, path: fullPath };
        } catch {
          // Not a file or directory
          reply.code(404);
          return { error: 'Path not found', code: 'NOT_FOUND' };
        }
      }
    },
  );

  /**
   * POST /workspace/:agentId/files/*
   * Create a new file
   */
  app.post(
    '/workspace/:agentId/files/*',
    async (
      request: FastifyRequest<{
        Params: { agentId: string; '*': string };
        Body: FileWriteBody;
      }>,
      reply,
    ) => {
      const requestingAgentId = getRequestingAgent(
        request.headers as Record<string, string | undefined>,
      );
      if (!requestingAgentId) {
        reply.code(401);
        return { error: 'Missing X-Agent-Id header', code: 'UNAUTHORIZED' };
      }

      const { agentId: targetAgentId, '*': filePath } = request.params;
      const { content } = request.body as FileWriteBody;

      if (!filePath) {
        reply.code(400);
        return { error: 'File path is required', code: 'BAD_REQUEST' };
      }

      if (typeof content !== 'string') {
        reply.code(400);
        return { error: 'Content must be a string', code: 'BAD_REQUEST' };
      }

      const access = validateAccess(requestingAgentId, targetAgentId, 'write');
      if (!access.allowed) {
        reply.code(403);
        return access.error;
      }

      try {
        // Ensure workspace exists
        await workspaceService.ensureWorkspace(targetAgentId);
        await workspaceService.writeFile(targetAgentId, filePath, content);
        reply.code(201);
        return { success: true, path: filePath };
      } catch (error) {
        app.log.error(
          'Failed to create file: %s',
          error instanceof Error ? error.message : String(error),
        );
        reply.code(500);
        return { error: 'Failed to create file', code: 'INTERNAL_ERROR' };
      }
    },
  );

  /**
   * PUT /workspace/:agentId/files/*
   * Update an existing file
   */
  app.put(
    '/workspace/:agentId/files/*',
    async (
      request: FastifyRequest<{
        Params: { agentId: string; '*': string };
        Body: FileWriteBody;
      }>,
      reply,
    ) => {
      const requestingAgentId = getRequestingAgent(
        request.headers as Record<string, string | undefined>,
      );
      if (!requestingAgentId) {
        reply.code(401);
        return { error: 'Missing X-Agent-Id header', code: 'UNAUTHORIZED' };
      }

      const { agentId: targetAgentId, '*': filePath } = request.params;
      const { content, expectedModifiedAt } = request.body as FileWriteBody;

      if (!filePath) {
        reply.code(400);
        return { error: 'File path is required', code: 'BAD_REQUEST' };
      }

      if (typeof content !== 'string') {
        reply.code(400);
        return { error: 'Content must be a string', code: 'BAD_REQUEST' };
      }

      const access = validateAccess(requestingAgentId, targetAgentId, 'write');
      if (!access.allowed) {
        reply.code(403);
        return access.error;
      }

      try {
        // Check if file exists first
        const existingFile = await workspaceService.readFileWithType(
          targetAgentId,
          filePath,
          { maxContentBytes: MAX_EDITABLE_FILE_BYTES },
        );
        if (!existingFile.isText) {
          reply.code(415);
          return {
            error: `Cannot edit non-text file (${existingFile.mimeType})`,
            code: 'UNSUPPORTED_MEDIA_TYPE',
          };
        }

        if (existingFile.isTooLarge) {
          reply.code(413);
          return {
            error: `File is too large to edit (${existingFile.size} bytes)`,
            code: 'FILE_TOO_LARGE',
          };
        }

        if (
          expectedModifiedAt &&
          existingFile.modifiedAt !== expectedModifiedAt
        ) {
          reply.code(409);
          return {
            error: 'File changed on disk. Reload before saving.',
            code: 'CONFLICT',
          };
        }

        await workspaceService.writeFile(targetAgentId, filePath, content);
        return { success: true, path: filePath };
      } catch (error) {
        const workspaceError = error as { code?: string };
        if (workspaceError.code === 'FILE_NOT_FOUND') {
          reply.code(404);
          return { error: 'File not found', code: 'NOT_FOUND' };
        }
        app.log.error(
          'Failed to update file: %s',
          error instanceof Error ? error.message : String(error),
        );
        reply.code(500);
        return { error: 'Failed to update file', code: 'INTERNAL_ERROR' };
      }
    },
  );

  /**
   * DELETE /workspace/:agentId/files/*
   * Delete a file
   */
  app.delete(
    '/workspace/:agentId/files/*',
    async (
      request: FastifyRequest<{ Params: { agentId: string; '*': string } }>,
      reply,
    ) => {
      const requestingAgentId = getRequestingAgent(
        request.headers as Record<string, string | undefined>,
      );
      if (!requestingAgentId) {
        reply.code(401);
        return { error: 'Missing X-Agent-Id header', code: 'UNAUTHORIZED' };
      }

      const { agentId: targetAgentId, '*': filePath } = request.params;

      if (!filePath) {
        reply.code(400);
        return { error: 'File path is required', code: 'BAD_REQUEST' };
      }

      const access = validateAccess(requestingAgentId, targetAgentId, 'delete');
      if (!access.allowed) {
        reply.code(403);
        return access.error;
      }

      try {
        await workspaceService.deleteFile(targetAgentId, filePath);
        return { success: true, path: filePath };
      } catch (error) {
        const workspaceError = error as { code?: string };
        if (workspaceError.code === 'FILE_NOT_FOUND') {
          reply.code(404);
          return { error: 'File not found', code: 'NOT_FOUND' };
        }
        app.log.error(
          'Failed to delete file: %s',
          error instanceof Error ? error.message : String(error),
        );
        reply.code(500);
        return { error: 'Failed to delete file', code: 'INTERNAL_ERROR' };
      }
    },
  );

  app.post(
    '/workspace/:agentId/rename',
    async (
      request: FastifyRequest<{
        Params: { agentId: string };
        Body: FileRenameBody;
      }>,
      reply,
    ) => {
      const requestingAgentId = getRequestingAgent(
        request.headers as Record<string, string | undefined>,
      );
      if (!requestingAgentId) {
        reply.code(401);
        return { error: 'Missing X-Agent-Id header', code: 'UNAUTHORIZED' };
      }

      const { agentId: targetAgentId } = request.params;
      const { sourcePath, destinationPath } = request.body as FileRenameBody;

      if (!sourcePath || !destinationPath) {
        reply.code(400);
        return {
          error: 'Both sourcePath and destinationPath are required',
          code: 'BAD_REQUEST',
        };
      }

      const access = validateAccess(requestingAgentId, targetAgentId, 'write');
      if (!access.allowed) {
        reply.code(403);
        return access.error;
      }

      try {
        await workspaceService.renameFile(
          targetAgentId,
          sourcePath,
          destinationPath,
        );
        return { success: true, path: destinationPath };
      } catch (error) {
        const workspaceError = error as { code?: string };
        if (workspaceError.code === 'FILE_NOT_FOUND') {
          reply.code(404);
          return { error: 'File not found', code: 'NOT_FOUND' };
        }
        if (workspaceError.code === 'FILE_ALREADY_EXISTS') {
          reply.code(409);
          return { error: 'Destination already exists', code: 'CONFLICT' };
        }
        app.log.error(
          'Failed to rename file: %s',
          error instanceof Error ? error.message : String(error),
        );
        reply.code(500);
        return { error: 'Failed to rename file', code: 'INTERNAL_ERROR' };
      }
    },
  );
};
