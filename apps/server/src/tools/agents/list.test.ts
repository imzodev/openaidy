import { describe, it, expect, vi } from 'vitest';
import { createAgentsListTool } from './list.js';
import type { AgentRegistry } from '../../agents/registry.js';

function makeAgentRegistry(agents: unknown[]): AgentRegistry {
  return {
    listAgents: vi.fn().mockReturnValue(agents),
  } as unknown as AgentRegistry;
}

describe('agents_list tool', () => {
  it('reports "no enabled agents" when the registry is empty', async () => {
    const tool = createAgentsListTool(makeAgentRegistry([]));
    const result = await tool.execute({}, { agentId: 'caller' });
    expect(result).toEqual({ ok: true, content: 'No enabled agents found.' });
  });

  it('includes tools, skills, and mcpServers for an agent that has them', async () => {
    const tool = createAgentsListTool(
      makeAgentRegistry([
        {
          id: 'researcher',
          name: 'Researcher',
          model: 'openai/gpt-4o',
          description: 'Digs up facts.',
          tools: ['web_search', 'web_fetch'],
          skills: ['deep-research'],
          mcpServers: [
            { id: 'github', tools: ['search_code'] },
            { id: 'context7' },
          ],
        },
      ]),
    );
    const result = await tool.execute({}, { agentId: 'caller' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('id: "researcher"');
    expect(result.content).toContain('model: openai/gpt-4o');
    expect(result.content).toContain('desc: Digs up facts.');
    expect(result.content).toContain('tools: web_search, web_fetch');
    expect(result.content).toContain('skills: deep-research');
    // Scoped MCP tools are shown inline; an unscoped server ref is shown bare.
    expect(result.content).toContain(
      'mcpServers: github (search_code), context7',
    );
  });

  it('shows "(none)" for tools/skills/mcpServers an agent does not have', async () => {
    const tool = createAgentsListTool(
      makeAgentRegistry([
        { id: 'plain', name: 'Plain Agent', model: 'openai/gpt-4o-mini' },
      ]),
    );
    const result = await tool.execute({}, { agentId: 'caller' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('tools: (none)');
    expect(result.content).toContain('skills: (none)');
    expect(result.content).toContain('mcpServers: (none)');
  });

  it('lists multiple agents, one block per agent', async () => {
    const tool = createAgentsListTool(
      makeAgentRegistry([
        { id: 'a', name: 'A', model: 'openai/gpt-4o' },
        { id: 'b', name: 'B', model: 'openai/gpt-4o-mini' },
      ]),
    );
    const result = await tool.execute({}, { agentId: 'caller' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('2 agent(s):');
    expect(result.content).toContain('id: "a"');
    expect(result.content).toContain('id: "b"');
  });
});
