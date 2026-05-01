import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSkillRegistry } from '../../skills/index';
import { createSkillCreateTool, createSkillTools } from './index';

const CTX = { agentId: 'test-agent' };

describe('skill tools', () => {
  let skillsDir: string;
  let registry: ReturnType<typeof createSkillRegistry>;

  beforeEach(async () => {
    skillsDir = join(tmpdir(), `skill-tools-test-${Date.now()}`);
    await mkdir(skillsDir, { recursive: true });
    registry = createSkillRegistry({ skillsDir });
    registry.load();
  });

  afterEach(async () => {
    await rm(skillsDir, { recursive: true, force: true });
  });

  // ─── createSkillTools factory ──────────────────────────────────────────────

  describe('createSkillTools', () => {
    it('returns skill_create tool', () => {
      const tools = createSkillTools(registry, skillsDir);
      expect(tools.map((t) => t.name)).toContain('skill_create');
      expect(tools).toHaveLength(1);
    });
  });

  // ─── skill_create ──────────────────────────────────────────────────────────

  describe('skill_create', () => {
    it('creates a valid skill and writes SKILL.md to disk', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        {
          id: 'my-skill',
          name: 'My Skill',
          description: 'Does something useful',
          body: 'Always be concise and direct.',
        },
        CTX,
      );

      expect(result.ok).toBe(true);

      const fileContent = await readFile(
        join(skillsDir, 'my-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain('name: My Skill');
      expect(fileContent).toContain('description: Does something useful');
      expect(fileContent).toContain('version: 1.0.0');
      expect(fileContent).toContain('Always be concise and direct.');
    });

    it('registers the skill in the registry immediately', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      await tool.execute(
        {
          id: 'instant-skill',
          name: 'Instant Skill',
          description: 'Available right away',
          body: 'Think step by step.',
        },
        CTX,
      );

      const skill = registry.getSkill('instant-skill');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('Instant Skill');
      expect(skill?.body).toBe('Think step by step.');
    });

    it('uses the provided version in the file', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      await tool.execute(
        {
          id: 'versioned-skill',
          name: 'Versioned Skill',
          description: 'Has a custom version',
          version: '2.3.0',
          body: 'Do the thing.',
        },
        CTX,
      );

      const fileContent = await readFile(
        join(skillsDir, 'versioned-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain('version: 2.3.0');
    });

    it('defaults version to 1.0.0 when omitted', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      await tool.execute(
        {
          id: 'no-version-skill',
          name: 'No Version Skill',
          description: 'Version should default',
          body: 'Some instructions.',
        },
        CTX,
      );

      const fileContent = await readFile(
        join(skillsDir, 'no-version-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain('version: 1.0.0');
    });

    it('records created_by with the agent id', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      await tool.execute(
        {
          id: 'attributed-skill',
          name: 'Attributed Skill',
          description: 'Tracks authorship',
          body: 'Instructions.',
        },
        CTX,
      );

      const fileContent = await readFile(
        join(skillsDir, 'attributed-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain(`created_by: ${CTX.agentId}`);
    });

    it('returns error when id already exists', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const args = {
        id: 'duplicate-skill',
        name: 'Duplicate',
        description: 'First',
        body: 'Body.',
      };
      await tool.execute(args, CTX);
      const second = await tool.execute(args, CTX);

      expect(second.ok).toBe(false);
      expect((second as { ok: false; error: string }).error).toMatch(
        /already exists/,
      );
    });

    it('returns error for invalid id format', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        {
          id: 'Invalid ID!',
          name: 'Bad ID',
          description: 'Will fail',
          body: 'Body.',
        },
        CTX,
      );

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /lowercase/,
      );
    });

    it('returns error when id is missing', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        { name: 'No ID', description: 'Missing id', body: 'Body.' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    it('returns error when name is missing', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        { id: 'no-name', description: 'No name', body: 'Body.' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    it('returns error when description is missing', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        { id: 'no-desc', name: 'No Desc', body: 'Body.' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    it('returns error when body is missing', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        { id: 'no-body', name: 'No Body', description: 'Missing body' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    // ─── companion files ─────────────────────────────────────────────────────

    it('writes companion files alongside SKILL.md', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        {
          id: 'api-skill',
          name: 'API Skill',
          description: 'Connects to an API',
          body: 'Use script.py to connect. See .env.example for required vars.',
          files: {
            'script.py': 'import requests\nprint("hello")',
            '.env.example': 'API_KEY=your-key-here',
          },
        },
        CTX,
      );

      expect(result.ok).toBe(true);
      expect((result as { ok: true; content: string }).content).toContain(
        'script.py',
      );

      const script = await readFile(
        join(skillsDir, 'api-skill', 'script.py'),
        'utf-8',
      );
      expect(script).toContain('import requests');

      const envExample = await readFile(
        join(skillsDir, 'api-skill', '.env.example'),
        'utf-8',
      );
      expect(envExample).toContain('API_KEY');
    });

    it('succeeds with no companion files', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        {
          id: 'plain-skill',
          name: 'Plain Skill',
          description: 'No extras',
          body: 'Just instructions.',
          files: {},
        },
        CTX,
      );
      expect(result.ok).toBe(true);
    });

    it('returns error for companion filename with path separator', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        {
          id: 'traversal-skill',
          name: 'Traversal',
          description: 'Path traversal attempt',
          body: 'Body.',
          files: { '../evil.sh': 'rm -rf /' },
        },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /path separator/,
      );
    });

    it('returns error when trying to pass SKILL.md as companion file', async () => {
      const tool = createSkillCreateTool(registry, skillsDir);
      const result = await tool.execute(
        {
          id: 'override-skill',
          name: 'Override',
          description: 'Tries to override SKILL.md',
          body: 'Body.',
          files: { 'SKILL.md': '---\nname: Evil\n---\nbad' },
        },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /body parameter/,
      );
    });
  });
});
