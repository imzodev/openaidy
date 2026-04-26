import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  parseAgent,
  validateAgentIdMatch,
  toAgentSummary,
  parseModelString,
  WorkspacePermissionsSchema,
  WorkspaceSchema,
  WorkspaceConfigSchema,
  getAgentWorkspace,
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
    expect(agent.mcpServers?.[0]?.id).toBe('filesystem');
    expect(agent.mcpServers?.[0]?.tools).toEqual(['read_file', 'write_file']);
    expect(agent.mcpServers?.[1]?.id).toBe('github');
    expect(agent.mcpServers?.[1]?.tools).toBeUndefined();
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
    expect('mcpServers' in result && result.mcpServers?.[0]?.id).toBe(
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
    expect(summary.mcpServers?.[0]?.id).toBe('filesystem');
    expect(summary.mcpServers?.[0]?.tools).toEqual(['read_file', 'write_file']);
    expect(summary.mcpServers?.[1]?.id).toBe('github');
    expect(summary.mcpServers?.[1]?.tools).toBeUndefined();
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

describe('WorkspacePermissionsSchema', () => {
  it('should parse valid permissions', () => {
    const permissions = WorkspacePermissionsSchema.parse({
      read: true,
      write: true,
      delete: false,
      list: true,
    });
    expect(permissions.read).toBe(true);
    expect(permissions.write).toBe(true);
    expect(permissions.delete).toBe(false);
    expect(permissions.list).toBe(true);
  });

  it('should apply default values', () => {
    const permissions = WorkspacePermissionsSchema.parse({});
    expect(permissions.read).toBe(true);
    expect(permissions.write).toBe(false);
    expect(permissions.delete).toBe(false);
    expect(permissions.list).toBe(true);
  });

  it('should reject invalid permission types', () => {
    const result = WorkspacePermissionsSchema.safeParse({
      read: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

describe('WorkspaceSchema', () => {
  it('should parse valid workspace with required fields', () => {
    const workspace = WorkspaceSchema.parse({
      path: '/home/user/project',
    });
    expect(workspace.path).toBe('/home/user/project');
  });

  it('should parse workspace with permissions', () => {
    const workspace = WorkspaceSchema.parse({
      path: '/home/user/project',
      permissions: {
        read: true,
        write: true,
      },
    });
    expect(workspace.path).toBe('/home/user/project');
    expect(workspace.permissions?.read).toBe(true);
    expect(workspace.permissions?.write).toBe(true);
  });

  it('should parse workspace with include/exclude patterns', () => {
    const workspace = WorkspaceSchema.parse({
      path: '/home/user/project',
      include: ['**/*.ts'],
      exclude: ['node_modules/**'],
    });
    expect(workspace.include).toEqual(['**/*.ts']);
    expect(workspace.exclude).toEqual(['node_modules/**']);
  });

  it('should reject workspace without path', () => {
    const result = WorkspaceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject workspace with empty path', () => {
    const result = WorkspaceSchema.safeParse({
      path: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('WorkspaceConfigSchema', () => {
  it('should parse valid workspace config', () => {
    const config = WorkspaceConfigSchema.parse({
      enabled: true,
      workspaces: [
        { path: '/home/user/project1' },
        { path: '/home/user/project2' },
      ],
    });
    expect(config.enabled).toBe(true);
    expect(config.workspaces).toHaveLength(2);
  });

  it('should apply default values', () => {
    const config = WorkspaceConfigSchema.parse({});
    expect(config.enabled).toBe(true);
    expect(config.workspaces).toEqual([]);
  });

  it('should parse config with default permissions', () => {
    const config = WorkspaceConfigSchema.parse({
      defaultPermissions: {
        read: true,
        write: false,
      },
      workspaces: [{ path: '/project' }],
    });
    expect(config.defaultPermissions?.read).toBe(true);
    expect(config.defaultPermissions?.write).toBe(false);
  });
});

describe('AgentSchema with workspace', () => {
  it('should parse agent with workspace config', () => {
    const agent = AgentSchema.parse({
      id: 'workspace-agent',
      name: 'Workspace Agent',
      enabled: true,
      systemPrompt: 'You have workspace access.',
      model: 'openai/gpt-4o-mini',
      workspace: {
        enabled: true,
        workspaces: [{ path: '/home/user/project' }],
      },
    });
    expect(agent.workspace?.enabled).toBe(true);
    expect(agent.workspace?.workspaces).toHaveLength(1);
  });

  it('should parse agent without workspace config (backward compatible)', () => {
    const agent = AgentSchema.parse({
      id: 'no-workspace-agent',
      name: 'No Workspace Agent',
      enabled: true,
      systemPrompt: 'You do not have workspace access.',
      model: 'openai/gpt-4o-mini',
    });
    expect(agent.workspace).toBeUndefined();
  });

  it('should parse agent with disabled workspace', () => {
    const agent = AgentSchema.parse({
      id: 'disabled-workspace-agent',
      name: 'Disabled Workspace Agent',
      enabled: true,
      systemPrompt: 'Your workspace is disabled.',
      model: 'openai/gpt-4o-mini',
      workspace: {
        enabled: false,
        workspaces: [],
      },
    });
    expect(agent.workspace?.enabled).toBe(false);
  });
});

describe('getAgentWorkspace', () => {
  it('should return workspace config when enabled', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Test',
      model: 'openai/gpt-4o-mini',
      workspace: {
        enabled: true,
        workspaces: [{ path: '/project' }],
      },
    });
    const workspace = getAgentWorkspace(agent);
    expect(workspace).toBeDefined();
    expect(workspace?.workspaces).toHaveLength(1);
  });

  it('should return undefined when workspace is not configured', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Test',
      model: 'openai/gpt-4o-mini',
    });
    const workspace = getAgentWorkspace(agent);
    expect(workspace).toBeUndefined();
  });

  it('should return undefined when workspace is disabled', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Test',
      model: 'openai/gpt-4o-mini',
      workspace: {
        enabled: false,
        workspaces: [{ path: '/project' }],
      },
    });
    const workspace = getAgentWorkspace(agent);
    expect(workspace).toBeUndefined();
  });
});

describe('AgentSchema builtin tools (tools field)', () => {
  it('parses an agent with builtin workspace tool names', () => {
    const agent = AgentSchema.parse({
      id: 'tool-agent',
      name: 'Tool Agent',
      enabled: true,
      systemPrompt: 'You are a helpful assistant.',
      model: 'openai/gpt-4o',
      tools: [
        'workspace_read',
        'workspace_list',
        'workspace_write',
        'workspace_delete',
      ],
    });
    expect(agent.tools).toEqual([
      'workspace_read',
      'workspace_list',
      'workspace_write',
      'workspace_delete',
    ]);
  });

  it('tools and mcpServers are independent — both can coexist', () => {
    const agent = AgentSchema.parse({
      id: 'full-agent',
      name: 'Full Agent',
      enabled: true,
      systemPrompt: 'You are a helpful assistant.',
      model: 'openai/gpt-4o',
      tools: ['workspace_read', 'workspace_list'],
      mcpServers: [{ id: 'github' }],
    });
    expect(agent.tools).toHaveLength(2);
    expect(agent.mcpServers).toHaveLength(1);
  });

  it('tools defaults to undefined when not provided', () => {
    const agent = AgentSchema.parse({
      id: 'no-tools-agent',
      name: 'No Tools',
      enabled: true,
      systemPrompt: 'You are a helpful assistant.',
      model: 'openai/gpt-4o',
    });
    expect(agent.tools).toBeUndefined();
  });

  it('toAgentSummary includes tools field', () => {
    const agent = AgentSchema.parse({
      id: 'summary-agent',
      name: 'Summary Agent',
      enabled: true,
      systemPrompt: 'You are helpful.',
      model: 'openai/gpt-4o',
      tools: ['workspace_read', 'workspace_write'],
    });
    const summary = toAgentSummary(agent);
    expect(summary.tools).toEqual(['workspace_read', 'workspace_write']);
  });
});
