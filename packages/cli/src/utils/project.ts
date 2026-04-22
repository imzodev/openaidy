/**
 * Project Management Utilities for Addon CLI
 */

import fs from 'node:fs';
import path from 'node:path';
import { AddonProject, ValidationResult } from '../types/cli.js';

/**
 * Detect if a directory is an existing addon project
 */
export function detectAddonProject(projectPath: string): boolean {
  const manifestPath = path.join(projectPath, 'addon.json');
  return fs.existsSync(manifestPath);
}

/**
 * Read and parse addon.json
 */
export function readAddonManifest(
  projectPath: string,
): Record<string, unknown> | null {
  const manifestPath = path.join(projectPath, 'addon.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get project information from directory
 */
export function getProjectInfo(projectPath: string): AddonProject | null {
  const manifest = readAddonManifest(projectPath);
  if (!manifest) {
    return null;
  }

  return {
    name: String(manifest.name || path.basename(projectPath)),
    id: String(manifest.id || ''),
    path: projectPath,
    template: String(manifest.template || 'basic'),
  };
}

/**
 * Validate that project structure is correct
 */
export function validateProjectStructure(
  projectPath: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for required files
  const requiredFiles = ['addon.json'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(projectPath, file))) {
      errors.push(`Missing required file: ${file}`);
    }
  }

  // Check for source directory
  if (!fs.existsSync(path.join(projectPath, 'src'))) {
    warnings.push('Missing src directory - addon may be incomplete');
  }

  // Check for package.json
  if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
    warnings.push('Missing package.json - npm integration may not work');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Create directory structure for addon project
 */
export async function createProjectStructure(
  projectPath: string,
  _template: string,
): Promise<void> {
  const directories = ['src', 'src/components', 'src/utils', 'public'];

  for (const dir of directories) {
    const fullPath = path.join(projectPath, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}

/**
 * Get the list of files in a project
 */
export function listProjectFiles(
  projectPath: string,
  recursive = false,
): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          walk(fullPath);
        }
      } else {
        files.push(path.relative(projectPath, fullPath));
      }
    }
  }

  walk(projectPath);
  return files;
}

/**
 * Check if npm/yarn/pnpm is available
 */
export async function hasPackageManager(): Promise<{
  npm: boolean;
  yarn: boolean;
  pnpm: boolean;
}> {
  const checkCommand = async (cmd: string): Promise<boolean> => {
    try {
      const { execSync } = await import('node:child_process');
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  const [npm, yarn, pnpm] = await Promise.all([
    checkCommand('npm --version'),
    checkCommand('yarn --version'),
    checkCommand('pnpm --version'),
  ]);

  return { npm, yarn, pnpm };
}

/**
 * Resolve the .openaidy/addons directory by walking up from cwd.
 */
export function resolveAddonsDir(): string {
  if (process.env.OPENAIDY_HOME) {
    return path.join(process.env.OPENAIDY_HOME, 'addons');
  }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.openaidy');
    if (fs.existsSync(candidate)) {
      return path.join(candidate, 'addons');
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), '.openaidy', 'addons');
}

/**
 * Resolve which addon project to operate on.
 *
 * Resolution order:
 * 1. If addonName is given, use .openaidy/addons/<addonName>
 * 2. If cwd itself contains addon.json, use cwd
 * 3. If .openaidy/addons/ has exactly one addon, use it
 * 4. Otherwise return null (caller should list options to user)
 */
export function resolveAddonProject(addonName?: string): {
  path: string;
  name: string;
} | null {
  // Explicit name supplied
  if (addonName) {
    const addonsDir = resolveAddonsDir();
    const addonPath = path.join(addonsDir, addonName);
    if (fs.existsSync(path.join(addonPath, 'addon.json'))) {
      return { path: addonPath, name: addonName };
    }
    return null;
  }

  // Running from inside an addon directory
  const localManifest = path.join(process.cwd(), 'addon.json');
  if (fs.existsSync(localManifest)) {
    return { path: process.cwd(), name: path.basename(process.cwd()) };
  }

  // Auto-detect from .openaidy/addons/
  const addonsDir = resolveAddonsDir();
  if (!fs.existsSync(addonsDir)) return null;
  const entries = fs
    .readdirSync(addonsDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        fs.existsSync(path.join(addonsDir, e.name, 'addon.json')),
    );
  if (entries.length === 1) {
    const addonPath = path.join(addonsDir, entries[0].name);
    return { path: addonPath, name: entries[0].name };
  }
  if (entries.length > 1) {
    // Return all as a special multi-result using null — caller handles listing
    return null;
  }
  return null;
}

/**
 * List all addon projects in .openaidy/addons/
 */
export function listAddonProjects(): Array<{ path: string; name: string }> {
  const addonsDir = resolveAddonsDir();
  if (!fs.existsSync(addonsDir)) return [];
  return fs
    .readdirSync(addonsDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        fs.existsSync(path.join(addonsDir, e.name, 'addon.json')),
    )
    .map((e) => ({ path: path.join(addonsDir, e.name), name: e.name }));
}

/**
 * Get addon ID from name (slugify)
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^numeric/, 'addon-');
}
