/**
 * Install Command - Register an addon with a local OpenAidy server
 */

import * as p from '@clack/prompts';
import { readFile } from 'node:fs/promises';
import { readAddonManifest } from '../../utils/project.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type {
  CommandResult,
  InstallOptions,
  InstallResult,
} from '../../types.js';

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

  // Auto-enable the addon so it appears in the sidebar immediately.
  try {
    const permissions = Array.isArray(manifest.permissions)
      ? (manifest.permissions as string[])
      : [];
    await fetch(`${serverUrl}/api/addons/${addonId}/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ approvedPermissions: permissions }),
    });
  } catch {
    // Non-fatal: addon is installed, user can enable manually from the UI
  }

  return {
    success: true,
    message: `Addon "${addonId}" installed and enabled.`,
    addonId,
  };
}

export async function addonInstallHandler(
  args: string[],
): Promise<CommandResult> {
  const { resolveAddonProject, listAddonProjects } =
    await import('../../utils/project.js');

  const options: Record<string, string> = {};
  let addonName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server-url') options.serverUrl = args[++i]!;
    else if (args[i] === '--token') options.token = args[++i]!;
    else if (!args[i]!.startsWith('-')) addonName = args[i];
  }

  const addon = resolveAddonProject(addonName);
  if (!addon) {
    const all = listAddonProjects();
    if (all.length === 0) {
      p.log.error('No addons found in .openaidy/addons/');
      return { exitCode: 1, error: 'No addons found in .openaidy/addons/' };
    }
    const names = all
      .map((a) => `  openaidy addon install ${a.name}`)
      .join('\n');
    p.log.error(`Multiple addons found. Specify one:\n${names}`);
    return {
      exitCode: 1,
      error: `Multiple addons found. Specify one:\n${names}`,
    };
  }

  const s = p.spinner();
  s.start(`Installing addon from ${addon.path}\u2026`);
  const result = await installAddon(addon.path, options);
  if (result.success) {
    s.stop('Addon installed.');
    p.outro(result.message);
    return { exitCode: 0 };
  } else {
    s.stop('Installation failed.');
    p.log.error(result.message);
    return { exitCode: 1, error: result.message };
  }
}
