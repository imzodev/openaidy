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
 * Get addon ID from name (slugify)
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^numeric/, 'addon-');
}
