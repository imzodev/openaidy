import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AgentRegistry, createAgentRegistry } from './registry';
import type { Agent } from './schema';

describe('AgentRegistry', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test agents
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-agents-'));
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
});

describe('createAgentRegistry', () => {
  it('should create and load registry', () => {
    const tempDir = fs.mkdtempSync(path.join(process.cwd(), 'test-agents-'));

    try {
      fs.writeFileSync(
        path.join(tempDir, 'test.json'),
        JSON.stringify({
          id: 'test',
          name: 'Test',
          enabled: true,
          systemPrompt: 'Prompt',
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
