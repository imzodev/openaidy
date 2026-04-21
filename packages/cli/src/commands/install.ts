/**
 * Install Command - Register a built addon with a local OpenAidy server
 */

import fs from 'node:fs';
import path from 'node:path';
import { readAddonManifest } from '../utils/project.js';

export interface InstallOptions {
  serverUrl?: string;
  token?: string;
}

export interface InstallResult {
  success: boolean;
  message: string;
  addonId?: string;
}

/**
 * Install (register) a built addon with the local OpenAidy server.
 *
 * Reads addon.json from the project directory and POSTs the manifest to
 * POST /api/addons. The server stores the addon record so it appears in
 * the Addons UI and can be enabled/disabled.
 */
export async function installAddon(
  projectPath: string = process.cwd(),
  options: InstallOptions = {},
): Promise<InstallResult> {
  const {
    serverUrl = process.env.OPENAIDY_SERVER_URL ?? 'http://localhost:3001',
    token = process.env.OPENAIDY_TOKEN ?? '',
  } = options;

  // Read manifest
  const manifest = readAddonManifest(projectPath);
  if (!manifest) {
    return {
      success: false,
      message: `addon.json not found in ${projectPath}. Run this command from your addon directory.`,
    };
  }

  // Require a built dist directory
  const distPath = path.join(projectPath, 'dist');
  if (!fs.existsSync(distPath)) {
    return {
      success: false,
      message:
        'dist/ not found. Run "pnpm openaidy addon build" first to compile the addon.',
    };
  }

  const addonId = String(manifest.id);

  // POST manifest to the server
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/addons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ manifest }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Could not reach server at ${serverUrl}: ${msg}\n  Set OPENAIDY_SERVER_URL if your server runs on a different port.`,
    };
  }

  if (response.status === 409) {
    return {
      success: false,
      message: `Addon "${addonId}" is already installed. Uninstall it first or bump the version.`,
    };
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: string };
      detail = body.message ?? '';
    } catch {
      // ignore
    }
    return {
      success: false,
      message: `Server returned ${response.status}${detail ? `: ${detail}` : ''}.`,
    };
  }

  return {
    success: true,
    message: `Addon "${addonId}" installed. Enable it in the Addons UI or run "openaidy addon enable ${addonId}".`,
    addonId,
  };
}
