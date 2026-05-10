import type { BuiltinTool } from '@openaidy/runtime';
import type { SessionMessageService } from '../../sessions/service.js';
import { createSessionsCreateTool } from './create.js';
import { createSessionsListTool } from './list.js';
import { createSessionsReadTool } from './read.js';
import { createSessionsSendTool } from './send.js';
import { createAgentsInvokeTool } from './invoke-agent.js';

export { createSessionsCreateTool } from './create.js';
export { createSessionsListTool } from './list.js';
export { createSessionsReadTool } from './read.js';
export { createSessionsSendTool } from './send.js';
export { createAgentsInvokeTool } from './invoke-agent.js';

export type SessionsToolDeps = {
  getSessionService: () => SessionMessageService;
};

export function createSessionTools(deps: SessionsToolDeps): BuiltinTool[] {
  return [
    createSessionsCreateTool(deps),
    createSessionsListTool(deps),
    createSessionsReadTool(deps),
    createSessionsSendTool(deps),
    createAgentsInvokeTool(deps),
  ];
}
