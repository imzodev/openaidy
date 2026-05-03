import type { BuiltinTool } from '@openaidy/runtime';
import type { AgentRegistry } from '../../agents/registry.js';

export function createAgentsCreateTool(
  agentRegistry: AgentRegistry,
): BuiltinTool {
  return {
    name: 'agents_create',
    description:
      'Create a new agent and register it in this OpenAidy instance. ' +
      'The agent is immediately available for use after creation. ' +
      'Use agents_list first to verify the id does not already exist.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'Unique agent identifier — lowercase alphanumeric with hyphens (e.g. "code-reviewer"). ' +
            'Must not already exist.',
        },
        name: {
          type: 'string',
          description: 'Human-readable display name (e.g. "Code Reviewer").',
        },
        systemPrompt: {
          type: 'string',
          description:
            "The system prompt that defines this agent's behaviour and persona.",
        },
        model: {
          type: 'string',
          description:
            'Model identifier in "providerId/modelId" format (e.g. "minimax/MiniMax-M2.7"). ' +
            'Use the same provider/model as the currently running agent if unsure.',
        },
        description: {
          type: 'string',
          description: 'Short one-line description of what this agent does.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorisation.',
        },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of skill IDs to assign to the agent.',
        },
      },
      required: ['id', 'name', 'systemPrompt', 'model'],
    },

    async execute(args, _ctx) {
      const id = args['id'];
      const name = args['name'];
      const systemPrompt = args['systemPrompt'];
      const model = args['model'];
      const description =
        typeof args['description'] === 'string'
          ? args['description']
          : undefined;
      const tags = Array.isArray(args['tags'])
        ? (args['tags'] as string[])
        : undefined;
      const skills = Array.isArray(args['skills'])
        ? (args['skills'] as string[])
        : undefined;

      if (typeof id !== 'string' || !id) {
        return {
          ok: false,
          error: 'id is required and must be a non-empty string',
        };
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        return {
          ok: false,
          error:
            'id must be lowercase alphanumeric with hyphens (e.g. "my-agent")',
        };
      }
      if (typeof name !== 'string' || !name) {
        return {
          ok: false,
          error: 'name is required and must be a non-empty string',
        };
      }
      if (typeof systemPrompt !== 'string' || !systemPrompt) {
        return {
          ok: false,
          error: 'systemPrompt is required and must be a non-empty string',
        };
      }
      if (typeof model !== 'string' || !model) {
        return {
          ok: false,
          error: 'model is required and must be a non-empty string',
        };
      }

      try {
        const agent = agentRegistry.createAgent({
          id,
          name,
          systemPrompt,
          model,
          ...(description !== undefined ? { description } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(skills !== undefined ? { skills } : {}),
        });
        return {
          ok: true,
          content: `Agent "${agent.id}" ("${agent.name}") created successfully. It is now available in this instance.`,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
