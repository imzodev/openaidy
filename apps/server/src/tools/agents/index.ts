import type { BuiltinTool } from '@openaidy/runtime';
import type { AgentRegistry } from '../../agents/registry.js';
import { createAgentsListTool } from './list.js';
import { createAgentsCreateTool } from './create.js';

export { createAgentsListTool } from './list.js';
export { createAgentsCreateTool } from './create.js';

export function createAgentTools(agentRegistry: AgentRegistry): BuiltinTool[] {
  return [
    createAgentsListTool(agentRegistry),
    createAgentsCreateTool(agentRegistry),
  ];
}
