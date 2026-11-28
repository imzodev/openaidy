import type { BuiltinTool } from '@aidyagent/runtime';
import { OWNER_MEMORY_AGENT_ID } from '@aidyagent/shared-types';
import type { MemoryToolDeps } from './index.js';
import { inCustomerChat } from './scope.js';
import { memorySaveMeta } from '../catalog.js';

export function createMemorySaveTool(deps: MemoryToolDeps): BuiltinTool {
  const log = deps.createLogger('memory_save');

  return {
    name: memorySaveMeta.name,
    description: memorySaveMeta.description,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short label for the memory, e.g. "ABC project stack"',
        },
        content: {
          type: 'string',
          description: 'Full text of the memory — facts, decisions, notes.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional array of category strings, e.g. ["project","react"]',
        },
        importance: {
          type: 'number',
          description:
            'Integer 1–5. Default 3. Use 5 for critical constraints, 1 for low-priority notes.',
        },
        scope: {
          type: 'string',
          enum: ['agent', 'owner'],
          description:
            '"agent" (default): your own notes. "owner": a fact about the owner that every agent should know — use it when the owner explicitly asks you to remember or correct something about them.',
        },
      },
      required: ['title', 'content'],
    },

    async execute(args, ctx) {
      const title = args['title'] as string;
      const content = args['content'] as string;
      const tags = args['tags'] as string[] | undefined;
      const importance = args['importance'] as number | undefined;
      const scope = args['scope'] ?? 'agent';

      if (typeof title !== 'string' || !title.trim()) {
        return {
          ok: false,
          error: 'title is required and must be a non-empty string',
        };
      }
      if (typeof content !== 'string' || !content.trim()) {
        return {
          ok: false,
          error: 'content is required and must be a non-empty string',
        };
      }
      if (
        importance !== undefined &&
        (!Number.isInteger(importance) || importance < 1 || importance > 5)
      ) {
        return {
          ok: false,
          error: 'importance must be an integer between 1 and 5',
        };
      }

      if (scope !== 'agent' && scope !== 'owner') {
        return { ok: false, error: 'scope must be "agent" or "owner"' };
      }
      if (scope === 'owner' && (await inCustomerChat(deps, ctx.sessionId))) {
        return {
          ok: false,
          error:
            'Facts about the owner can only be saved in a conversation with the owner, not with a customer.',
        };
      }

      log.info('memory_save invoked', {
        agentId: ctx.agentId,
        title: title.trim(),
      });

      const memory = await deps.memoriesRepo.create({
        agentId: scope === 'owner' ? OWNER_MEMORY_AGENT_ID : ctx.agentId,
        title: title.trim(),
        content: content.trim(),
        tags: tags ?? [],
        importance: importance ?? 3,
      });

      log.info('memory_save completed', { memoryId: memory.id });

      return {
        ok: true,
        content: JSON.stringify({ id: memory.id, message: 'Memory saved.' }),
      };
    },
  };
}
