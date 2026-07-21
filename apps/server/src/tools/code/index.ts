import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { createCodeReadTool } from './read';
import { createCodeEditTool } from './edit';
import { createCodeSearchTool } from './search';
import { createCodeGlobTool } from './glob';

export { createCodeReadTool } from './read';
export { createCodeEditTool } from './edit';
export { createCodeSearchTool } from './search';
export { createCodeGlobTool } from './glob';

/**
 * Returns the code-editing builtin tools.
 *
 * These are deliberately separate from the generic `workspace_*` tools:
 * the workspace tools operate on arbitrary file content, while the code
 * tools are optimized for source code — `code_read` returns `cat -n`
 * line numbers, `code_edit` does surgical text substitution, and the
 * search tools (`code_search`, `code_glob`) cover what an agent needs to
 * navigate a codebase without reading every file.
 *
 * Register them per-agent via `nativeTools` in the agent config:
 *   "nativeTools": ["code_read", "code_edit", "code_search", "code_glob"]
 */
export function createCodeTools(workspace: WorkspaceService): BuiltinTool[] {
  return [
    createCodeReadTool(workspace),
    createCodeEditTool(workspace),
    createCodeSearchTool(workspace),
    createCodeGlobTool(workspace),
  ];
}
