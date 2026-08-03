import type { BuiltinTool } from '@openaidy/runtime';
import type { SkillRegistry } from '../../skills/index.js';
import type { AgentRegistry } from '../../agents/registry.js';
import type { WorkspaceService } from '../../workspace/service.js';
import { createSkillCreateTool } from './create.js';
import { createSkillUpdateTool } from './update.js';

export { createSkillCreateTool } from './create.js';
export { createSkillUpdateTool } from './update.js';

export function createSkillTools(
  skillRegistry: SkillRegistry,
  agentRegistry: AgentRegistry,
  workspace: WorkspaceService,
): BuiltinTool[] {
  return [
    createSkillCreateTool(skillRegistry, agentRegistry, workspace),
    createSkillUpdateTool(skillRegistry, workspace),
  ];
}
