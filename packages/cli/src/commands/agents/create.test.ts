/**
 * Agents Create Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFile, mockReaddir, mockWriteFile, mockMkdir, mockClack } =
  vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockReaddir: vi.fn(),
    mockWriteFile: vi.fn(),
    mockMkdir: vi.fn(),
    mockClack: {
      intro: vi.fn(),
      note: vi.fn(),
      outro: vi.fn(),
      cancel: vi.fn(),
      isCancel: vi.fn(() => false),
      text: vi.fn(),
      multiselect: vi.fn(),
      select: vi.fn(),
      spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    },
  }));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  readdir: mockReaddir,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('@clack/prompts', () => mockClack);

import { agentsCreateHandler } from './create.js';

const EXISTING_CONFIG = {
  version: 1,
  agents: [
    {
      id: 'default',
      name: 'Default Assistant',
      enabled: true,
      model: 'openai/gpt-4o-mini',
    },
    {
      id: 'code-assistant',
      name: 'Code Assistant',
      enabled: true,
      model: 'openai/gpt-4o',
    },
  ],
};

const SKILLS_DIR_ENTRIES = [
  'example-skill',
  'step-by-step',
  '.seed-manifest.json',
];

const SKILL_MD = `---
name: Example Skill
description: A test skill
version: 1.0.0
---
Do something useful.
`;

type AgentStub = { id: string; name: string; enabled: boolean; model: string };

/** Set up Clack mock responses for a standard successful run. */
function setupClack({
  description = '',
  systemPrompt = '',
  skills = [] as string[],
  model = null as AgentStub | null,
} = {}) {
  mockClack.isCancel.mockReturnValue(false);
  mockClack.text
    .mockResolvedValueOnce(description) // description prompt
    .mockResolvedValueOnce(systemPrompt); // system prompt
  mockClack.multiselect.mockResolvedValueOnce(skills);
  mockClack.select.mockResolvedValueOnce(model);
  mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
}

describe('agents create', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(SKILLS_DIR_ENTRIES);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(EXISTING_CONFIG)) // ID conflict check
      .mockResolvedValueOnce(SKILL_MD) // example-skill SKILL.md
      .mockResolvedValueOnce(SKILL_MD) // step-by-step SKILL.md
      .mockResolvedValueOnce(JSON.stringify(EXISTING_CONFIG)) // model select
      .mockResolvedValueOnce(JSON.stringify(EXISTING_CONFIG)); // write-back
  });

  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await agentsCreateHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('agents create'),
        expect.any(String),
      );
    });

    it('shows help with -h', async () => {
      const result = await agentsCreateHandler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(mockClack.note).toHaveBeenCalledWith(
        expect.stringContaining('Usage:'),
        expect.any(String),
      );
    });
  });

  describe('argument validation', () => {
    it('returns exit 1 when name prompt returns empty string', async () => {
      mockClack.isCancel.mockReturnValue(false);
      mockClack.text.mockResolvedValueOnce(''); // name prompt returns empty
      const result = await agentsCreateHandler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('name is required');
    });

    it('returns exit 1 when user cancels the name prompt', async () => {
      mockClack.text.mockResolvedValueOnce(Symbol('cancel'));
      mockClack.isCancel.mockReturnValue(true);
      const result = await agentsCreateHandler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Cancelled');
    });

    it('returns exit 1 when ID conflicts with an existing agent', async () => {
      setupClack();
      const result = await agentsCreateHandler(['default']); // slugifies to 'default'
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('already exists');
    });
  });

  describe('successful creation with --name flag', () => {
    beforeEach(() => setupClack());

    it('creates agent and exits 0', async () => {
      const result = await agentsCreateHandler([
        '--name',
        'My New Agent',
        '--no-identity',
      ]);
      expect(result.exitCode).toBe(0);
    });

    it('writes openaidy.json with the new agent appended', async () => {
      await agentsCreateHandler(['--name', 'My New Agent', '--no-identity']);
      expect(mockWriteFile).toHaveBeenCalledOnce();
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string }>;
      };
      const ids = written.agents.map((a) => a.id);
      expect(ids).toContain('my-new-agent');
      expect(ids).toContain('default');
      expect(ids).toContain('code-assistant');
    });

    it('creates workspace directory', async () => {
      await agentsCreateHandler(['--name', 'My New Agent', '--no-identity']);
      const mkdirCalls = mockMkdir.mock.calls.map((c) => c[0] as string);
      expect(mkdirCalls.some((path) => path.includes('my-new-agent'))).toBe(
        true,
      );
    });

    it('uses default model when none selected', async () => {
      await agentsCreateHandler(['--name', 'My New Agent', '--no-identity']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; model: string }>;
      };
      const agent = written.agents.find((a) => a.id === 'my-new-agent')!;
      expect(agent.model).toBe('openai/gpt-4o-mini');
    });

    it('includes workspace property in created agent', async () => {
      await agentsCreateHandler(['--name', 'My New Agent', '--no-identity']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{
          id: string;
          workspace?: { workspaces: Array<{ path: string }> };
        }>;
      };
      const agent = written.agents.find((a) => a.id === 'my-new-agent')!;
      expect(agent.workspace).toBeDefined();
      expect(agent.workspace?.workspaces[0]?.path).toBe('my-new-agent');
    });

    it('calls p.outro with agent ID', async () => {
      await agentsCreateHandler(['--name', 'My New Agent', '--no-identity']);
      const outroArg = mockClack.outro.mock.calls[0]?.[0] as string;
      expect(outroArg).toContain('my-new-agent');
    });
  });

  describe('model copy', () => {
    it('copies model from selected agent', async () => {
      const defaultAgent = EXISTING_CONFIG.agents[0]!;
      setupClack({ model: defaultAgent });
      await agentsCreateHandler(['--name', 'Cloned Agent', '--no-identity']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; model: string }>;
      };
      const agent = written.agents.find((a) => a.id === 'cloned-agent')!;
      expect(agent.model).toBe('openai/gpt-4o-mini');
    });

    it('copies model from Code Assistant', async () => {
      const codeAgent = EXISTING_CONFIG.agents[1]!;
      setupClack({ model: codeAgent });
      await agentsCreateHandler(['--name', 'Cloned Two', '--no-identity']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; model: string }>;
      };
      const agent = written.agents.find((a) => a.id === 'cloned-two')!;
      expect(agent.model).toBe('openai/gpt-4o');
    });
  });

  describe('skills assignment', () => {
    it('assigns selected skills', async () => {
      setupClack({ skills: ['example-skill', 'step-by-step'] });
      await agentsCreateHandler(['--name', 'Skilled Agent', '--no-identity']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'skilled-agent')!;
      expect(agent.skills).toContain('example-skill');
      expect(agent.skills).toContain('step-by-step');
    });

    it('shows skills in p.outro when assigned', async () => {
      setupClack({ skills: ['example-skill', 'step-by-step'] });
      await agentsCreateHandler(['--name', 'Skilled Agent', '--no-identity']);
      const outroArg = mockClack.outro.mock.calls[0]?.[0] as string;
      expect(outroArg).toContain('Skills:');
    });

    it('assigns no skills when empty array returned', async () => {
      setupClack({ skills: [] });
      await agentsCreateHandler(['--name', 'No Skills Agent', '--no-identity']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'no-skills-agent')!;
      expect(agent.skills).toBeUndefined();
    });

    it('assigns only the skills the user selected', async () => {
      setupClack({ skills: ['step-by-step'] });
      await agentsCreateHandler(['--name', 'Selective Agent', '--no-identity']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'selective-agent')!;
      expect(agent.skills).toEqual(['step-by-step']);
    });
  });

  describe('--id and --description flags', () => {
    it('uses --id to override the derived slug', async () => {
      setupClack();
      await agentsCreateHandler([
        '--name',
        'My Agent',
        '--id',
        'custom-id',
        '--no-identity',
      ]);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string }>;
      };
      expect(written.agents.map((a) => a.id)).toContain('custom-id');
    });

    it('uses --description to skip the description prompt', async () => {
      mockClack.isCancel.mockReturnValue(false);
      mockClack.text.mockResolvedValueOnce(''); // only system prompt is asked
      mockClack.multiselect.mockResolvedValueOnce([]);
      mockClack.select.mockResolvedValueOnce(null);
      mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

      await agentsCreateHandler([
        '--name',
        'Desc Agent',
        '--description',
        'My desc',
        '--no-identity',
      ]);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; description: string }>;
      };
      const agent = written.agents.find((a) => a.id === 'desc-agent')!;
      expect(agent.description).toBe('My desc');
    });
  });

  describe('identity prompts', () => {
    it('skips identity prompts entirely with --no-identity', async () => {
      setupClack();
      await agentsCreateHandler([
        '--name',
        'No Identity Agent',
        '--no-identity',
      ]);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; identity?: unknown }>;
      };
      const agent = written.agents.find((a) => a.id === 'no-identity-agent')!;
      expect(agent.identity).toBeUndefined();
      // Only description + system prompt text calls — no emoji prompt.
      expect(mockClack.text).toHaveBeenCalledTimes(2);
    });

    it('persists identity via --emoji and --color flags without prompting', async () => {
      setupClack();
      await agentsCreateHandler([
        '--name',
        'Flag Identity Agent',
        '--emoji',
        '🦊',
        '--color',
        '#7C3AED',
      ]);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{
          id: string;
          identity?: { emoji: string; accentColor: string };
        }>;
      };
      const agent = written.agents.find((a) => a.id === 'flag-identity-agent')!;
      expect(agent.identity).toEqual({ emoji: '🦊', accentColor: '#7C3AED' });
      // Only description + system prompt text calls — no emoji/color prompts.
      expect(mockClack.text).toHaveBeenCalledTimes(2);
      // Only the model select — no accent color select.
      expect(mockClack.select).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid --color hex value', async () => {
      mockClack.isCancel.mockReturnValue(false);
      mockClack.text.mockResolvedValueOnce(''); // description prompt only
      const result = await agentsCreateHandler([
        '--name',
        'Bad Color Agent',
        '--emoji',
        '🦊',
        '--color',
        '#zzz',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Invalid accent color');
    });

    it('rejects a short --color hex code', async () => {
      mockClack.isCancel.mockReturnValue(false);
      mockClack.text.mockResolvedValueOnce(''); // description prompt only
      const result = await agentsCreateHandler([
        '--name',
        'Short Color Agent',
        '--emoji',
        '🦊',
        '--color',
        '#fff',
      ]);
      expect(result.exitCode).toBe(1);
    });

    it('prompts for emoji and accent color when no flags are given', async () => {
      mockClack.isCancel.mockReturnValue(false);
      mockClack.text
        .mockResolvedValueOnce('') // description
        .mockResolvedValueOnce('🐢') // emoji prompt
        .mockResolvedValueOnce(''); // system prompt
      mockClack.select
        .mockResolvedValueOnce('#16A34A') // accent color palette pick
        .mockResolvedValueOnce(null); // model select
      mockClack.multiselect.mockResolvedValueOnce([]);
      mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

      await agentsCreateHandler(['--name', 'Prompted Identity Agent']);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{
          id: string;
          identity?: { emoji: string; accentColor: string };
        }>;
      };
      const agent = written.agents.find(
        (a) => a.id === 'prompted-identity-agent',
      )!;
      expect(agent.identity).toEqual({ emoji: '🐢', accentColor: '#16A34A' });
    });

    it('prompts for a custom hex color when "Custom…" is selected', async () => {
      mockClack.isCancel.mockReturnValue(false);
      mockClack.text
        .mockResolvedValueOnce('') // description
        .mockResolvedValueOnce('🐢') // emoji prompt
        .mockResolvedValueOnce('#123abc') // custom color prompt
        .mockResolvedValueOnce(''); // system prompt
      mockClack.select
        .mockResolvedValueOnce('custom') // accent color palette pick -> custom
        .mockResolvedValueOnce(null); // model select
      mockClack.multiselect.mockResolvedValueOnce([]);
      mockClack.spinner.mockReturnValue({ start: vi.fn(), stop: vi.fn() });

      await agentsCreateHandler(['--name', 'Custom Color Agent']);

      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{
          id: string;
          identity?: { emoji: string; accentColor: string };
        }>;
      };
      const agent = written.agents.find((a) => a.id === 'custom-color-agent')!;
      expect(agent.identity).toEqual({ emoji: '🐢', accentColor: '#123abc' });
    });
  });
});
