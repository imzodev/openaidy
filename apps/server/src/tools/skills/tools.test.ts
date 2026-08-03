import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillRegistry, parseSkillMd } from '../../skills/index';
import { WorkspaceService } from '../../workspace/service';
import { AgentRegistry } from '../../agents/registry';
import {
  createSkillCreateTool,
  createSkillTools,
  createSkillUpdateTool,
} from './index';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

describe('skill tools', () => {
  let baseDir: string;
  let workspace: WorkspaceService;
  let agentSkillsDir: string;
  let registry: ReturnType<typeof createSkillRegistry>;
  let agentRegistry: AgentRegistry;

  beforeEach(async () => {
    baseDir = join(tmpdir(), `skill-tools-test-${Date.now()}`);
    await mkdir(baseDir, { recursive: true });
    workspace = new WorkspaceService({ baseDir });
    agentSkillsDir = join(baseDir, CTX.agentId, 'skills');
    registry = createSkillRegistry({ skillsDir: agentSkillsDir });
    registry.load();
    // Provide an in-memory agent registry that already contains the
    // agentId from CTX. This is what `createSkillCreateTool` targets for
    // auto-activation; without this entry addSkillToAgent would throw
    // "Agent with ID ... not found" and the new auto-activation path
    // would always degrade to a warning.
    agentRegistry = new AgentRegistry({
      initialAgents: [
        {
          id: CTX.agentId,
          name: 'Test Agent',
          enabled: true,
          systemPrompt: 'You are a test agent.',
          model: 'openai/gpt-4o-mini',
          version: 1,
        },
      ],
    });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  // ─── createSkillTools factory ──────────────────────────────────────────────

  describe('createSkillTools', () => {
    it('returns skill_create and skill_update tools', () => {
      const tools = createSkillTools(registry, agentRegistry, workspace);
      const names = tools.map((t) => t.name);
      expect(names).toContain('skill_create');
      expect(names).toContain('skill_update');
      expect(tools).toHaveLength(2);
    });
  });

  // ─── skill_create ──────────────────────────────────────────────────────────

  describe('skill_create', () => {
    it('creates a valid skill and writes SKILL.md to disk', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
        join(agentSkillsDir, 'my-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain('name: My Skill');
      expect(fileContent).toContain('description: Does something useful');
      expect(fileContent).toContain('version: 1.0.0');
      expect(fileContent).toContain('Always be concise and direct.');
    });

    it('registers the skill in the registry immediately', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
        join(agentSkillsDir, 'versioned-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain('version: 2.3.0');
    });

    it('defaults version to 1.0.0 when omitted', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
        join(agentSkillsDir, 'no-version-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain('version: 1.0.0');
    });

    it('records created_by with the agent id', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
        join(agentSkillsDir, 'attributed-skill', 'SKILL.md'),
        'utf-8',
      );
      expect(fileContent).toContain(`created_by: ${CTX.agentId}`);
    });

    it('produces a SKILL.md that round-trips through parseSkillMd', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
      const result = await tool.execute(
        {
          id: 'roundtrip-skill',
          name: 'Roundtrip Skill',
          description: 'Survives parsing',
          body: 'Always emit frontmatter so the registry can load this file.',
        },
        CTX,
      );
      expect(result.ok).toBe(true);

      const fileContent = await readFile(
        join(agentSkillsDir, 'roundtrip-skill', 'SKILL.md'),
        'utf-8',
      );
      const parsed = parseSkillMd(fileContent, 'roundtrip-skill', 'test');
      expect('errors' in parsed).toBe(false);
      if (!('errors' in parsed)) {
        expect(parsed.name).toBe('Roundtrip Skill');
        expect(parsed.description).toBe('Survives parsing');
        expect(parsed.body).toBe(
          'Always emit frontmatter so the registry can load this file.',
        );
        expect(parsed.version).toBe('1.0.0');
      }
    });

    it('returns error when id already exists', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
      const result = await tool.execute(
        { name: 'No ID', description: 'Missing id', body: 'Body.' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    it('returns error when name is missing', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
      const result = await tool.execute(
        { id: 'no-name', description: 'No name', body: 'Body.' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    it('returns error when description is missing', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
      const result = await tool.execute(
        { id: 'no-desc', name: 'No Desc', body: 'Body.' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    it('returns error when body is missing', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
      const result = await tool.execute(
        { id: 'no-body', name: 'No Body', description: 'Missing body' },
        CTX,
      );
      expect(result.ok).toBe(false);
    });

    // ─── companion files ─────────────────────────────────────────────────────

    it('writes companion files alongside SKILL.md', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
        join(agentSkillsDir, 'api-skill', 'script.py'),
        'utf-8',
      );
      expect(script).toContain('import requests');

      const envExample = await readFile(
        join(agentSkillsDir, 'api-skill', '.env.example'),
        'utf-8',
      );
      expect(envExample).toContain('API_KEY');
    });

    it('succeeds with no companion files', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
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

    // ─── auto-activation on the creating agent ──────────────────────────

    it('auto-activates the skill on ctx.agentId after creation', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);

      // Sanity check: the agent's skills list is empty before the call.
      const agentBefore = agentRegistry.getAgent(CTX.agentId);
      expect(agentBefore?.skills ?? []).toEqual([]);

      const result = (await tool.execute(
        {
          id: 'auto-activated-skill',
          name: 'Auto Activated',
          description: 'Should land on the agent automatically',
          body: 'Body.',
        },
        CTX,
      )) as { ok: true; content: string; warning?: string };

      // Tool reports success (no warning) — the auto-activation succeeded.
      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
      expect(result.content).toContain('auto-activated-skill');
      expect(result.content).toContain('activated for agent');
      expect(result.content).toContain(CTX.agentId);

      // The created skill ID now appears in the agent's skills array.
      const agentAfter = agentRegistry.getAgent(CTX.agentId);
      expect(agentAfter?.skills).toContain('auto-activated-skill');
    });

    it('idempotent re-creation errors with "already exists" and does not mutate the agent', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
      const args = {
        id: 'recreate-skill',
        name: 'Recreate',
        description: 'First time succeeds; second time must error',
        body: 'Body.',
      };

      // First call: succeeds and auto-activates the skill on the agent.
      const first = await tool.execute(args, CTX);
      expect(first.ok).toBe(true);
      expect(agentRegistry.getAgent(CTX.agentId)?.skills).toEqual([
        'recreate-skill',
      ]);

      // Second call: must error with the exact "already exists" message and
      // must not have invoked addSkillToAgent (so the agent's skills array
      // is unchanged — still the single-element list from the first call).
      const second = await tool.execute(args, CTX);
      expect(second.ok).toBe(false);
      expect((second as { ok: false; error: string }).error).toBe(
        `Skill "recreate-skill" already exists`,
      );
      expect(agentRegistry.getAgent(CTX.agentId)?.skills).toEqual([
        'recreate-skill',
      ]);
    });

    it('returns ok:true with a warning when addSkillToAgent throws — and the skill is still registered', async () => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);

      // Simulate a transient failure in the agent registry: this is the
      // "partial success" scenario. The skill registration has already
      // succeeded in skillRegistry; the auto-activation step then fails.
      const spy = vi
        .spyOn(agentRegistry, 'addSkillToAgent')
        .mockImplementation(() => {
          throw new Error('disk full');
        });

      try {
        const result = (await tool.execute(
          {
            id: 'partial-success-skill',
            name: 'Partial Success',
            description:
              'Registration must survive even when auto-activation fails',
            body: 'Body.',
          },
          CTX,
        )) as { ok: true; content: string; warning: string };

        // The tool degrades gracefully: ok:true so the caller proceeds,
        // but a `warning` field surfaces the auto-activation failure.
        expect(result.ok).toBe(true);
        expect(result.content).toContain('partial-success-skill');
        expect(result.warning).toBeDefined();
        expect(result.warning).toMatch(/failed to auto-activate/);
        expect(result.warning).toContain(CTX.agentId);
        expect(result.warning).toContain('disk full');
        // The warning must point the caller at a recovery path.
        expect(result.warning).toMatch(/agent_update/);

        // The skill IS still registered (registration precedes auto-activation).
        const registered = registry.getSkill('partial-success-skill');
        expect(registered).toBeDefined();
        expect(registered?.name).toBe('Partial Success');
        expect(registered?.description).toBe(
          'Registration must survive even when auto-activation fails',
        );
      } finally {
        spy.mockRestore();
      }

      // After restoring the spy, a fresh call to the tool with a different
      // id succeeds end-to-end — confirming the mock did not corrupt
      // registry state.
      const recovered = (await tool.execute(
        {
          id: 'recovery-skill',
          name: 'Recovery',
          description: 'Succeeds once the registry is healthy again',
          body: 'Body.',
        },
        CTX,
      )) as { ok: true; content: string; warning?: string };
      expect(recovered.ok).toBe(true);
      expect(recovered.warning).toBeUndefined();
      expect(agentRegistry.getAgent(CTX.agentId)?.skills).toContain(
        'recovery-skill',
      );
    });
  });

  // ─── skill_update ──────────────────────────────────────────────────────────

  describe('skill_update', () => {
    // Helper: seed a skill via skill_create so each update test starts from a
    // known-good SKILL.md + companion file layout.
    const seed = async (
      id: string,
      body = 'Original instructions.',
      files: Record<string, string> = {},
    ): Promise<void> => {
      const tool = createSkillCreateTool(registry, agentRegistry, workspace);
      const result = await tool.execute(
        {
          id,
          name: id,
          description: 'Seed skill',
          body,
          files,
        },
        CTX,
      );
      expect(result.ok).toBe(true);
    };

    it('updates only the body and leaves other frontmatter fields unchanged', async () => {
      await seed('body-only');
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        { id: 'body-only', body: 'New and improved instructions.' },
        CTX,
      );
      expect(result.ok).toBe(true);

      const file = await readFile(
        join(agentSkillsDir, 'body-only', 'SKILL.md'),
        'utf-8',
      );
      expect(file).toContain('name: body-only');
      expect(file).toContain('description: Seed skill');
      expect(file).toContain('New and improved instructions.');
      expect(file).not.toContain('Original instructions.');
    });

    it('updates name, description, and version', async () => {
      await seed('full-update');
      const tool = createSkillUpdateTool(registry, workspace);
      await tool.execute(
        {
          id: 'full-update',
          name: 'Renamed',
          description: 'New desc',
          version: '2.0.0',
        },
        CTX,
      );

      const file = await readFile(
        join(agentSkillsDir, 'full-update', 'SKILL.md'),
        'utf-8',
      );
      expect(file).toContain('name: Renamed');
      expect(file).toContain('description: New desc');
      expect(file).toContain('version: 2.0.0');
    });

    it('preserves created_by and stamps updated_by + updated_at', async () => {
      await seed('authored');
      const tool = createSkillUpdateTool(registry, workspace);
      await tool.execute({ id: 'authored', body: 'Refreshed body.' }, CTX);

      const file = await readFile(
        join(agentSkillsDir, 'authored', 'SKILL.md'),
        'utf-8',
      );
      expect(file).toContain(`created_by: ${CTX.agentId}`);
      expect(file).toContain(`updated_by: ${CTX.agentId}`);
      expect(file).toMatch(/updated_at: \d{4}-\d{2}-\d{2}T/);
    });

    it('preserves frontmatter fields it does not model on a body-only update', async () => {
      await seed('rich-frontmatter');
      // Rewrite the seeded file with metadata the parser knows nothing about,
      // including a multi-line list value.
      const filePath = join(agentSkillsDir, 'rich-frontmatter', 'SKILL.md');
      await writeFile(
        filePath,
        [
          '---',
          'name: rich-frontmatter',
          'description: Seed skill',
          'version: 1.2.3',
          'license: MIT',
          'allowed-tools:',
          '  - code_read',
          '  - code_grep',
          'created_by: someone-else',
          '---',
          '',
          'Original instructions.',
          '',
        ].join('\n'),
        'utf-8',
      );

      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        { id: 'rich-frontmatter', body: 'New body.' },
        CTX,
      );
      expect(result.ok).toBe(true);

      const file = await readFile(filePath, 'utf-8');
      expect(file).toContain('license: MIT');
      expect(file).toContain('allowed-tools:');
      expect(file).toContain('  - code_read');
      expect(file).toContain('  - code_grep');
      expect(file).toContain('created_by: someone-else');
      expect(file).toContain('version: 1.2.3');
      expect(file).toContain('New body.');
    });

    it('keeps the existing version when the supplied version is not a usable string', async () => {
      await seed('bad-version');
      const filePath = join(agentSkillsDir, 'bad-version', 'SKILL.md');
      const tool = createSkillUpdateTool(registry, workspace);

      // Empty string alongside another field: must not blank out the version.
      await tool.execute(
        { id: 'bad-version', body: 'Body A.', version: '' },
        CTX,
      );
      let file = await readFile(filePath, 'utf-8');
      expect(file).toContain('version: 1.0.0');
      expect(file).not.toMatch(/version:\s*$/m);

      // Non-string value: same rule.
      await tool.execute(
        { id: 'bad-version', body: 'Body B.', version: 2 as unknown as string },
        CTX,
      );
      file = await readFile(filePath, 'utf-8');
      expect(file).toContain('version: 1.0.0');
      expect(file).not.toContain('version: 2');
    });

    it('rolls back SKILL.md and leaves the registry alone when a companion write fails', async () => {
      await seed('rollback', 'Original instructions.', { 'keep.sh': 'keep' });
      const skillDir = join(agentSkillsDir, 'rollback');
      const filePath = join(skillDir, 'SKILL.md');
      const before = await readFile(filePath, 'utf-8');

      // A directory where a companion file is meant to go: writeFile fails
      // after SKILL.md has already been written, which is exactly the
      // partial-update window the rollback exists to close.
      await mkdir(join(skillDir, 'blocked.txt'), { recursive: true });

      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        {
          id: 'rollback',
          body: 'Should not survive.',
          files: { 'blocked.txt': 'nope' },
          deleteFiles: ['keep.sh'],
        },
        CTX,
      );

      expect(result.ok).toBe(false);
      // SKILL.md restored byte for byte…
      expect(await readFile(filePath, 'utf-8')).toBe(before);
      // …the delete undone…
      expect(await readFile(join(skillDir, 'keep.sh'), 'utf-8')).toBe('keep');
      // …and the registry never advanced to the failed content.
      expect(registry.getSkill('rollback')?.body).toBe(
        'Original instructions.',
      );
    });

    it('re-registers the skill in the registry with new content', async () => {
      await seed('hot-reload');
      const tool = createSkillUpdateTool(registry, workspace);
      await tool.execute(
        { id: 'hot-reload', body: 'Updated at runtime.' },
        CTX,
      );

      const skill = registry.getSkill('hot-reload');
      expect(skill?.body).toBe('Updated at runtime.');
    });

    it('merges new companion files without touching existing ones', async () => {
      await seed('merge-files', 'Body.', {
        'keep.sh': 'echo keep',
        'overwrite.sh': 'echo old',
      });

      const tool = createSkillUpdateTool(registry, workspace);
      await tool.execute(
        {
          id: 'merge-files',
          files: {
            'overwrite.sh': 'echo new',
            'added.sh': 'echo added',
          },
        },
        CTX,
      );

      const keep = await readFile(
        join(agentSkillsDir, 'merge-files', 'keep.sh'),
        'utf-8',
      );
      const overwritten = await readFile(
        join(agentSkillsDir, 'merge-files', 'overwrite.sh'),
        'utf-8',
      );
      const added = await readFile(
        join(agentSkillsDir, 'merge-files', 'added.sh'),
        'utf-8',
      );
      expect(keep).toBe('echo keep');
      expect(overwritten).toBe('echo new');
      expect(added).toBe('echo added');
    });

    it('deletes companion files listed in deleteFiles', async () => {
      await seed('with-files', 'Body.', {
        'a.sh': 'A',
        'b.sh': 'B',
        'c.sh': 'C',
      });

      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        { id: 'with-files', deleteFiles: ['a.sh', 'c.sh'] },
        CTX,
      );
      expect(result.ok).toBe(true);

      const dirListing = await readFile(
        join(agentSkillsDir, 'with-files', 'b.sh'),
        'utf-8',
      );
      expect(dirListing).toBe('B');
      await expect(
        readFile(join(agentSkillsDir, 'with-files', 'a.sh'), 'utf-8'),
      ).rejects.toThrow();
      await expect(
        readFile(join(agentSkillsDir, 'with-files', 'c.sh'), 'utf-8'),
      ).rejects.toThrow();
    });

    it('tolerates deleteFiles entries that do not exist', async () => {
      await seed('safe-delete', 'Body.', { 'real.sh': 'real' });
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        { id: 'safe-delete', deleteFiles: ['never-existed.sh'] },
        CTX,
      );
      expect(result.ok).toBe(true);
      const kept = await readFile(
        join(agentSkillsDir, 'safe-delete', 'real.sh'),
        'utf-8',
      );
      expect(kept).toBe('real');
    });

    it('returns error when skill does not exist', async () => {
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        { id: 'ghost-skill', body: 'No one home.' },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /does not exist/,
      );
    });

    it('returns error when no fields are provided', async () => {
      await seed('noop-update');
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute({ id: 'noop-update' }, CTX);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /No fields to update/,
      );
    });

    it('returns error when id is missing', async () => {
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute({ body: 'Orphan body.' }, CTX);
      expect(result.ok).toBe(false);
    });

    it('returns error for invalid id format', async () => {
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute({ id: 'Bad ID!', body: 'Body.' }, CTX);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /lowercase/,
      );
    });

    it('returns error for companion filename with path separator', async () => {
      await seed('path-trav-update');
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        { id: 'path-trav-update', files: { '../evil.sh': 'rm -rf /' } },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /path separator/,
      );
    });

    it('returns error when files contains SKILL.md', async () => {
      await seed('skill-md-files');
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        {
          id: 'skill-md-files',
          files: { 'SKILL.md': '---\nname: Hijack\n---' },
        },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /body parameter/,
      );
    });

    it('returns error when deleteFiles contains SKILL.md', async () => {
      await seed('skill-md-del');
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        { id: 'skill-md-del', deleteFiles: ['SKILL.md'] },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /cannot be deleted/,
      );
    });

    it('returns error when body is an empty string', async () => {
      await seed('empty-body');
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute({ id: 'empty-body', body: '' }, CTX);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toMatch(
        /No fields to update/,
      );
    });

    it('emits a note in the response when files or deleteFiles are used', async () => {
      await seed('noted', 'Body.', { 'a.sh': 'A' });
      const tool = createSkillUpdateTool(registry, workspace);
      const result = await tool.execute(
        {
          id: 'noted',
          files: { 'b.sh': 'B' },
          deleteFiles: ['a.sh'],
        },
        CTX,
      );
      expect(result.ok).toBe(true);
      const content = (result as { ok: true; content: string }).content;
      expect(content).toContain('b.sh');
      expect(content).toContain('a.sh');
    });
  });
});
