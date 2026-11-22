import type { BuiltinTool } from '@aidyagent/runtime';
import type { MemoriesRepository } from '@aidyagent/db';
import type { SessionsStore } from '@aidyagent/db';
import { createLogger } from '../../lib/logger';
import { createMemorySaveTool } from './save.js';
import { createMemorySearchTool } from './search.js';
import { createMemoryDeleteTool } from './delete.js';
import { createSessionsSearchTool } from './sessions-search.js';

export type MemoryToolDeps = {
  memoriesRepo: MemoriesRepository;
  sessionsRepo: SessionsStore;
  defaultAgentId: string;
  createLogger: typeof createLogger;
};

export function createMemoryTools(deps: MemoryToolDeps): BuiltinTool[] {
  return [
    createMemorySaveTool(deps),
    createMemorySearchTool(deps),
    createMemoryDeleteTool(deps),
    createSessionsSearchTool(deps),
  ];
}
