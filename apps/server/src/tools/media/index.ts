import type { WorkspaceService } from '../../workspace/service';
import type { BuiltinTool } from '@openaidy/runtime';
import { createMediaShareTool } from './share';

export { createMediaShareTool } from './share';
export type { MediaShareResult } from './share';

/**
 * Returns all media builtin tools backed by the given services.
 *
 * Register them selectively per-agent via `tools` in the agent config:
 *   "tools": ["media_share"]
 */
export function createMediaTools(workspace: WorkspaceService): BuiltinTool[] {
  return [createMediaShareTool(workspace)];
}
