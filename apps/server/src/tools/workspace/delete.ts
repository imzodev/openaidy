import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';

/**
 * workspace_delete
 *
 * Deletes a file from the agent's workspace.
 */
export function createWorkspaceDeleteTool(
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: 'workspace_delete',
    description: 'Delete a file from the agent workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path to the file to delete within the workspace',
        },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      const filePath = args['path'];

      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'path is required and must be a string' };
      }

      try {
        await workspace.deleteFile(ctx.agentId, filePath);
        return { ok: true, content: `File deleted: ${filePath}` };
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
