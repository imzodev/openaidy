/**
 * Skill seeding
 *
 * Copies bundled skills from config/skills to the user's SKILLS_DIR
 * (.openaidy/skills) on startup. Uses a manifest file to track the
 * hash of each file at the time it was seeded.
 *
 * Update policy:
 * - Never seeded before → copy
 * - Already seeded and user has NOT modified the file (hash matches) → overwrite with new version
 * - Already seeded and user HAS modified the file (hash differs) → skip, preserve user changes
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import semver from 'semver';

const MANIFEST_FILE = '.seed-manifest.json';

type ManifestEntry = {
  /** Semver version of the skill at the time it was seeded */
  version: string | null;
  /** SHA-256 hash of the file content at the time it was seeded */
  hash: string;
};

type SeedManifest = Record<string, ManifestEntry>;

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function extractVersion(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      if (line.startsWith('version:')) {
        const v = line.substring('version:'.length).trim();
        return semver.valid(v) ?? null;
      }
    }
  } catch {
    // ignore read errors
  }
  return null;
}

export function readSeedManifest(skillsDir: string): SeedManifest {
  return loadManifest(skillsDir);
}

export type { SeedManifest, ManifestEntry };

function loadManifest(targetDir: string): SeedManifest {
  const manifestPath = path.join(targetDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SeedManifest;
  } catch {
    return {};
  }
}

function saveManifest(targetDir: string, manifest: SeedManifest): void {
  const manifestPath = path.join(targetDir, MANIFEST_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * List every file under `dir` recursively, returned as paths relative to
 * `dir` with forward-slash separators (so manifest keys are stable across
 * platforms). Directories themselves are not returned — only files.
 */
function listRelativeFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, '');
  return out;
}

/**
 * Apply the seed/update policy to a single file. Returns true if the
 * manifest was mutated (so the caller knows to persist it).
 *
 * Policy (unchanged from the original per-file behavior):
 * - Never seeded → copy, record version+hash.
 * - Exists but predates the manifest → treat as user-owned, record it.
 * - User modified the file (hash differs from manifest) → never overwrite.
 * - Unmodified → overwrite only if source has a newer semver version, or
 *   (when neither side is versioned) the content changed.
 */
function seedFile(
  srcFile: string,
  destFile: string,
  manifestKey: string,
  manifest: SeedManifest,
): boolean {
  const srcHash = hashFile(srcFile);
  const srcVersion = extractVersion(srcFile);

  if (!fs.existsSync(destFile)) {
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(srcFile, destFile);
    manifest[manifestKey] = { version: srcVersion, hash: srcHash };
    return true;
  }

  const entry = manifest[manifestKey];
  const destHash = hashFile(destFile);

  if (entry === undefined) {
    manifest[manifestKey] = {
      version: extractVersion(destFile),
      hash: destHash,
    };
    return true;
  }

  if (destHash !== entry.hash) {
    // User modified the file — never overwrite.
    return false;
  }

  const hasNewerVersion =
    srcVersion != null &&
    entry.version != null &&
    semver.gt(srcVersion, entry.version);
  const noVersioning = srcVersion == null || entry.version == null;
  const contentChanged = srcHash !== entry.hash;

  if (hasNewerVersion || (noVersioning && contentChanged)) {
    fs.copyFileSync(srcFile, destFile);
    manifest[manifestKey] = { version: srcVersion, hash: srcHash };
    return true;
  }

  return false;
}

export function seedBundledSkills(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) return;

  fs.mkdirSync(targetDir, { recursive: true });

  const manifest = loadManifest(targetDir);
  let manifestDirty = false;

  for (const skillId of fs.readdirSync(sourceDir)) {
    const srcSkillDir = path.join(sourceDir, skillId);
    if (!fs.statSync(srcSkillDir).isDirectory()) continue;

    // Skills may bundle reference files and scripts in subdirectories, so
    // walk the whole tree rather than assuming a flat SKILL.md. Copying a
    // directory as if it were a file would throw EISDIR and abort startup.
    for (const rel of listRelativeFiles(srcSkillDir)) {
      const relParts = rel.split('/');
      const srcFile = path.join(srcSkillDir, ...relParts);
      const destFile = path.join(targetDir, skillId, ...relParts);
      const manifestKey = `${skillId}/${rel}`;

      if (seedFile(srcFile, destFile, manifestKey, manifest)) {
        manifestDirty = true;
      }
    }
  }

  if (manifestDirty) {
    saveManifest(targetDir, manifest);
  }
}
