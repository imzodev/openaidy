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
