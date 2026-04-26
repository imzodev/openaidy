import type { BuiltinTool } from '@openaidy/runtime';
import type { ExecService } from '../../exec/service';
import { createExecRunTool } from './run';

export { createExecRunTool } from './run';

/**
 * Returns all exec builtin tools backed by the given ExecService.
 *
 * Register selectively per-agent via `tools` in the agent config:
 *   "tools": ["exec_run"]
 */
export function createExecTools(exec: ExecService): BuiltinTool[] {
  return [createExecRunTool(exec)];
}
