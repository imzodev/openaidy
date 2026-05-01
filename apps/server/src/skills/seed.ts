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

export function seedBundledSkills(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) return;

  fs.mkdirSync(targetDir, { recursive: true });

  const manifest = loadManifest(targetDir);
  let manifestDirty = false;

  for (const skillId of fs.readdirSync(sourceDir)) {
    const srcSkillDir = path.join(sourceDir, skillId);
    if (!fs.statSync(srcSkillDir).isDirectory()) continue;

    const destSkillDir = path.join(targetDir, skillId);
    fs.mkdirSync(destSkillDir, { recursive: true });

    for (const file of fs.readdirSync(srcSkillDir)) {
      const srcFile = path.join(srcSkillDir, file);
      const destFile = path.join(destSkillDir, file);
      const manifestKey = `${skillId}/${file}`;

      const srcHash = hashFile(srcFile);
      const srcVersion = extractVersion(srcFile);

      if (!fs.existsSync(destFile)) {
        // Never seeded — copy unconditionally
        fs.copyFileSync(srcFile, destFile);
        manifest[manifestKey] = { version: srcVersion, hash: srcHash };
        manifestDirty = true;
      } else {
        const entry = manifest[manifestKey];
        const destHash = hashFile(destFile);

        if (entry === undefined) {
          // File exists but predates the manifest — treat as user-owned, record current state
          manifest[manifestKey] = {
            version: extractVersion(destFile),
            hash: destHash,
          };
          manifestDirty = true;
        } else if (destHash !== entry.hash) {
          // User modified the file — never overwrite
        } else {
          // File is unmodified by user — overwrite only if source has a newer version
          const hasNewerVersion =
            srcVersion != null &&
            entry.version != null &&
            semver.gt(srcVersion, entry.version);
          const noVersioning = srcVersion == null || entry.version == null;
          const contentChanged = srcHash !== entry.hash;

          if (hasNewerVersion || (noVersioning && contentChanged)) {
            fs.copyFileSync(srcFile, destFile);
            manifest[manifestKey] = { version: srcVersion, hash: srcHash };
            manifestDirty = true;
          }
        }
      }
    }
  }

  if (manifestDirty) {
    saveManifest(targetDir, manifest);
  }
}
