import type { BuiltinTool } from '@openaidy/runtime';
import type { SkillRegistry } from '../../skills/index.js';
import { createSkillCreateTool } from './create.js';

export { createSkillCreateTool } from './create.js';

export function createSkillTools(
  skillRegistry: SkillRegistry,
  skillsDir: string,
): BuiltinTool[] {
  return [createSkillCreateTool(skillRegistry, skillsDir)];
}
