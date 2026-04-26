import type { WorkspaceService } from '../../workspace/service';
import type { BuiltinTool } from '@openaidy/runtime';
import { createWorkspaceReadTool } from './read';
import { createWorkspaceWriteTool } from './write';
import { createWorkspaceListTool } from './list';
import { createWorkspaceDeleteTool } from './delete';

export { createWorkspaceReadTool } from './read';
export { createWorkspaceWriteTool } from './write';
export { createWorkspaceListTool } from './list';
export { createWorkspaceDeleteTool } from './delete';

/**
 * Returns all workspace builtin tools backed by the given WorkspaceService.
 *
 * Register them selectively per-agent via `nativeTools` in the agent config:
 *   "nativeTools": ["workspace_read", "workspace_list", "workspace_write", "workspace_delete"]
 */
export function createWorkspaceTools(
  workspace: WorkspaceService,
): BuiltinTool[] {
  return [
    createWorkspaceReadTool(workspace),
    createWorkspaceWriteTool(workspace),
    createWorkspaceListTool(workspace),
    createWorkspaceDeleteTool(workspace),
  ];
}
