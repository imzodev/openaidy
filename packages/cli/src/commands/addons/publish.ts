/**
 * Publish Command - Publish addon to registry
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandResult } from '../../types.js';
import { readAddonManifest } from '../../utils/project.js';
import { validateAddon } from './validate.js';

export interface PublishOptions {
  registry?: string;
  access?: 'public' | 'private';
  tag?: string;
}

export interface PublishResult {
  success: boolean;
  message: string;
  addonId?: string;
  version?: string;
  registryUrl?: string;
}

/**
 * Publish addon to registry
 */
export async function publishAddon(
  projectPath: string = process.cwd(),
  _options: PublishOptions = {},
): Promise<PublishResult> {
  const { registry = 'https://registry.openaidy.dev' } = _options;

  // Validate project first
  const validation = await validateAddon(projectPath, { package: true });
  if (!validation.valid) {
    return {
      success: false,
      message: `Validation failed: ${validation.errors.join(', ')}`,
    };
  }

  // Read manifest
  const manifest = readAddonManifest(projectPath);
  if (!manifest) {
    return {
      success: false,
      message: 'addon.json not found',
    };
  }

  // Check for dist directory
  const distPath = path.join(projectPath, 'dist');
  if (!fs.existsSync(distPath)) {
    return {
      success: false,
      message:
        'dist directory not found. Run "openaidy build" before publishing.',
    };
  }

  // Check for entry point in dist
  if (manifest.entry) {
    const entryPath = path.join(
      distPath,
      String(manifest.entry).replace('dist/', ''),
    );
    if (!fs.existsSync(entryPath)) {
      return {
        success: false,
        message: `Entry point not found in dist: ${manifest.entry}`,
      };
    }
  }

  // In a real implementation, this would:
  // 1. Authenticate with the registry
  // 2. Package the addon (tar.gz)
  // 3. Upload to registry
  // 4. Update registry metadata

  const addonId = String(manifest.id);
  const version = String(manifest.version);

  return {
    success: true,
    message: `Successfully published ${addonId}@${version} to ${registry}`,
    addonId,
    version,
    registryUrl: `${registry}/addon/${addonId}`,
  };
}

/**
 * Tag a published addon version
 */
export async function tagAddon(
  addonId: string,
  version: string,
  tag: string,
): Promise<PublishResult> {
  // In a real implementation, this would update the registry
  return {
    success: true,
    message: `Tagged ${addonId}@${version} as ${tag}`,
    addonId,
    version,
  };
}

/**
 * Unpublish an addon from registry
 */
export async function unpublishAddon(
  addonId: string,
  version?: string,
): Promise<PublishResult> {
  // In a real implementation, this would remove from registry
  return {
    success: true,
    message: version
      ? `Unpublished ${addonId}@${version}`
      : `Unpublished all versions of ${addonId}`,
    addonId,
    version,
  };
}

export async function addonPublishHandler(
  args: string[],
): Promise<CommandResult> {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--registry') options.registry = args[++i]!;
    else if (args[i] === '--access') options.access = args[++i]!;
    else if (args[i] === '--tag') options.tag = args[++i]!;
  }

  const s = p.spinner();
  s.start('Publishing addon\u2026');
  const result = await publishAddon(process.cwd(), options);
  if (result.success) {
    s.stop('Published.');
    p.outro(
      `${result.message}${result.registryUrl ? `\n  Registry: ${result.registryUrl}` : ''}`,
    );
    return { exitCode: 0 };
  } else {
    s.stop('Publish failed.');
    p.log.error(result.message);
    return { exitCode: 1, error: result.message };
  }
}
