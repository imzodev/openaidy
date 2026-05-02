import type { BuiltinTool } from '@openaidy/runtime';
import type { SkillRegistry } from '../../skills/index.js';
import type { WorkspaceService } from '../../workspace/service.js';
import { createSkillCreateTool } from './create.js';

export { createSkillCreateTool } from './create.js';

export function createSkillTools(
  skillRegistry: SkillRegistry,
  workspace: WorkspaceService,
): BuiltinTool[] {
  return [createSkillCreateTool(skillRegistry, workspace)];
}
