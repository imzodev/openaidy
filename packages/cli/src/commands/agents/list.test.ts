/**
 * Agents List Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));

import { agentsListHandler } from './list.js';

const OPENAIDY_CONFIG = {
  version: 1,
  agents: [
    {
      id: 'default',
      name: 'Default Assistant',
      description: 'A general-purpose assistant',
      enabled: true,
      model: 'openai/gpt-4o-mini',
      tags: ['general', 'default'],
    },
    {
      id: 'code-assistant',
      name: 'Code Assistant',
      description: 'Specialized in programming',
      enabled: true,
      model: 'openai/gpt-4o',
      tags: ['coding'],
    },
    {
      id: 'disabled-agent',
      name: 'Disabled Agent',
      enabled: false,
      model: 'openai/gpt-4o-mini',
      tags: [],
    },
  ],
};

describe('agents list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await agentsListHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
      expect(result.output).toContain('agents list');
    });

    it('shows help with -h', async () => {
      const result = await agentsListHandler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
    });
  });

  describe('config file unreadable', () => {
    it('shows empty state when config file is missing', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No agents found');
      expect(result.output).toContain('agents create');
    });

    it('shows empty state when config has no agents array', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ version: 1 }));
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No agents found');
    });
  });

  describe('successful list', () => {
    beforeEach(() => {
      mockReadFile.mockResolvedValue(JSON.stringify(OPENAIDY_CONFIG));
    });

    it('shows enabled agents', async () => {
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Default Assistant');
      expect(result.output).toContain('Code Assistant');
    });

    it('shows agent IDs', async () => {
      const result = await agentsListHandler([]);
      expect(result.output).toContain('default');
      expect(result.output).toContain('code-assistant');
    });

    it('shows model for each agent', async () => {
      const result = await agentsListHandler([]);
      expect(result.output).toContain('openai/gpt-4o-mini');
      expect(result.output).toContain('openai/gpt-4o');
    });

    it('shows description when present', async () => {
      const result = await agentsListHandler([]);
      expect(result.output).toContain('A general-purpose assistant');
    });

    it('shows tags when present', async () => {
      const result = await agentsListHandler([]);
      expect(result.output).toContain('general, default');
      expect(result.output).toContain('coding');
    });

    it('shows enabled count in section header', async () => {
      const result = await agentsListHandler([]);
      expect(result.output).toContain('Enabled (2)');
    });

    it('groups disabled agents in their own section', async () => {
      const result = await agentsListHandler([]);
      expect(result.output).toContain('Disabled (1)');
      expect(result.output).toContain('Disabled Agent');
      expect(result.output).toContain('[disabled]');
    });
  });

  describe('agents without optional fields', () => {
    it('handles agents with no description or tags', async () => {
      const config = {
        version: 1,
        agents: [
          {
            id: 'bare',
            name: 'Bare Agent',
            enabled: true,
            model: 'openai/gpt-4o-mini',
          },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Bare Agent');
    });

    it('handles agent with no model set', async () => {
      const config = {
        version: 1,
        agents: [{ id: 'no-model', name: 'No Model Agent', enabled: true }],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No Model Agent');
    });
  });
});
