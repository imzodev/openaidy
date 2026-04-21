/**
 * Validation Utilities for Addon CLI
 */

import { ValidationResult } from '../types/cli.js';

/**
 * Validate addon ID format
 * Must be lowercase alphanumeric with hyphens
 */
export function validateAddonId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id) && id.length >= 2 && id.length <= 50;
}

/**
 * Validate addon name
 * Allows letters, numbers, spaces, and hyphens
 */
export function validateAddonName(name: string): boolean {
  return (
    /^[a-zA-Z0-9\s-]+$/.test(name) && name.length >= 2 && name.length <= 100
  );
}

/**
 * Validate semantic version format
 */
export function validateVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version);
}

/**
 * Validate addon manifest structure
 */
export function validateManifest(
  manifest: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  const requiredFields = ['id', 'name', 'version', 'description', 'openaidy'];
  for (const field of requiredFields) {
    if (!manifest[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate ID format
  if (manifest.id && typeof manifest.id === 'string') {
    if (!validateAddonId(manifest.id)) {
      errors.push(
        'Invalid addon ID format. Use lowercase letters, numbers, and hyphens.',
      );
    }
  }

  // Validate version format
  if (manifest.version && typeof manifest.version === 'string') {
    if (!validateVersion(manifest.version)) {
      errors.push(
        'Invalid version format. Use semantic versioning (e.g., 1.0.0)',
      );
    }
  }

  // Validate openaidy config
  if (manifest.openaidy && typeof manifest.openaidy === 'object') {
    const openaidy = manifest.openaidy as Record<string, unknown>;
    if (!openaidy.minVersion) {
      warnings.push('openaidy.minVersion not specified');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate file path for addon creation
 */
export function validateProjectPath(path: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!path) {
    errors.push('Project path cannot be empty');
  }

  if (path.includes('..')) {
    errors.push(
      'Project path cannot contain ".." to prevent directory traversal',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate template name
 */
export function validateTemplateName(template: string): boolean {
  const validTemplates = ['basic', 'agent', 'multi-page', 'config'];
  return validTemplates.includes(template);
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
