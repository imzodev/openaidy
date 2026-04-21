/**
 * Install Command - Register a built addon with a local OpenAidy server
 */

import fs from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readAddonManifest } from '../utils/project.js';
import { resolveCLIConfig } from '../lib/config.js';

export interface InstallOptions {
  serverUrl?: string;
  token?: string;
}

export interface InstallResult {
  success: boolean;
  message: string;
  addonId?: string;
}

type BootstrapAdminRecord = { token: string };

async function readAdminToken(tokenPath: string): Promise<string | null> {
  try {
    const raw = await readFile(tokenPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BootstrapAdminRecord>;
    return parsed.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Install (register) a built addon with the local OpenAidy server.
 *
 * Reads addon.json from the project directory and POSTs the manifest to
 * POST /api/addons. Authenticates using the bootstrap-admin token from
 * .openaidy/credentials/bootstrap-admin.json (same as other CLI commands).
 */
export async function installAddon(
  projectPath: string = process.cwd(),
  options: InstallOptions = {},
): Promise<InstallResult> {
  const cliConfig = resolveCLIConfig();
  const serverUrl = options.serverUrl ?? cliConfig.httpUrl;
  const token =
    options.token ?? (await readAdminToken(cliConfig.tokenPath)) ?? '';

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
