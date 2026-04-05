import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  parseAgent,
  validateAgentIdMatch,
  toAgentSummary,
  parseModelString,
  McpServerRefSchema,
} from './schema';

describe('AgentSchema', () => {
  it('should parse a valid agent', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
    });
    expect(agent.id).toBe('test-agent');
    expect(agent.name).toBe('Test Agent');
    expect(agent.enabled).toBe(true);
    expect(agent.systemPrompt).toBe('You are a test assistant.');
    expect(agent.model).toBe('openai/gpt-4o-mini');
  });

  it('should require model field', () => {
    const result = AgentSchema.safeParse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
    });
    expect(result.success).toBe(false);
  });

  it('should allow optional fields', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      description: 'A test agent',
      tags: ['test', 'example'],
      version: 2,
    });
    expect(agent.description).toBe('A test agent');
    expect(agent.tags).toEqual(['test', 'example']);
    expect(agent.version).toBe(2);
  });
});

describe('McpServerRefSchema', () => {
  it('should parse valid MCP server reference with tools', () => {
    const ref = McpServerRefSchema.parse({
      id: 'filesystem',
      tools: ['read_file', 'write_file'],
    });
    expect(ref.id).toBe('filesystem');
    expect(ref.tools).toEqual(['read_file', 'write_file']);
  });

  it('should parse MCP server reference without tools (all tools)', () => {
    const ref = McpServerRefSchema.parse({
      id: 'github',
    });
    expect(ref.id).toBe('github');
    expect(ref.tools).toBeUndefined();
  });

  it('should require id field', () => {
    const result = McpServerRefSchema.safeParse({
      tools: ['read_file'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty id', () => {
    const result = McpServerRefSchema.safeParse({
      id: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('AgentSchema with mcpServers', () => {
  it('should parse agent with mcpServers', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      mcpServers: [
        { id: 'filesystem', tools: ['read_file', 'write_file'] },
        { id: 'github' },
      ],
    });
    expect(agent.mcpServers).toHaveLength(2);
    expect(agent.mcpServers?.[0].id).toBe('filesystem');
    expect(agent.mcpServers?.[0].tools).toEqual(['read_file', 'write_file']);
    expect(agent.mcpServers?.[1].id).toBe('github');
    expect(agent.mcpServers?.[1].tools).toBeUndefined();
  });

  it('should parse agent with empty mcpServers array', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      mcpServers: [],
    });
    expect(agent.mcpServers).toEqual([]);
  });

  it('should parse legacy agent with tools field', () => {
    const agent = AgentSchema.parse({
      id: 'legacy-agent',
      name: 'Legacy Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      tools: ['chat', 'streaming'],
    });
    expect(agent.tools).toEqual(['chat', 'streaming']);
    expect(agent.mcpServers).toBeUndefined();
  });

  it('should parse agent with both mcpServers and legacy tools', () => {
    const agent = AgentSchema.parse({
      id: 'hybrid-agent',
      name: 'Hybrid Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      mcpServers: [{ id: 'filesystem' }],
      tools: ['custom_tool'],
    });
    expect(agent.mcpServers).toHaveLength(1);
    expect(agent.tools).toEqual(['custom_tool']);
  });
});

describe('parseModelString', () => {
  it('should parse valid model string', () => {
    const result = parseModelString('openai/gpt-4o-mini');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4o-mini' });
  });

  it('should return null for invalid format', () => {
    expect(parseModelString('invalid')).toBeNull();
    expect(parseModelString('invalid/')).toBeNull();
    expect(parseModelString('/invalid')).toBeNull();
    expect(parseModelString('')).toBeNull();
  });
});

describe('parseAgent', () => {
  it('should parse valid agent JSON', () => {
    const result = parseAgent(
      {
        id: 'test-agent',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'You are a test assistant.',
        model: 'openai/gpt-4o-mini',
      },
      'test-agent.json',
    );

    expect('id' in result && result.id).toBe('test-agent');
  });

  it('should return error for invalid agent', () => {
    const result = parseAgent(
      {
        id: 'test-agent',
        name: 'Test Agent',
        // missing required fields
      },
      'test-agent.json',
    );

    expect('filePath' in result).toBe(true);
    expect('errors' in result).toBe(true);
  });

  it('should parse agent with mcpServers via parseAgent', () => {
    const result = parseAgent(
      {
        id: 'mcp-agent',
        name: 'MCP Agent',
        enabled: true,
        systemPrompt: 'You are a test assistant.',
        model: 'openai/gpt-4o-mini',
        mcpServers: [{ id: 'filesystem', tools: ['read_file'] }],
      },
      'mcp-agent.json',
    );

    expect('mcpServers' in result && result.mcpServers).toBeDefined();
    expect('mcpServers' in result && result.mcpServers?.[0].id).toBe(
      'filesystem',
    );
  });
});

describe('validateAgentIdMatch', () => {
  it('should return true when id matches filename', () => {
    expect(validateAgentIdMatch('my-agent', 'my-agent.json')).toBe(true);
  });

  it('should return false when id does not match filename', () => {
    expect(validateAgentIdMatch('my-agent', 'other-agent.json')).toBe(false);
  });
});

describe('toAgentSummary', () => {
  it('should convert agent to summary', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      description: 'A test agent',
      tags: ['test'],
    });

    const summary = toAgentSummary(agent);
    expect(summary.id).toBe('test-agent');
    expect(summary.name).toBe('Test Agent');
    expect(summary.description).toBe('A test agent');
    expect(summary.enabled).toBe(true);
    expect(summary.tags).toEqual(['test']);
    expect(summary.model).toBe('openai/gpt-4o-mini');
    expect('systemPrompt' in summary).toBe(false);
  });

  it('should include mcpServers in summary', () => {
    const agent = AgentSchema.parse({
      id: 'mcp-agent',
      name: 'MCP Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      mcpServers: [
        { id: 'filesystem', tools: ['read_file', 'write_file'] },
        { id: 'github' },
      ],
    });

    const summary = toAgentSummary(agent);
    expect(summary.mcpServers).toBeDefined();
    expect(summary.mcpServers).toHaveLength(2);
    expect(summary.mcpServers?.[0].id).toBe('filesystem');
    expect(summary.mcpServers?.[0].tools).toEqual(['read_file', 'write_file']);
    expect(summary.mcpServers?.[1].id).toBe('github');
    expect(summary.mcpServers?.[1].tools).toBeUndefined();
  });

  it('should include legacy tools in summary', () => {
    const agent = AgentSchema.parse({
      id: 'legacy-agent',
      name: 'Legacy Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      tools: ['custom_tool', 'another_tool'],
    });

    const summary = toAgentSummary(agent);
    expect(summary.tools).toEqual(['custom_tool', 'another_tool']);
    expect(summary.mcpServers).toBeUndefined();
  });
});
