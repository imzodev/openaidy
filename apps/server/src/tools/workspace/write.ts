import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';
import { workspaceWriteMeta } from '../catalog.js';

/**
 * workspace_write
 *
 * Writes content to a file in the agent's workspace.
 * Creates the file (and any parent directories) if it does not exist.
 */
export function createWorkspaceWriteTool(
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: workspaceWriteMeta.name,
    description: workspaceWriteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file within the workspace',
        },
        content: {
          type: 'string',
          description: 'Text content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    async execute(args, ctx) {
      const filePath = args['path'];
      const content = args['content'];

      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'path is required and must be a string' };
      }
      if (typeof content !== 'string') {
        return { ok: false, error: 'content is required and must be a string' };
      }

      try {
        await workspace.writeFile(ctx.agentId, filePath, content);
        return { ok: true, content: `File written: ${filePath}` };
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
