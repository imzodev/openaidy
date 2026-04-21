/**
 * Init Command - Initialize existing addon project
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  detectAddonProject,
  readAddonManifest,
  validateProjectStructure,
} from '../utils/project.js';

export interface InitOptions {
  force?: boolean;
}

export interface InitResult {
  success: boolean;
  message: string;
  isNew?: boolean;
}

/**
 * Initialize existing addon project
 */
export async function initAddon(
  projectPath: string = process.cwd(),
  options: InitOptions = {},
): Promise<InitResult> {
  const { force = false } = options;

  // Check if project exists
  if (!fs.existsSync(projectPath)) {
    return {
      success: false,
      message: `Project directory not found: ${projectPath}`,
    };
  }

  // Check if it's already an addon project
  const isExisting = detectAddonProject(projectPath);

  if (isExisting && !force) {
    return {
      success: true,
      message: 'Project is already an addon. Use --force to reinitialize.',
      isNew: false,
    };
  }

  // Validate project structure
  const validation = validateProjectStructure(projectPath);

  if (!validation.valid) {
    return {
      success: false,
      message: `Invalid project structure: ${validation.errors.join(', ')}`,
    };
  }

  // Read manifest
  const manifest = readAddonManifest(projectPath);

  if (!manifest) {
    return {
      success: false,
      message:
        'addon.json not found. Create an addon project first with "openaidy create".',
    };
  }

  // Check for package.json and install dependencies
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    // In a real implementation, we would run npm install here
    return {
      success: true,
      message: `Initialized addon: ${manifest.name || path.basename(projectPath)}`,
      isNew: false,
    };
  }

  return {
    success: true,
    message: 'Project initialized successfully',
    isNew: true,
  };
}

/**
 * Update addon configuration
 */
export async function updateConfig(
  projectPath: string,
  updates: Record<string, unknown>,
): Promise<InitResult> {
  const manifestPath = path.join(projectPath, 'addon.json');

  if (!fs.existsSync(manifestPath)) {
    return {
      success: false,
      message: 'addon.json not found',
    };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const updated = { ...manifest, ...updates };
    fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2));

    return {
      success: true,
      message: 'Configuration updated successfully',
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to update config: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
