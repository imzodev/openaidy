import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BuiltinToolRegistry } from '../tools/registry';
import { AgentRegistry } from '../agents/registry';
import type { BuiltinTool } from '@openaidy/runtime';

/**
 * Unit tests for the builtin tool execution guard in SessionMessageService.
 *
 * The guard pattern (from service.ts) is:
 *   const enabledTools = agents.getAgent(agentId)?.tools ?? [];
 *   const builtinTool = enabledTools.includes(tc.name)
 *     ? builtinTools.get(tc.name)
 *     : undefined;
 *
 * These tests verify the guard logic directly using real registry and agent instances,
 * without spinning up the full session service.
 */

function makeTool(
  name: string,
  executeFn?: () => Promise<{ ok: true; content: string }>,
): BuiltinTool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {}, required: [] },
    execute:
      executeFn ??
      vi.fn().mockResolvedValue({ ok: true, content: `result of ${name}` }),
  };
}

function makeAgent(tools: string[] | undefined) {
  return {
    id: 'agent1',
    name: 'Test Agent',
    enabled: true,
    systemPrompt: 'Prompt',
    model: 'openai/gpt-4',
    version: 1 as const,
    tools,
  };
}

/** Mirrors the guard in service.ts */
function resolveBuiltinTool(
  toolName: string,
  agentId: string,
  agents: AgentRegistry,
  builtinTools: BuiltinToolRegistry,
): BuiltinTool | undefined {
  const enabledTools = agents.getAgent(agentId)?.tools ?? [];
  return enabledTools.includes(toolName)
    ? builtinTools.get(toolName)
    : undefined;
}

describe('SessionMessageService — builtin tool execution guard', () => {
  let builtinTools: BuiltinToolRegistry;
  let agents: AgentRegistry;

  beforeEach(() => {
    builtinTools = new BuiltinToolRegistry();
    builtinTools.register(makeTool('workspace_read'));
    builtinTools.register(makeTool('workspace_list'));
    builtinTools.register(makeTool('workspace_write'));

    agents = new AgentRegistry();
  });

  it('resolves a tool that is registered and enabled for the agent', () => {
    agents.replaceAll([makeAgent(['workspace_read', 'workspace_list'])]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeDefined();
    expect(tool?.name).toBe('workspace_read');
  });

  it('returns undefined for a tool that is registered but NOT in the agent tools list', () => {
    agents.replaceAll([makeAgent(['workspace_read'])]);

    const tool = resolveBuiltinTool(
      'workspace_write',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('returns undefined when agent has no tools configured (undefined)', () => {
    agents.replaceAll([makeAgent(undefined)]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('returns undefined when agent has an empty tools array', () => {
    agents.replaceAll([makeAgent([])]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'agent1',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('returns undefined when the agent does not exist', () => {
    agents.replaceAll([]);

    const tool = resolveBuiltinTool(
      'workspace_read',
      'ghost',
      agents,
      builtinTools,
    );

    expect(tool).toBeUndefined();
  });

  it('reflects in-memory tool update immediately — disabled tool becomes inaccessible', () => {
    agents.replaceAll([makeAgent(['workspace_read', 'workspace_write'])]);

    expect(
      resolveBuiltinTool('workspace_write', 'agent1', agents, builtinTools),
    ).toBeDefined();

    agents.updateAgentTools('agent1', ['workspace_read']); // disable workspace_write

    expect(
      resolveBuiltinTool('workspace_write', 'agent1', agents, builtinTools),
    ).toBeUndefined();
    expect(
      resolveBuiltinTool('workspace_read', 'agent1', agents, builtinTools),
    ).toBeDefined();
  });

  it('reflects in-memory tool update immediately — enabled tool becomes accessible', () => {
    agents.replaceAll([makeAgent([])]);

    expect(
      resolveBuiltinTool('workspace_list', 'agent1', agents, builtinTools),
    ).toBeUndefined();

    agents.updateAgentTools('agent1', ['workspace_list']);

    expect(
      resolveBuiltinTool('workspace_list', 'agent1', agents, builtinTools),
    ).toBeDefined();
  });
});
