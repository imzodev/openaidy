import type { BuiltinTool } from '@openaidy/runtime';
import type { AgentRegistry } from '../../agents/registry.js';
import { agentsListMeta } from '../catalog.js';

export function createAgentsListTool(
  agentRegistry: AgentRegistry,
): BuiltinTool {
  return {
    name: agentsListMeta.name,
    description: agentsListMeta.description,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },

    async execute(_args, _ctx) {
      const agents = agentRegistry.listAgents();
      const lines = agents.map(
        (a) =>
          `- id: "${a.id}"  name: "${a.name}"  model: ${a.model}${a.description ? `  desc: ${a.description}` : ''}`,
      );
      return {
        ok: true,
        content:
          agents.length === 0
            ? 'No enabled agents found.'
            : `${agents.length} agent(s):\n${lines.join('\n')}`,
      };
    },
  };
}
