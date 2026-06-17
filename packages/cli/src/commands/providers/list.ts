/**
 * Providers List Command Handler
 *
 * Implements `openaidy providers list` command.
 * Uses GET /config API to list configured providers.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';
import { PROVIDER_PRESETS } from '@openaidy/shared-types';

interface AppConfig {
  version: number;
  defaults: {
    providerId?: string;
    modelId?: string;
  };
  providers: ProviderConfig[];
  agents: unknown[];
}

interface ProviderConfig {
  id: string;
  name: string;
  vendorFamily: string;
  enabled?: boolean;
  baseUrl?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  models: unknown[];
}

/**
 * Fetch current config from server
 */
async function fetchConfig(
  token: string,
  httpUrl: string,
): Promise<{ config: AppConfig }> {
  const response = await fetch(`${httpUrl}/config`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch config: ${response.statusText}`);
  }
  return response.json();
}

export async function providersListHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers list [options]

List all available providers and their connection status.

Options:
  --connected    Show only connected providers
  --disconnected Show only disconnected providers

Examples:
  pnpm openaidy providers list
  pnpm openaidy providers list --connected

Exit Codes:
  0  Success
  1  Server unreachable or not authenticated`,
      'providers list',
    );
    return { exitCode: 0 };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const showConnected = args.includes('--connected');
  const showDisconnected = args.includes('--disconnected');

  const s = p.spinner();
  s.start('Fetching providers...');

  try {
    const { config: currentConfig } = await fetchConfig(
      token.token,
      config.httpUrl,
    );

    s.stop('Providers fetched');

    // Build list of all known providers with their status
    const allProviders = PROVIDER_PRESETS.map((preset) => {
      const configured = currentConfig.providers?.find(
        (pr) => pr.id === preset.id && pr.apiKeyEnv,
      );
      return {
        id: preset.id,
        name: preset.name,
        isConnected: !!configured?.apiKeyEnv,
        hasConfig: !!configured,
        baseUrl: preset.baseUrl,
      };
    });

    // Add any custom providers not in presets
    const customProviders = (currentConfig.providers || [])
      .filter((pr) => !PROVIDER_PRESETS.find((preset) => preset.id === pr.id))
      .map((pr) => ({
        id: pr.id,
        name: pr.name,
        isConnected: !!pr.apiKeyEnv,
        hasConfig: true,
        baseUrl: pr.baseUrl || 'N/A',
      }));

    let providers = [...allProviders, ...customProviders];

    // Filter based on flags
    if (showConnected) {
      providers = providers.filter((pr) => pr.isConnected);
    } else if (showDisconnected) {
      providers = providers.filter((pr) => !pr.isConnected);
    }

    if (providers.length === 0) {
      p.log.info('No providers found.');
      return { exitCode: 0 };
    }

    // Display providers in a table format
    p.log.info('\nAvailable Providers:\n');

    const rows: string[] = [];
    rows.push(['ID', 'Name', 'Status'].join(' | '));
    rows.push(['---', '---', '---'].join(' | '));

    for (const provider of providers) {
      const status = provider.isConnected
        ? '✓ Connected'
        : provider.hasConfig
          ? '○ Configured (no key)'
          : '○ Not configured';
      rows.push(
        [
          provider.id.substring(0, 12),
          (provider.name || provider.id).substring(0, 18),
          status,
        ].join(' | '),
      );
    }

    p.log.info(rows.join('\n'));
    p.log.info('');

    return { exitCode: 0 };
  } catch (error) {
    s.stop('Failed to fetch providers');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
    return { exitCode: 1, error: message };
  }
}
