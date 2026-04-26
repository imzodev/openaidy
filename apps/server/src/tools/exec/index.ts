import type { BuiltinTool } from '@openaidy/runtime';
import type { ExecService } from '../../exec/service';
import type { WorkspaceService } from '../../workspace/service';
import { createExecRunTool } from './run';

export { createExecRunTool } from './run';

/**
 * Returns all exec builtin tools backed by the given ExecService and WorkspaceService.
 *
 * Register selectively per-agent via `tools` in the agent config:
 *   "tools": ["exec_run"]
 */
export function createExecTools(
  exec: ExecService,
  workspace: WorkspaceService,
): BuiltinTool[] {
  return [createExecRunTool(exec, workspace)];
}
