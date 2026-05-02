/**
 * Validate Command - Validate addon package and manifest
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CommandResult,
  ValidateOptions,
  ValidateResult,
} from '../../types.js';
import {
  readAddonManifest,
  validateProjectStructure,
} from '../../utils/project.js';
import {
  validateAddonId,
  validateAddonName,
  validateVersion,
} from '../../utils/validation.js';

/**
 * Validate addon project
 */
export async function validateAddon(
  projectPath: string = process.cwd(),
  options: ValidateOptions = {},
): Promise<ValidateResult> {
  const {
    package: validatePackage = false,
    verbose = false,
    strict = false,
  } = options;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if project exists
  if (!fs.existsSync(projectPath)) {
    return {
      valid: false,
      message: `Project directory not found: ${projectPath}`,
      errors: [`Directory not found: ${projectPath}`],
      warnings: [],
    };
  }

  // Read manifest
  const manifest = readAddonManifest(projectPath);
  if (!manifest) {
    return {
      valid: false,
      message: 'addon.json not found',
      errors: ['addon.json manifest file not found'],
      warnings: [],
    };
  }

  // Validate manifest fields
  if (!manifest.id) {
    errors.push('Manifest missing required field: id');
  } else if (!validateAddonId(String(manifest.id))) {
    errors.push('Invalid addon ID format');
  }

  if (!manifest.name) {
    errors.push('Manifest missing required field: name');
  } else if (!validateAddonName(String(manifest.name))) {
    errors.push('Invalid addon name format');
  }

  if (!manifest.version) {
    errors.push('Manifest missing required field: version');
  } else if (!validateVersion(String(manifest.version))) {
    errors.push(
      'Invalid version format. Use semantic versioning (e.g., 1.0.0)',
    );
  }

  if (!manifest.description) {
    warnings.push('Manifest missing recommended field: description');
  }

  if (!manifest.openaidy) {
    errors.push('Manifest missing required field: openaidy');
  } else if (typeof manifest.openaidy === 'object') {
    const openaidy = manifest.openaidy as Record<string, unknown>;
    if (!openaidy.minVersion) {
      warnings.push('openaidy.minVersion not specified');
    }
  }

  // Validate project structure
  const structureResult = validateProjectStructure(projectPath);
  errors.push(...structureResult.errors);
  warnings.push(...structureResult.warnings);

  // Validate package if requested
  if (validatePackage) {
    const packageResult = await validatePackageStructure(projectPath);
    errors.push(...packageResult.errors);
    warnings.push(...packageResult.warnings);
  }

  // Strict mode adds more warnings as errors
  if (strict && warnings.length > 0) {
    errors.push(...warnings);
    warnings.length = 0;
  }

  const valid = errors.length === 0;

  if (verbose) {
    console.log('Validation Results:');
    console.log(`  Manifest: ${manifest.id || 'unknown'}`);
    console.log(`  Version: ${manifest.version || 'unknown'}`);
    console.log(`  Errors: ${errors.length}`);
    console.log(`  Warnings: ${warnings.length}`);
  }

  return {
    valid,
    message: valid
      ? 'Addon validation passed'
      : `Validation failed with ${errors.length} error(s)`,
    errors,
    warnings,
  };
}

/**
 * Validate package structure for published addons
 */
async function validatePackageStructure(projectPath: string): Promise<{
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for dist directory
  const distPath = path.join(projectPath, 'dist');
  if (!fs.existsSync(distPath)) {
    errors.push(
      'dist directory not found. Run "openaidy build" before publishing.',
    );
  } else {
    // Check for entry point in dist
    const manifest = readAddonManifest(projectPath);
    if (manifest && manifest.entry) {
      const entryPath = path.join(
        distPath,
        String(manifest.entry).replace('dist/', ''),
      );
      if (!fs.existsSync(entryPath)) {
        errors.push(`Entry point not found: ${manifest.entry}`);
      }
    }
  }

  // Check for proper file structure
  const requiredFiles = ['addon.json', 'package.json'];
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(projectPath, file))) {
      errors.push(`Required file missing: ${file}`);
    }
  }

  // Check for README
  if (!fs.existsSync(path.join(projectPath, 'README.md'))) {
    warnings.push('README.md not found - documentation recommended');
  }

  return { errors, warnings };
}

/**
 * Validate addon ID uniqueness (check against registry)
 */
export async function checkAddonIdUniqueness(addonId: string): Promise<{
  available: boolean;
  message: string;
}> {
  // In a real implementation, this would check against the marketplace registry
  // For now, we just return a placeholder
  return {
    available: true,
    message: `Addon ID "${addonId}" is available`,
  };
}

export async function addonValidateHandler(
  args: string[],
): Promise<CommandResult> {
  const options: Record<string, boolean> = {};
  for (const arg of args) {
    if (arg === '-p' || arg === '--package') options.package = true;
    else if (arg === '-v' || arg === '--verbose') options.verbose = true;
    else if (arg === '--strict') options.strict = true;
  }

  const s = p.spinner();
  s.start('Validating addon\u2026');
  const result = await validateAddon(process.cwd(), options);
  if (result.valid) {
    s.stop('Validation passed.');
    p.outro(result.message);
    return { exitCode: 0 };
  }
  s.stop('Validation failed.');
  if (result.errors.length > 0) {
    p.log.error(
      `Errors:\n${result.errors.map((e: string) => `  \u2022 ${e}`).join('\n')}`,
    );
  }
  if (result.warnings.length > 0) {
    p.log.warn(
      `Warnings:\n${result.warnings.map((w: string) => `  \u2022 ${w}`).join('\n')}`,
    );
  }
  return { exitCode: 1, error: result.message };
}
