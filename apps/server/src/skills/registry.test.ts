import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillRegistry } from './registry.js';
import type { SkillDefinition } from './parser.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

function createTmpSkill(name: string): SkillDefinition {
  return {
    id: name,
    name: `${name} name`,
    description: `${name} description`,
    body: `This is the ${name} body.`,
  };
}

describe('SkillRegistry', () => {
  let tmpSkillDir: string;

  beforeEach(() => {
    tmpSkillDir = join(tmpdir(), `skill-registry-test-${Date.now()}`);
    mkdirSync(tmpSkillDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpSkillDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('load()', () => {
    it('loads skills from the skills directory', () => {
      // Create skill directories
      mkdirSync(join(tmpSkillDir, 'skill-a'), { recursive: true });
      mkdirSync(join(tmpSkillDir, 'skill-b'), { recursive: true });

      writeFileSync(
        join(tmpSkillDir, 'skill-a/SKILL.md'),
        [
          '---',
          'name: Skill A',
          'description: Description A',
          '---',
          'Body A',
        ].join('\n'),
      );
      writeFileSync(
        join(tmpSkillDir, 'skill-b/SKILL.md'),
        [
          '---',
          'name: Skill B',
          'description: Description B',
          '---',
          'Body B',
        ].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skills = registry.listSkills();
      expect(skills).toHaveLength(2);
      expect(skills).toContainEqual({
        id: 'skill-a',
        name: 'Skill A',
        description: 'Description A',
      });
      expect(skills).toContainEqual({
        id: 'skill-b',
        name: 'Skill B',
        description: 'Description B',
      });
    });

    it('skips directories without SKILL.md', () => {
      mkdirSync(join(tmpSkillDir, 'valid-skill'), { recursive: true });
      mkdirSync(join(tmpSkillDir, 'no-skill-file'), { recursive: true });

      writeFileSync(
        join(tmpSkillDir, 'valid-skill/SKILL.md'),
        ['---', 'name: Valid', 'description: Has SKILL.md', '---', 'Body'].join(
          '\n',
        ),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skills = registry.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0]!.id).toBe('valid-skill');
    });

    it('skips invalid SKILL.md files and logs warning', () => {
      mkdirSync(join(tmpSkillDir, 'bad-skill'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'bad-skill/SKILL.md'),
        ['---', '---', 'Missing name and description'].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skills = registry.listSkills();
      expect(skills).toHaveLength(0);
    });

    it('skips SKILL.md with no frontmatter and records the load error', () => {
      // Simulates the agent writing a SKILL.md directly via workspace_write
      // instead of skill_create: just a markdown heading, no --- delimiters.
      mkdirSync(join(tmpSkillDir, 'no-frontmatter'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'no-frontmatter/SKILL.md'),
        [
          '# Generación de Imágenes',
          '',
          'Esta skill invoca un modelo para generar imágenes.',
        ].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      expect(registry.listSkills()).toHaveLength(0);
      const errors = registry.getLoadErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.id).toBe('no-frontmatter');
      expect(errors[0]!.filePath).toMatch(/no-frontmatter[\\/]SKILL\.md$/);
      expect(errors[0]!.messages.join(' ')).toMatch(/frontmatter/i);
    });

    it('records separate load errors for each invalid skill', () => {
      mkdirSync(join(tmpSkillDir, 'bad-a'), { recursive: true });
      mkdirSync(join(tmpSkillDir, 'bad-b'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'bad-a/SKILL.md'),
        '# Just a heading\n\nNo frontmatter here.',
      );
      writeFileSync(
        join(tmpSkillDir, 'bad-b/SKILL.md'),
        ['---', '---', 'Empty frontmatter'].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const errorIds = registry
        .getLoadErrors()
        .map((e) => e.id)
        .sort();
      expect(errorIds).toEqual(['bad-a', 'bad-b']);
    });

    it('loads from initialSkills when provided (bypasses filesystem)', () => {
      const initialSkills = [
        createTmpSkill('init-a'),
        createTmpSkill('init-b'),
      ];
      const registry = new SkillRegistry({
        skillsDir: tmpSkillDir,
        initialSkills,
      });
      registry.load();

      const skills = registry.listSkills();
      expect(skills).toHaveLength(2);
      expect(skills).toContainEqual({
        id: 'init-a',
        name: 'init-a name',
        description: 'init-a description',
      });
    });

    it('handles missing skills directory gracefully', () => {
      const nonExistentDir = join(tmpdir(), 'this-dir-does-not-exist-xyz');
      const registry = new SkillRegistry({ skillsDir: nonExistentDir });
      registry.load(); // Should not throw

      expect(registry.listSkills()).toHaveLength(0);
    });

    it('only loads once when called multiple times', () => {
      mkdirSync(join(tmpSkillDir, 'once-skill'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'once-skill/SKILL.md'),
        ['---', 'name: Once', 'description: Once only', '---', 'Body'].join(
          '\n',
        ),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();
      registry.load();
      registry.load();

      expect(registry.listSkills()).toHaveLength(1);
    });
  });

  describe('listSkills()', () => {
    it('returns empty array when no skills loaded', () => {
      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();
      expect(registry.listSkills()).toHaveLength(0);
    });

    it('returns SkillSummary objects with id, name, description', () => {
      mkdirSync(join(tmpSkillDir, 'summary-test'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'summary-test/SKILL.md'),
        [
          '---',
          'name: Summary Test',
          'description: A test summary',
          '---',
          'Body',
        ].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skills = registry.listSkills();
      expect(skills[0]).toEqual({
        id: 'summary-test',
        name: 'Summary Test',
        description: 'A test summary',
      });
    });
  });

  describe('getSkill()', () => {
    it('returns full SkillDefinition for known ID', () => {
      mkdirSync(join(tmpSkillDir, 'full-skill'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'full-skill/SKILL.md'),
        [
          '---',
          'name: Full Skill',
          'description: Full desc',
          '---',
          'Full body content',
        ].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skill = registry.getSkill('full-skill');
      expect(skill).toEqual({
        id: 'full-skill',
        name: 'Full Skill',
        description: 'Full desc',
        body: 'Full body content',
      });
    });

    it('returns undefined for unknown ID', () => {
      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      expect(registry.getSkill('does-not-exist')).toBeUndefined();
    });
  });

  describe('getSkillsForAgent()', () => {
    it('returns matching SkillDefinitions for given IDs', () => {
      mkdirSync(join(tmpSkillDir, 'agent-skill-1'), { recursive: true });
      mkdirSync(join(tmpSkillDir, 'agent-skill-2'), { recursive: true });

      writeFileSync(
        join(tmpSkillDir, 'agent-skill-1/SKILL.md'),
        [
          '---',
          'name: Agent Skill 1',
          'description: Desc 1',
          '---',
          'Body 1',
        ].join('\n'),
      );
      writeFileSync(
        join(tmpSkillDir, 'agent-skill-2/SKILL.md'),
        [
          '---',
          'name: Agent Skill 2',
          'description: Desc 2',
          '---',
          'Body 2',
        ].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skills = registry.getSkillsForAgent([
        'agent-skill-1',
        'agent-skill-2',
      ]);
      expect(skills).toHaveLength(2);
      expect(skills[0]!.id).toBe('agent-skill-1');
      expect(skills[1]!.id).toBe('agent-skill-2');
    });

    it('silently skips unknown IDs', () => {
      mkdirSync(join(tmpSkillDir, 'real-skill'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'real-skill/SKILL.md'),
        ['---', 'name: Real', 'description: Real desc', '---', 'Body'].join(
          '\n',
        ),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skills = registry.getSkillsForAgent([
        'real-skill',
        'unknown-id',
        'another-fake',
      ]);
      expect(skills).toHaveLength(1);
      expect(skills[0]!.id).toBe('real-skill');
    });

    it('returns empty array when no IDs provided', () => {
      mkdirSync(join(tmpSkillDir, 'some-skill'), { recursive: true });
      writeFileSync(
        join(tmpSkillDir, 'some-skill/SKILL.md'),
        ['---', 'name: Some', 'description: Some desc', '---', 'Body'].join(
          '\n',
        ),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      expect(registry.getSkillsForAgent([])).toHaveLength(0);
    });

    it('returns skills in the order of the input IDs', () => {
      mkdirSync(join(tmpSkillDir, 'first'), { recursive: true });
      mkdirSync(join(tmpSkillDir, 'second'), { recursive: true });

      writeFileSync(
        join(tmpSkillDir, 'first/SKILL.md'),
        [
          '---',
          'name: First',
          'description: First desc',
          '---',
          'First body',
        ].join('\n'),
      );
      writeFileSync(
        join(tmpSkillDir, 'second/SKILL.md'),
        [
          '---',
          'name: Second',
          'description: Second desc',
          '---',
          'Second body',
        ].join('\n'),
      );

      const registry = new SkillRegistry({ skillsDir: tmpSkillDir });
      registry.load();

      const skills = registry.getSkillsForAgent(['second', 'first']);
      expect(skills).toHaveLength(2);
      expect(skills[0]!.id).toBe('second');
      expect(skills[1]!.id).toBe('first');
    });
  });
});
