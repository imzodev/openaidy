import type { BuiltinTool } from '@openaidy/runtime';
import type { AgentRegistry } from '../../agents/registry.js';
import type { SessionMessageService } from '../../sessions/service.js';
import { createAgentsListTool } from './list.js';
import { createAgentsCreateTool } from './create.js';
import { createAgentsInvokeTool } from './invoke.js';

export { createAgentsListTool } from './list.js';
export { createAgentsCreateTool } from './create.js';
export { createAgentsInvokeTool } from './invoke.js';

export type AgentToolsDeps = {
  registry: AgentRegistry;
  getSessionService?: () => SessionMessageService;
};

export function createAgentTools(deps: AgentToolsDeps): BuiltinTool[] {
  return [
    createAgentsListTool(deps.registry),
    createAgentsCreateTool(deps.registry),
    createAgentsInvokeTool(deps),
  ];
}
