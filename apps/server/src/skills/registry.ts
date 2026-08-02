/**
 * Skill registry
 *
 * Loads, caches, and exposes skills from the filesystem.
 * Follows the AgentRegistry lazy-load pattern.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillLoadError } from '@openaidy/shared-types';
import { parseSkillMd } from './parser.js';
import type { SkillDefinition } from './parser.js';

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
};

export type SkillRegistryOptions = {
  /** Directory to scan for skills */
  skillsDir: string;
  /**
   * Initial skills to seed the registry with (for testing — bypasses filesystem).
   * When provided, load() is a no-op and these skills are used directly.
   */
  initialSkills?: SkillDefinition[];
};

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private loadErrors: SkillLoadError[] = [];
  private loaded = false;
  private readonly skillsDir: string;
  private readonly initialSkills?: SkillDefinition[];

  constructor(options: SkillRegistryOptions) {
    this.skillsDir = options.skillsDir;
    if (options.initialSkills) {
      this.initialSkills = options.initialSkills;
    }
  }

  /**
   * Scan skillsDir and cache all valid skills.
   * Safe to call multiple times — only loads once.
   */
  load(): void {
    if (this.loaded) return;

    if (this.initialSkills) {
      for (const skill of this.initialSkills) {
        this.skills.set(skill.id, skill);
      }
    } else {
      this.loadFromDir();
    }

    this.loaded = true;
  }

  /**
   * Per-file validation errors collected during the last load().
   * Each entry is a directory id and the absolute path of its SKILL.md,
   * plus the parser messages explaining why the file was rejected.
   *
   * Skills that land here were skipped — agents listing them in their config
   * will not see them at runtime. Surface them via /skills or the API so the
   * problem is visible instead of a silent no-op.
   */
  getLoadErrors(): SkillLoadError[] {
    this.ensureLoaded();
    return [...this.loadErrors];
  }

  private loadFromDir(): void {
    if (!existsSync(this.skillsDir)) {
      return;
    }

    let subdirs: string[];
    try {
      subdirs = readdirSync(this.skillsDir);
    } catch {
      return;
    }

    for (const id of subdirs) {
      const skillPath = join(this.skillsDir, id);
      const skillFile = join(skillPath, 'SKILL.md');

      // Skip files — only process directories
      if (!existsSync(skillFile)) continue;

      let content: string;
      try {
        content = readFileSync(skillFile, 'utf-8');
      } catch {
        // Skip unreadable files
        continue;
      }

      const result = parseSkillMd(content, id, skillFile);

      if ('errors' in result) {
        const messages = result.errors.map((e) => e.message);
        this.loadErrors.push({ id, filePath: skillFile, messages });
        // Actionable warning — file path is included so the operator can find it.
        console.warn(
          `[SkillRegistry] Skipping invalid skill "${id}" at ${skillFile}: ${messages.join(', ')}. ` +
            `SKILL.md must start with YAML frontmatter (---) including at minimum 'name' and 'description'. ` +
            `Use skill_create to generate a valid file.`,
        );
        continue;
      }

      this.skills.set(id, result);
    }
  }

  /** Return summaries of all loaded skills */
  listSkills(): SkillSummary[] {
    this.ensureLoaded();
    return Array.from(this.skills.values()).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));
  }

  /** Return full definition for a skill by ID, or undefined */
  getSkill(id: string): SkillDefinition | undefined {
    this.ensureLoaded();
    return this.skills.get(id);
  }

  /**
   * Return full definitions for the given IDs.
   * Unknown IDs are silently skipped.
   */
  getSkillsForAgent(skillIds: string[]): SkillDefinition[] {
    this.ensureLoaded();
    const result: SkillDefinition[] = [];
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill) {
        result.push(skill);
      }
    }
    return result;
  }

  /**
   * Register a skill definition directly into the in-memory cache.
   * Used by tools that create skills at runtime so the new skill is
   * immediately available without a server restart.
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }
}

export function createSkillRegistry(
  options: SkillRegistryOptions,
): SkillRegistry {
  return new SkillRegistry(options);
}
