import type { BuiltinTool } from '@openaidy/runtime';
import type { AgentRegistry } from '../../agents/registry.js';
import type { McpServerRef } from '@openaidy/shared-types';
import { agentsListMeta } from '../catalog.js';

function formatList(value: string[] | undefined): string {
  if (!value || value.length === 0) return '(none)';
  return value.join(', ');
}

function formatMcpServers(mcpServers: McpServerRef[] | undefined): string {
  if (!mcpServers || mcpServers.length === 0) return '(none)';
  return mcpServers
    .map((m) =>
      m.tools && m.tools.length > 0 ? `${m.id} (${m.tools.join(', ')})` : m.id,
    )
    .join(', ');
}

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
          `- id: "${a.id}"  name: "${a.name}"  model: ${a.model}${a.description ? `  desc: ${a.description}` : ''}\n` +
          `  tools: ${formatList(a.tools)}\n` +
          `  skills: ${formatList(a.skills)}\n` +
          `  mcpServers: ${formatMcpServers(a.mcpServers)}`,
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
