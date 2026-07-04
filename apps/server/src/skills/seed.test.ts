import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { seedBundledSkills } from './seed.js';

const MANIFEST_FILE = '.seed-manifest.json';

function makeTmpDir(prefix: string): string {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(dir: string, skillId: string, content: string): string {
  const skillDir = join(dir, skillId);
  mkdirSync(skillDir, { recursive: true });
  const filePath = join(skillDir, 'SKILL.md');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function readSkill(dir: string, skillId: string): string {
  return readFileSync(join(dir, skillId, 'SKILL.md'), 'utf8');
}

function readManifest(
  targetDir: string,
): Record<string, { version: string | null; hash: string }> {
  const p = join(targetDir, MANIFEST_FILE);
  return JSON.parse(readFileSync(p, 'utf8')) as Record<
    string,
    { version: string | null; hash: string }
  >;
}

const skillV1 = `---
name: Test Skill
description: A test skill
version: 1.0.0
---

Body v1.
`;

const skillV2 = `---
name: Test Skill
description: A test skill
version: 2.0.0
---

Body v2.
`;

const skillNoVersion = `---
name: Test Skill
description: A test skill
---

Body no version.
`;

const skillNoVersionUpdated = `---
name: Test Skill
description: A test skill
---

Body no version updated.
`;

let srcDir: string;
let destDir: string;

beforeEach(() => {
  srcDir = makeTmpDir('seed-src');
  destDir = makeTmpDir('seed-dest');
});

afterEach(() => {
  rmSync(srcDir, { recursive: true, force: true });
  rmSync(destDir, { recursive: true, force: true });
});

describe('seedBundledSkills', () => {
  describe('source dir missing', () => {
    it('does nothing when source dir does not exist', () => {
      seedBundledSkills(join(srcDir, 'nonexistent'), destDir);
      expect(existsSync(join(destDir, MANIFEST_FILE))).toBe(false);
    });
  });

  describe('first-time seed (file not present in dest)', () => {
    it('copies the file to dest', () => {
      writeSkill(srcDir, 'my-skill', skillV1);
      seedBundledSkills(srcDir, destDir);
      expect(readSkill(destDir, 'my-skill')).toBe(skillV1);
    });

    it('writes manifest with version and hash', () => {
      writeSkill(srcDir, 'my-skill', skillV1);
      seedBundledSkills(srcDir, destDir);
      const manifest = readManifest(destDir);
      expect(manifest['my-skill/SKILL.md']).toMatchObject({ version: '1.0.0' });
      expect(typeof manifest['my-skill/SKILL.md']?.hash).toBe('string');
    });

    it('stores null version when skill has no version field', () => {
      writeSkill(srcDir, 'my-skill', skillNoVersion);
      seedBundledSkills(srcDir, destDir);
      const manifest = readManifest(destDir);
      expect(manifest['my-skill/SKILL.md']?.version).toBeNull();
    });
  });

  describe('already seeded, user has NOT modified the file', () => {
    it('overwrites when source has a newer semver version', () => {
      writeSkill(srcDir, 'my-skill', skillV1);
      seedBundledSkills(srcDir, destDir);

      // Simulate app update: bump source to v2
      writeSkill(srcDir, 'my-skill', skillV2);
      seedBundledSkills(srcDir, destDir);

      expect(readSkill(destDir, 'my-skill')).toBe(skillV2);
    });

    it('updates manifest to new version after overwrite', () => {
      writeSkill(srcDir, 'my-skill', skillV1);
      seedBundledSkills(srcDir, destDir);
      writeSkill(srcDir, 'my-skill', skillV2);
      seedBundledSkills(srcDir, destDir);

      const manifest = readManifest(destDir);
      expect(manifest['my-skill/SKILL.md']?.version).toBe('2.0.0');
    });

    it('does NOT overwrite when source version is same', () => {
      writeSkill(srcDir, 'my-skill', skillV1);
      seedBundledSkills(srcDir, destDir);

      // Same version, same content
      seedBundledSkills(srcDir, destDir);
      expect(readSkill(destDir, 'my-skill')).toBe(skillV1);
    });

    it('does NOT overwrite when source version is older', () => {
      writeSkill(srcDir, 'my-skill', skillV2);
      seedBundledSkills(srcDir, destDir);

      // Downgrade source to v1 (should not overwrite)
      writeSkill(srcDir, 'my-skill', skillV1);
      seedBundledSkills(srcDir, destDir);

      expect(readSkill(destDir, 'my-skill')).toBe(skillV2);
    });

    it('overwrites when neither src nor dest has a version but content changed', () => {
      writeSkill(srcDir, 'my-skill', skillNoVersion);
      seedBundledSkills(srcDir, destDir);

      writeSkill(srcDir, 'my-skill', skillNoVersionUpdated);
      seedBundledSkills(srcDir, destDir);

      expect(readSkill(destDir, 'my-skill')).toBe(skillNoVersionUpdated);
    });
  });

  describe('already seeded, user HAS modified the file', () => {
    it('does not overwrite when user modified dest and source has newer version', () => {
      writeSkill(srcDir, 'my-skill', skillV1);
      seedBundledSkills(srcDir, destDir);

      // User edits their local copy
      writeFileSync(
        join(destDir, 'my-skill', 'SKILL.md'),
        '# My custom edit\n',
        'utf8',
      );

      // App ships v2
      writeSkill(srcDir, 'my-skill', skillV2);
      seedBundledSkills(srcDir, destDir);

      expect(readSkill(destDir, 'my-skill')).toBe('# My custom edit\n');
    });

    it('does not overwrite when user modified dest and source has no version', () => {
      writeSkill(srcDir, 'my-skill', skillNoVersion);
      seedBundledSkills(srcDir, destDir);

      writeFileSync(
        join(destDir, 'my-skill', 'SKILL.md'),
        '# My custom edit\n',
        'utf8',
      );

      writeSkill(srcDir, 'my-skill', skillNoVersionUpdated);
      seedBundledSkills(srcDir, destDir);

      expect(readSkill(destDir, 'my-skill')).toBe('# My custom edit\n');
    });
  });

  describe('file exists in dest but predates manifest (pre-manifest install)', () => {
    it('does not overwrite the existing file', () => {
      // Simulate old install: file present but no manifest
      writeSkill(destDir, 'my-skill', '# Old user file\n');

      writeSkill(srcDir, 'my-skill', skillV2);
      seedBundledSkills(srcDir, destDir);

      expect(readSkill(destDir, 'my-skill')).toBe('# Old user file\n');
    });

    it('records the existing file in the manifest for future tracking', () => {
      writeSkill(destDir, 'my-skill', '# Old user file\n');

      writeSkill(srcDir, 'my-skill', skillV2);
      seedBundledSkills(srcDir, destDir);

      const manifest = readManifest(destDir);
      expect(manifest['my-skill/SKILL.md']).toBeDefined();
    });
  });

  describe('multiple skills', () => {
    it('seeds all skill directories', () => {
      writeSkill(srcDir, 'skill-a', skillV1);
      writeSkill(srcDir, 'skill-b', skillV1);
      seedBundledSkills(srcDir, destDir);

      expect(existsSync(join(destDir, 'skill-a', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(destDir, 'skill-b', 'SKILL.md'))).toBe(true);
    });

    it('handles each skill independently (one modified, one updated)', () => {
      writeSkill(srcDir, 'skill-a', skillV1);
      writeSkill(srcDir, 'skill-b', skillV1);
      seedBundledSkills(srcDir, destDir);

      // User modifies skill-a
      writeFileSync(
        join(destDir, 'skill-a', 'SKILL.md'),
        '# User edit\n',
        'utf8',
      );

      // App updates both to v2
      writeSkill(srcDir, 'skill-a', skillV2);
      writeSkill(srcDir, 'skill-b', skillV2);
      seedBundledSkills(srcDir, destDir);

      expect(readSkill(destDir, 'skill-a')).toBe('# User edit\n'); // preserved
      expect(readSkill(destDir, 'skill-b')).toBe(skillV2); // updated
    });
  });

  describe('non-directory entries in source are ignored', () => {
    it('skips files at the top level of source dir', () => {
      writeFileSync(join(srcDir, 'README.md'), '# readme\n', 'utf8');
      writeSkill(srcDir, 'my-skill', skillV1);

      seedBundledSkills(srcDir, destDir);

      expect(existsSync(join(destDir, 'README.md'))).toBe(false);
      expect(existsSync(join(destDir, 'my-skill', 'SKILL.md'))).toBe(true);
    });
  });

  describe('skills with subdirectories (references, scripts, templates)', () => {
    function writeRichSkill(dir: string, skillId: string): void {
      const skillDir = join(dir, skillId);
      mkdirSync(join(skillDir, 'references'), { recursive: true });
      mkdirSync(join(skillDir, 'scripts'), { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), skillV1, 'utf8');
      writeFileSync(
        join(skillDir, 'references', 'guide.md'),
        '# guide\n',
        'utf8',
      );
      writeFileSync(
        join(skillDir, 'scripts', 'run.mjs'),
        'console.log("hi");\n',
        'utf8',
      );
    }

    it('does not throw on a skill dir containing subdirectories', () => {
      // Regression: the seeder used to call readFileSync/copyFileSync on
      // subdirectory entries, throwing EISDIR and aborting startup.
      writeRichSkill(srcDir, 'rich-skill');
      expect(() => seedBundledSkills(srcDir, destDir)).not.toThrow();
    });

    it('copies nested files preserving directory structure', () => {
      writeRichSkill(srcDir, 'rich-skill');
      seedBundledSkills(srcDir, destDir);

      expect(existsSync(join(destDir, 'rich-skill', 'SKILL.md'))).toBe(true);
      expect(
        readFileSync(
          join(destDir, 'rich-skill', 'references', 'guide.md'),
          'utf8',
        ),
      ).toBe('# guide\n');
      expect(
        readFileSync(join(destDir, 'rich-skill', 'scripts', 'run.mjs'), 'utf8'),
      ).toBe('console.log("hi");\n');
    });

    it('records nested files in the manifest under forward-slash keys', () => {
      writeRichSkill(srcDir, 'rich-skill');
      seedBundledSkills(srcDir, destDir);

      const manifest = readManifest(destDir);
      expect(manifest['rich-skill/SKILL.md']).toBeDefined();
      expect(manifest['rich-skill/references/guide.md']).toBeDefined();
      expect(manifest['rich-skill/scripts/run.mjs']).toBeDefined();
    });

    it('preserves a user-modified nested file while updating an unmodified sibling', () => {
      writeRichSkill(srcDir, 'rich-skill');
      seedBundledSkills(srcDir, destDir);

      // User edits one reference file locally.
      writeFileSync(
        join(destDir, 'rich-skill', 'references', 'guide.md'),
        '# my edit\n',
        'utf8',
      );

      // App ships new content for both nested files (no version → content-based).
      writeFileSync(
        join(srcDir, 'rich-skill', 'references', 'guide.md'),
        '# upstream guide v2\n',
        'utf8',
      );
      writeFileSync(
        join(srcDir, 'rich-skill', 'scripts', 'run.mjs'),
        'console.log("v2");\n',
        'utf8',
      );
      seedBundledSkills(srcDir, destDir);

      expect(
        readFileSync(
          join(destDir, 'rich-skill', 'references', 'guide.md'),
          'utf8',
        ),
      ).toBe('# my edit\n'); // preserved
      expect(
        readFileSync(join(destDir, 'rich-skill', 'scripts', 'run.mjs'), 'utf8'),
      ).toBe('console.log("v2");\n'); // updated
    });

    it('is idempotent on re-seed with unchanged source', () => {
      writeRichSkill(srcDir, 'rich-skill');
      seedBundledSkills(srcDir, destDir);
      const first = readManifest(destDir);

      expect(() => seedBundledSkills(srcDir, destDir)).not.toThrow();
      const second = readManifest(destDir);
      expect(second).toEqual(first);
    });
  });
});
