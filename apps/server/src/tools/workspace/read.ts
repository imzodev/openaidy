import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';

/**
 * workspace_read
 *
 * Reads the contents of a file from the agent's workspace.
 */
export function createWorkspaceReadTool(
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: 'workspace_read',
    description:
      'Read the contents of a file in the agent workspace. ' +
      'Returns the file content as a string.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file within the workspace',
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
        const content = await workspace.readFile(ctx.agentId, filePath);
        return { ok: true, content };
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
