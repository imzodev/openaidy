import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';

/**
 * workspace_list
 *
 * Lists files and directories inside a workspace path.
 */
export function createWorkspaceListTool(
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: 'workspace_list',
    description:
      'List files and directories in the agent workspace. ' +
      'Returns a JSON array of entries with name, path, size, and whether each entry is a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path to list within the workspace. Defaults to the workspace root.',
        },
      },
      required: [],
    },
    async execute(args, ctx) {
      const dirPath =
        typeof args['path'] === 'string' ? args['path'] : undefined;

      try {
        const files = await workspace.listFiles(ctx.agentId, dirPath);
        const entries = files.map((f) => ({
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory,
          size: f.size,
        }));
        return { ok: true, content: JSON.stringify(entries, null, 2) };
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `Failed to list files: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
