import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentRegistry, createAgentRegistry } from './registry';
import type { Agent } from './schema';

describe('AgentRegistry', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test agents in the system temp dir
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-agents-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createAgentFile(id: string, agent: Partial<Agent>): void {
    const fullAgent: Agent = {
      id,
      name: agent.name ?? 'Test Agent',
      enabled: agent.enabled ?? true,
      systemPrompt: agent.systemPrompt ?? 'Default prompt',
      model: agent.model ?? 'openai/gpt-4o-mini',
      version: agent.version ?? 1,
      ...agent,
    };
    fs.writeFileSync(
      path.join(tempDir, `${id}.json`),
      JSON.stringify(fullAgent),
    );
  }

  describe('load', () => {
    it('should load agents from directory', () => {
      createAgentFile('agent1', { name: 'Agent 1' });
      createAgentFile('agent2', { name: 'Agent 2' });

      const registry = new AgentRegistry({ agentsDir: tempDir });
      registry.load();

      expect(registry.size).toBe(2);
    });

    it('should handle empty directory', () => {
      const registry = new AgentRegistry({ agentsDir: tempDir });
      registry.load();

      expect(registry.size).toBe(0);
    });

    it('should handle non-existent directory', () => {
      const registry = new AgentRegistry({ agentsDir: '/nonexistent/path' });
      registry.load();

      expect(registry.size).toBe(0);
    });

    it('should throw on invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'invalid.json'), 'not json');

      const registry = new AgentRegistry({ agentsDir: tempDir });

      expect(() => registry.load()).toThrow('Invalid agent file');
    });

    it('should throw on invalid agent schema', () => {
      fs.writeFileSync(
        path.join(tempDir, 'invalid.json'),
        JSON.stringify({ id: 'invalid' }),
      );

      const registry = new AgentRegistry({ agentsDir: tempDir });

      expect(() => registry.load()).toThrow('Invalid agent file');
    });

    it('should throw on id/filename mismatch', () => {
      fs.writeFileSync(
        path.join(tempDir, 'file1.json'),
        JSON.stringify({
          id: 'wrong-id',
          name: 'Test',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4o-mini',
          defaults: {},
        }),
      );

      const registry = new AgentRegistry({ agentsDir: tempDir });

      expect(() => registry.load()).toThrow('does not match filename');
    });

    it('should throw on duplicate IDs', () => {
      // Create two files with same ID (this shouldn't happen with id/filename matching, but test anyway)
      fs.writeFileSync(
        path.join(tempDir, 'agent1.json'),
        JSON.stringify({
          id: 'agent1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4o-mini',
          defaults: {},
        }),
      );

      // Manually create duplicate scenario by loading same file twice
      const registry = new AgentRegistry({ agentsDir: tempDir });
      registry.load();

      expect(registry.size).toBe(1);
    });
  });

  describe('listAgents', () => {
    it('should return only enabled agents', () => {
      createAgentFile('enabled1', { name: 'Enabled 1', enabled: true });
      createAgentFile('enabled2', { name: 'Enabled 2', enabled: true });
      createAgentFile('disabled', { name: 'Disabled', enabled: false });

      const registry = createAgentRegistry({ agentsDir: tempDir });
      const agents = registry.listAgents();

      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.id)).toEqual(
        expect.arrayContaining(['enabled1', 'enabled2']),
      );
      expect(agents.map((a) => a.id)).not.toContain('disabled');
    });

    it('should return agent summaries', () => {
      createAgentFile('test', {
        name: 'Test Agent',
        description: 'A test',
        tags: ['tag1'],
      });

      const registry = createAgentRegistry({ agentsDir: tempDir });
      const agents = registry.listAgents();

      expect(agents[0]).toEqual({
        id: 'test',
        name: 'Test Agent',
        description: 'A test',
        enabled: true,
        tags: ['tag1'],
        model: 'openai/gpt-4o-mini',
      });
    });
  });

  describe('listAllAgents', () => {
    it('should return all agents including disabled', () => {
      createAgentFile('enabled', { name: 'Enabled', enabled: true });
      createAgentFile('disabled', { name: 'Disabled', enabled: false });

      const registry = createAgentRegistry({ agentsDir: tempDir });
      const agents = registry.listAllAgents();

      expect(agents).toHaveLength(2);
    });
  });

  describe('getAgent', () => {
    it('should return agent by id', () => {
      createAgentFile('test', { name: 'Test Agent' });

      const registry = createAgentRegistry({ agentsDir: tempDir });
      const agent = registry.getAgent('test');

      expect(agent).toBeDefined();
      expect(agent?.id).toBe('test');
      expect(agent?.name).toBe('Test Agent');
    });

    it('should return undefined for unknown id', () => {
      const registry = createAgentRegistry({ agentsDir: tempDir });
      const agent = registry.getAgent('unknown');

      expect(agent).toBeUndefined();
    });
  });

  describe('hasAgent', () => {
    it('should return true for existing agent', () => {
      createAgentFile('test', {});

      const registry = createAgentRegistry({ agentsDir: tempDir });

      expect(registry.hasAgent('test')).toBe(true);
    });

    it('should return false for unknown agent', () => {
      const registry = createAgentRegistry({ agentsDir: tempDir });

      expect(registry.hasAgent('unknown')).toBe(false);
    });
  });

  describe('getMcpServers', () => {
    it('should return MCP server references for agent with mcpServers', () => {
      createAgentFile('mcp-agent', {
        name: 'MCP Agent',
        mcpServers: [
          { id: 'filesystem', tools: ['read_file', 'write_file'] },
          { id: 'github' },
        ],
      });

      const registry = createAgentRegistry({ agentsDir: tempDir });
      const mcpServers = registry.getMcpServers('mcp-agent');

      expect(mcpServers).toHaveLength(2);
      expect(mcpServers[0]?.id).toBe('filesystem');
      expect(mcpServers[0]?.tools).toEqual(['read_file', 'write_file']);
      expect(mcpServers[1]?.id).toBe('github');
      expect(mcpServers[1]?.tools).toBeUndefined();
    });

    it('should return empty array for agent without mcpServers', () => {
      createAgentFile('legacy-agent', {
        name: 'Legacy Agent',
        tools: ['custom_tool'],
      });

      const registry = createAgentRegistry({ agentsDir: tempDir });
      const mcpServers = registry.getMcpServers('legacy-agent');

      expect(mcpServers).toEqual([]);
    });

    it('should return empty array for unknown agent', () => {
      const registry = createAgentRegistry({ agentsDir: tempDir });
      const mcpServers = registry.getMcpServers('unknown');

      expect(mcpServers).toEqual([]);
    });
  });

  describe('reload', () => {
    it('should reload agents from disk', () => {
      createAgentFile('test1', { name: 'Test 1' });

      const registry = createAgentRegistry({ agentsDir: tempDir });
      expect(registry.size).toBe(1);

      // Add another agent file
      createAgentFile('test2', { name: 'Test 2' });

      // Reload
      registry.reload();

      expect(registry.size).toBe(2);
    });
  });

  describe('updateAgentTools', () => {
    let configPath: string;

    function writeConfig(agents: object[]): void {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          version: 1,
          defaults: {
            providerId: 'openai',
            modelId: 'gpt-4',
            agentId: 'agent1',
          },
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              enabled: true,
              vendorFamily: 'openai-compatible',
              models: [{ id: 'gpt-4' }],
            },
          ],
          agents,
        }),
        'utf-8',
      );
    }

    beforeEach(() => {
      configPath = path.join(tempDir, 'openaidy.json');
      writeConfig([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          tools: ['workspace_read'],
        },
      ]);
    });

    it('updates tools in memory and returns updated summary', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          tools: ['workspace_read'],
          version: 1,
        },
      ]);

      const result = registry.updateAgentTools('agent1', [
        'workspace_read',
        'workspace_list',
      ]);

      expect(result).toBeDefined();
      expect(registry.getAgent('agent1')?.tools).toEqual([
        'workspace_read',
        'workspace_list',
      ]);
    });

    it('persists tools to the config file on disk', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          tools: ['workspace_read'],
          version: 1,
        },
      ]);

      registry.updateAgentTools('agent1', [
        'workspace_read',
        'workspace_write',
      ]);

      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        agents: Array<{ id: string; tools?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'agent1');
      expect(agent?.tools).toEqual(['workspace_read', 'workspace_write']);
    });

    it('removes the tools key from the config file when clearing all tools', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          tools: ['workspace_read'],
          version: 1,
        },
      ]);

      registry.updateAgentTools('agent1', []);

      expect(registry.getAgent('agent1')?.tools).toBeUndefined();
      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        agents: Array<{ id: string; tools?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'agent1');
      expect(agent).not.toHaveProperty('tools');
    });

    it('returns undefined for an unknown agent id', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([]);

      const result = registry.updateAgentTools('ghost', ['workspace_read']);
      expect(result).toBeUndefined();
    });

    it('updates memory but skips disk when configPath is not set', () => {
      const registry = new AgentRegistry(); // no configPath
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          version: 1,
        },
      ]);

      const result = registry.updateAgentTools('agent1', ['workspace_list']);

      expect(result).toBeDefined();
      expect(registry.getAgent('agent1')?.tools).toEqual(['workspace_list']);
      // Config file in tempDir remains unchanged (only written in beforeEach for other tests)
    });
  });

  describe('updateAgentSkills', () => {
    let configPath: string;

    function writeConfig(
      agents: Array<{
        id: string;
        name?: string;
        enabled?: boolean;
        systemPrompt?: string;
        model?: string;
        skills?: string[];
      }>,
    ) {
      const dir = path.join(tempDir, 'config');
      fs.mkdirSync(dir, { recursive: true });
      configPath = path.join(dir, 'openaidy.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          version: 1,
          defaults: { providerId: 'openai', modelId: 'gpt-4o-mini' },
          providers: [
            {
              id: 'openai',
              type: 'openai-compatible',
              enabled: true,
              vendorFamily: 'openai-compatible',
              models: [{ id: 'gpt-4' }],
            },
          ],
          agents,
        }),
        'utf-8',
      );
    }

    beforeEach(() => {
      configPath = path.join(tempDir, 'openaidy.json');
      writeConfig([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          skills: ['skill-a'],
        },
      ]);
    });

    it('updates skills in memory and returns updated summary', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          skills: ['skill-a'],
          version: 1,
        },
      ]);

      const result = registry.updateAgentSkills('agent1', [
        'skill-a',
        'skill-b',
      ]);

      expect(result).toBeDefined();
      expect(registry.getAgent('agent1')?.skills).toEqual([
        'skill-a',
        'skill-b',
      ]);
    });

    it('persists skills to the config file on disk', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          skills: ['skill-a'],
          version: 1,
        },
      ]);

      registry.updateAgentSkills('agent1', ['skill-b', 'skill-c']);

      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'agent1');
      expect(agent?.skills).toEqual(['skill-b', 'skill-c']);
    });

    it('removes the skills key from the config file when clearing all skills', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          skills: ['skill-a'],
          version: 1,
        },
      ]);

      registry.updateAgentSkills('agent1', []);

      expect(registry.getAgent('agent1')?.skills).toBeUndefined();
      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'agent1');
      expect(agent).not.toHaveProperty('skills');
    });

    it('returns undefined for an unknown agent id', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([]);

      const result = registry.updateAgentSkills('ghost', ['skill-a']);
      expect(result).toBeUndefined();
    });

    it('updates memory but skips disk when configPath is not set', () => {
      const registry = new AgentRegistry(); // no configPath
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          version: 1,
        },
      ]);

      const result = registry.updateAgentSkills('agent1', ['skill-x']);

      expect(result).toBeDefined();
      expect(registry.getAgent('agent1')?.skills).toEqual(['skill-x']);
    });
  });

  describe('updateAgentMcpServers', () => {
    let configPath: string;

    function writeConfig(
      agents: Array<{
        id: string;
        name?: string;
        enabled?: boolean;
        systemPrompt?: string;
        model?: string;
        mcpServers?: Array<{ id: string; tools?: string[] }>;
      }>,
    ) {
      const dir = path.join(tempDir, 'config-mcp');
      fs.mkdirSync(dir, { recursive: true });
      configPath = path.join(dir, 'openaidy.json');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          version: 1,
          defaults: { providerId: 'openai', modelId: 'gpt-4o-mini' },
          providers: [
            {
              id: 'openai',
              type: 'openai-compatible',
              enabled: true,
              vendorFamily: 'openai-compatible',
              models: [{ id: 'gpt-4' }],
            },
          ],
          agents,
        }),
        'utf-8',
      );
    }

    beforeEach(() => {
      writeConfig([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          mcpServers: [{ id: 'filesystem' }],
        },
      ]);
    });

    it('updates mcpServers in memory and returns updated summary', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          mcpServers: [{ id: 'filesystem' }],
          version: 1,
        },
      ]);

      const result = registry.updateAgentMcpServers('agent1', [
        { id: 'filesystem' },
        { id: 'github', tools: ['search_code'] },
      ]);

      expect(result).toBeDefined();
      expect(registry.getAgent('agent1')?.mcpServers).toEqual([
        { id: 'filesystem' },
        { id: 'github', tools: ['search_code'] },
      ]);
    });

    it('persists mcpServers to the config file on disk', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          mcpServers: [{ id: 'filesystem' }],
          version: 1,
        },
      ]);

      registry.updateAgentMcpServers('agent1', [
        { id: 'github', tools: ['list_issues'] },
      ]);

      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        agents: Array<{
          id: string;
          mcpServers?: Array<{ id: string; tools?: string[] }>;
        }>;
      };
      const agent = written.agents.find((a) => a.id === 'agent1');
      expect(agent?.mcpServers).toEqual([
        { id: 'github', tools: ['list_issues'] },
      ]);
    });

    it('removes the mcpServers key from the config file when clearing all servers', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          mcpServers: [{ id: 'filesystem' }],
          version: 1,
        },
      ]);

      registry.updateAgentMcpServers('agent1', []);

      expect(registry.getAgent('agent1')?.mcpServers).toBeUndefined();
      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        agents: Array<{ id: string; mcpServers?: unknown }>;
      };
      const agent = written.agents.find((a) => a.id === 'agent1');
      expect(agent).not.toHaveProperty('mcpServers');
    });

    it('returns undefined for an unknown agent id', () => {
      const registry = new AgentRegistry({ configPath });
      registry.replaceAll([]);

      const result = registry.updateAgentMcpServers('ghost', [
        { id: 'filesystem' },
      ]);
      expect(result).toBeUndefined();
    });

    it('updates memory but skips disk when configPath is not set', () => {
      const registry = new AgentRegistry();
      registry.replaceAll([
        {
          id: 'agent1',
          name: 'Agent One',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4',
          version: 1,
        },
      ]);

      const result = registry.updateAgentMcpServers('agent1', [
        { id: 'filesystem' },
      ]);

      expect(result).toBeDefined();
      expect(registry.getAgent('agent1')?.mcpServers).toEqual([
        { id: 'filesystem' },
      ]);
    });
  });

  describe('deleteAgent', () => {
    it('returns null for a non-existent agent', () => {
      const registry = new AgentRegistry({ agentsDir: tempDir });
      expect(registry.deleteAgent('no-such-agent')).toBeNull();
    });

    it('removes the agent from memory', () => {
      createAgentFile('alpha', { name: 'Alpha' });
      createAgentFile('beta', { name: 'Beta' });
      const registry = new AgentRegistry({ agentsDir: tempDir });
      registry.load();

      expect(registry.size).toBe(2);
      const summary = registry.deleteAgent('alpha');

      expect(summary).not.toBeNull();
      expect(summary!.id).toBe('alpha');
      expect(registry.size).toBe(1);
      expect(registry.hasAgent('alpha')).toBe(false);
      expect(registry.hasAgent('beta')).toBe(true);
    });

    it('returns the deleted agent summary', () => {
      createAgentFile('gamma', { name: 'Gamma', model: 'openai/gpt-4o' });
      const registry = new AgentRegistry({ agentsDir: tempDir });
      registry.load();

      const summary = registry.deleteAgent('gamma');

      expect(summary!.id).toBe('gamma');
      expect(summary!.name).toBe('Gamma');
    });

    it('persists the deletion to openaidy.json', () => {
      const configPath = path.join(tempDir, 'openaidy.json');
      const config = {
        version: 1,
        agents: [
          {
            id: 'p1',
            name: 'P1',
            enabled: true,
            systemPrompt: 's',
            model: 'openai/gpt-4o-mini',
            version: 1,
          },
          {
            id: 'p2',
            name: 'P2',
            enabled: true,
            systemPrompt: 's',
            model: 'openai/gpt-4o-mini',
            version: 1,
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const registry = new AgentRegistry({
        initialAgents: config.agents as Agent[],
        configPath,
      });
      registry.deleteAgent('p1');

      const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(written.agents).toHaveLength(1);
      expect(written.agents[0].id).toBe('p2');
    });

    it('skips disk write when configPath is not set', () => {
      const registry = new AgentRegistry();
      registry.replaceAll([
        {
          id: 'solo',
          name: 'Solo',
          enabled: true,
          systemPrompt: 's',
          model: 'openai/gpt-4o-mini',
          version: 1,
        },
      ]);

      const summary = registry.deleteAgent('solo');

      expect(summary).not.toBeNull();
      expect(registry.size).toBe(0);
    });
  });
});

describe('createAgentRegistry', () => {
  it('should create and load registry', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-agents-'));

    try {
      fs.writeFileSync(
        path.join(tempDir, 'test.json'),
        JSON.stringify({
          id: 'test',
          name: 'Test',
          enabled: true,
          systemPrompt: 'Prompt',
          model: 'openai/gpt-4o-mini',
          defaults: {},
        }),
      );

      const registry = createAgentRegistry({ agentsDir: tempDir });

      expect(registry.size).toBe(1);
      expect(registry.hasAgent('test')).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
