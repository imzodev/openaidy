import type { BuiltinTool } from '@aidyagent/runtime';
import { OWNER_MEMORY_AGENT_ID } from '@aidyagent/shared-types';
import type { MemoryToolDeps } from './index.js';
import { inCustomerChat } from './scope.js';
import { memoryDeleteMeta } from '../catalog.js';

export function createMemoryDeleteTool(deps: MemoryToolDeps): BuiltinTool {
  const log = deps.createLogger('memory_delete');

  return {
    name: memoryDeleteMeta.name,
    description: memoryDeleteMeta.description,
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The ID of the memory to delete. Get the ID from memory_search or memory_save.',
        },
      },
      required: ['id'],
    },

    async execute(args, ctx) {
      const id = args['id'] as string;

      if (typeof id !== 'string' || !id.trim()) {
        return {
          ok: false,
          error: 'id is required and must be a non-empty string',
        };
      }

      const isDefault = ctx.agentId === deps.defaultAgentId;
      const scopedAgentId = isDefault ? undefined : ctx.agentId;

      log.info('memory_delete invoked', {
        memoryId: id.trim(),
        agentId: scopedAgentId,
      });

      // A fact about the owner is shared, so any agent the owner is talking
      // to may forget it when asked; nobody may from a customer chat.
      const memoryId = id.trim();
      const inCustomer = await inCustomerChat(deps, ctx.sessionId);
      const target = await deps.memoriesRepo.findById(memoryId);
      const isOwnerFact = target?.agentId === OWNER_MEMORY_AGENT_ID;
      const deleted =
        isOwnerFact && inCustomer
          ? false
          : await deps.memoriesRepo.delete(
              memoryId,
              isOwnerFact ? OWNER_MEMORY_AGENT_ID : scopedAgentId,
            );

      log.info('memory_delete completed', { memoryId: id.trim(), deleted });

      if (deleted) {
        return { ok: true, content: 'Memory deleted.' };
      }
      return { ok: false, error: 'Memory not found or access denied.' };
    },
  };
}
