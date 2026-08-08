/**
 * Agents List Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile, mockClack } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockClack: {
    intro: vi.fn(),
    note: vi.fn(),
    log: { error: vi.fn() },
  },
}));

vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));
vi.mock('@clack/prompts', () => mockClack);

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

  function noteOutput(): string {
    return mockClack.note.mock.calls.map((c: unknown[]) => c[0]).join('\n');
  }

  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await agentsListHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('agents list'),
        expect.any(String),
      );
    });

    it('shows help with -h', async () => {
      const result = await agentsListHandler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
    });
  });

  describe('config file unreadable', () => {
    it('shows empty state when config file is missing', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('No agents found');
      expect(noteOutput()).toContain('agents create');
    });

    it('shows empty state when config has no agents array', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ version: 1 }));
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('No agents found');
    });
  });

  describe('successful list', () => {
    beforeEach(() => {
      mockReadFile.mockResolvedValue(JSON.stringify(OPENAIDY_CONFIG));
    });

    it('shows enabled agents', async () => {
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('Default Assistant');
      expect(noteOutput()).toContain('Code Assistant');
    });

    it('shows agent IDs', async () => {
      await agentsListHandler([]);
      expect(noteOutput()).toContain('default');
      expect(noteOutput()).toContain('code-assistant');
    });

    it('shows model for each agent', async () => {
      await agentsListHandler([]);
      expect(noteOutput()).toContain('openai/gpt-4o-mini');
      expect(noteOutput()).toContain('openai/gpt-4o');
    });

    it('shows description when present', async () => {
      await agentsListHandler([]);
      expect(noteOutput()).toContain('A general-purpose assistant');
    });

    it('shows tags when present', async () => {
      await agentsListHandler([]);
      expect(noteOutput()).toContain('general, default');
      expect(noteOutput()).toContain('coding');
    });

    it('shows all enabled agents in output', async () => {
      await agentsListHandler([]);
      expect(noteOutput()).toContain('Default Assistant');
      expect(noteOutput()).toContain('Code Assistant');
    });

    it('shows disabled agents with [disabled] marker', async () => {
      await agentsListHandler([]);
      expect(noteOutput()).toContain('Disabled Agent');
      expect(noteOutput()).toContain('[disabled]');
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
      expect(noteOutput()).toContain('Bare Agent');
    });

    it('handles agent with no model set', async () => {
      const config = {
        version: 1,
        agents: [{ id: 'no-model', name: 'No Model Agent', enabled: true }],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));
      const result = await agentsListHandler([]);
      expect(result.exitCode).toBe(0);
      expect(noteOutput()).toContain('No Model Agent');
    });
  });

  describe('identity rendering', () => {
    it('prepends the emoji when identity is present', async () => {
      const config = {
        version: 1,
        agents: [
          {
            id: 'fox-agent',
            name: 'Fox Agent',
            enabled: true,
            model: 'openai/gpt-4o-mini',
            identity: { emoji: '🦊', accentColor: '#7C3AED' },
          },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));
      await agentsListHandler([]);
      expect(noteOutput()).toContain('🦊  Fox Agent');
    });

    it('renders an ANSI truecolor swatch for the accent color', async () => {
      const config = {
        version: 1,
        agents: [
          {
            id: 'fox-agent',
            name: 'Fox Agent',
            enabled: true,
            model: 'openai/gpt-4o-mini',
            identity: { emoji: '🦊', accentColor: '#7C3AED' },
          },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));
      await agentsListHandler([]);
      // #7C3AED -> r=124 g=58 b=237
      expect(noteOutput()).toContain('\x1b[48;2;124;58;237m');
      expect(noteOutput()).toContain('\x1b[0m');
    });

    it('shows no emoji prefix or swatch when identity is absent', async () => {
      const config = {
        version: 1,
        agents: [
          {
            id: 'plain-agent',
            name: 'Plain Agent',
            enabled: true,
            model: 'openai/gpt-4o-mini',
          },
        ],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(config));
      await agentsListHandler([]);
      expect(noteOutput()).not.toContain('\x1b[48;2;');
      const firstLine = noteOutput().split('\n')[0];
      expect(firstLine).toBe('Plain Agent');
    });
  });
});
