/**
 * Skill registry
 *
 * Loads, caches, and exposes skills from the filesystem.
 * Follows the AgentRegistry lazy-load pattern.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
  initialSkills?: SkillDefinition[] | undefined;
};

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private loaded = false;
  private readonly skillsDir: string;
  private readonly initialSkills?: SkillDefinition[];

  constructor(options: SkillRegistryOptions) {
    this.skillsDir = options.skillsDir;
    this.initialSkills = options.initialSkills;
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
        // Log warning and skip invalid skill
        console.warn(
          `[SkillRegistry] Skipping invalid skill "${id}": ${result.errors.map((e) => e.message).join(', ')}`,
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
