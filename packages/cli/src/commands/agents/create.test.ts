/**
 * Agents Create Command Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReadFile,
  mockReaddir,
  mockWriteFile,
  mockMkdir,
  mockQuestion,
  mockClose,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockReaddir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockQuestion: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  readdir: mockReaddir,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}));

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

describe('agents create', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(SKILLS_DIR_ENTRIES);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify(EXISTING_CONFIG)) // readAgentConfigs (ID conflict check)
      .mockResolvedValueOnce(SKILL_MD) // example-skill SKILL.md
      .mockResolvedValueOnce(SKILL_MD) // step-by-step SKILL.md
      .mockResolvedValueOnce(JSON.stringify(EXISTING_CONFIG)) // readAgentConfigs (model prompt)
      .mockResolvedValueOnce(JSON.stringify(EXISTING_CONFIG)); // readFile for writing back
  });

  describe('--help', () => {
    it('shows help with --help', async () => {
      const result = await agentsCreateHandler(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
      expect(result.output).toContain('agents create');
    });

    it('shows help with -h', async () => {
      const result = await agentsCreateHandler(['-h']);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Usage:');
    });
  });

  describe('argument validation', () => {
    it('returns exit 1 when name prompt is left blank', async () => {
      mockQuestion.mockResolvedValueOnce(''); // empty name
      const result = await agentsCreateHandler([]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('name is required');
    });

    it('returns exit 1 when ID conflicts with an existing agent', async () => {
      // Name that slugifies to 'default'
      mockQuestion
        .mockResolvedValueOnce('') // name prompt (not used — we pass via arg)
        .mockResolvedValueOnce('') // description
        .mockResolvedValueOnce('') // system prompt
        .mockResolvedValueOnce('0')
        .mockResolvedValueOnce('0');
      const result = await agentsCreateHandler(['default']);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('already exists');
    });
  });

  describe('successful creation with --name flag', () => {
    beforeEach(() => {
      mockQuestion
        .mockResolvedValueOnce('') // description
        .mockResolvedValueOnce('') // system prompt
        .mockResolvedValueOnce('0') // skills → none
        .mockResolvedValueOnce('0'); // model → no copy
    });

    it('creates agent and exits 0', async () => {
      const result = await agentsCreateHandler(['--name', 'My New Agent']);
      expect(result.exitCode).toBe(0);
    });

    it('shows created agent ID in output', async () => {
      const result = await agentsCreateHandler(['--name', 'My New Agent']);
      expect(result.output).toContain('my-new-agent');
    });

    it('shows config path in output', async () => {
      const result = await agentsCreateHandler(['--name', 'My New Agent']);
      expect(result.output).toContain('openaidy.json');
    });

    it('shows workspace path in output', async () => {
      const result = await agentsCreateHandler(['--name', 'My New Agent']);
      expect(result.output).toContain('workspaces');
      expect(result.output).toContain('my-new-agent');
    });

    it('writes openaidy.json with the new agent appended', async () => {
      await agentsCreateHandler(['--name', 'My New Agent']);
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
      await agentsCreateHandler(['--name', 'My New Agent']);
      const mkdirCalls = mockMkdir.mock.calls.map((c) => c[0] as string);
      expect(mkdirCalls.some((p) => p.includes('my-new-agent'))).toBe(true);
    });

    it('uses default model when no copy selected', async () => {
      await agentsCreateHandler(['--name', 'My New Agent']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; model: string }>;
      };
      const agent = written.agents.find((a) => a.id === 'my-new-agent')!;
      expect(agent.model).toBe('openai/gpt-4o-mini');
    });

    it('includes workspace property in created agent', async () => {
      await agentsCreateHandler(['--name', 'My New Agent']);
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
  });

  describe('model copy', () => {
    it('copies model from selected agent', async () => {
      mockQuestion
        .mockResolvedValueOnce('') // description
        .mockResolvedValueOnce('') // system prompt
        .mockResolvedValueOnce('0') // skills → none
        .mockResolvedValueOnce('1'); // copy model from agent #1 (Default Assistant)

      await agentsCreateHandler(['--name', 'Cloned Agent']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; model: string }>;
      };
      const agent = written.agents.find((a) => a.id === 'cloned-agent')!;
      expect(agent.model).toBe('openai/gpt-4o-mini');
    });

    it('shows copied model in output', async () => {
      mockQuestion
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('0')
        .mockResolvedValueOnce('2'); // Code Assistant → openai/gpt-4o

      const result = await agentsCreateHandler(['--name', 'Cloned Two']);
      expect(result.output).toContain('openai/gpt-4o');
    });
  });

  describe('skills assignment', () => {
    it('assigns all skills when option 1 selected', async () => {
      mockQuestion
        .mockResolvedValueOnce('') // description
        .mockResolvedValueOnce('') // system prompt
        .mockResolvedValueOnce('1') // skills → All
        .mockResolvedValueOnce('0'); // model → no copy

      await agentsCreateHandler(['--name', 'Skilled Agent']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'skilled-agent')!;
      expect(agent.skills).toContain('example-skill');
      expect(agent.skills).toContain('step-by-step');
    });

    it('shows skills in output when assigned', async () => {
      mockQuestion
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('1')
        .mockResolvedValueOnce('0');

      const result = await agentsCreateHandler(['--name', 'Skilled Agent']);
      expect(result.output).toContain('Skills:');
    });

    it('assigns no skills when option 0 selected', async () => {
      mockQuestion
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('0') // skills → none
        .mockResolvedValueOnce('0'); // model → no copy

      await agentsCreateHandler(['--name', 'No Skills Agent']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'no-skills-agent')!;
      expect(agent.skills).toBeUndefined();
    });

    it('assigns selected skills when specific numbers entered', async () => {
      mockQuestion
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('2') // skill #2 = example-skill (index 0 in array)
        .mockResolvedValueOnce('0');

      await agentsCreateHandler(['--name', 'Selective Agent']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find((a) => a.id === 'selective-agent')!;
      expect(agent.skills).toEqual(['example-skill']);
    });

    it('defaults to All when blank input given', async () => {
      mockQuestion
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('') // blank → defaults to '1' (All)
        .mockResolvedValueOnce('0');

      await agentsCreateHandler(['--name', 'Default Skills Agent']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; skills?: string[] }>;
      };
      const agent = written.agents.find(
        (a) => a.id === 'default-skills-agent',
      )!;
      expect(agent.skills?.length).toBeGreaterThan(0);
    });
  });

  describe('--id and --description flags', () => {
    it('uses --id to override the derived slug', async () => {
      mockQuestion
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('0')
        .mockResolvedValueOnce('0');

      await agentsCreateHandler(['--name', 'My Agent', '--id', 'custom-id']);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string }>;
      };
      expect(written.agents.map((a) => a.id)).toContain('custom-id');
    });

    it('uses --description to skip description prompt', async () => {
      mockQuestion
        .mockResolvedValueOnce('') // system prompt
        .mockResolvedValueOnce('0') // skills
        .mockResolvedValueOnce('0'); // model

      await agentsCreateHandler([
        '--name',
        'Desc Agent',
        '--description',
        'My desc',
      ]);
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as {
        agents: Array<{ id: string; description: string }>;
      };
      const agent = written.agents.find((a) => a.id === 'desc-agent')!;
      expect(agent.description).toBe('My desc');
    });
  });
});
