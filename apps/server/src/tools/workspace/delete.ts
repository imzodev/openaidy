import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';
import { workspaceDeleteMeta } from '../catalog.js';

/**
 * workspace_delete
 *
 * Deletes a file or directory from the agent's workspace. Non-empty
 * directories require `recursive: true`.
 */
export function createWorkspaceDeleteTool(
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: workspaceDeleteMeta.name,
    description: workspaceDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path to the file or directory to delete within the workspace',
        },
        recursive: {
          type: 'boolean',
          description:
            'Required to delete a non-empty directory and everything inside it. Defaults to false.',
        },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      const filePath = args['path'];

      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'path is required and must be a string' };
      }

      const recursive = args['recursive'] === true;

      try {
        await workspace.deleteFile(ctx.agentId, filePath, { recursive });
        return { ok: true, content: `Deleted: ${filePath}` };
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `Failed to delete: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
