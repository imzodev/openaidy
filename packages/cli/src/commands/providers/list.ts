/**
 * Providers List Command Handler
 *
 * Implements `openaidy providers list` command.
 * Calls GET /providers/connection via the HTTP REST API.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

interface ProviderInfo {
  id: string;
  displayName: string;
  description?: string;
  availableAuthMethods: Array<{ type: string; label: string }>;
  isConnected: boolean;
}

interface ProvidersResponse {
  providers: ProviderInfo[];
}

/**
 * Fetch providers from the server
 */
async function fetchProviders(
  token: string,
  httpUrl: string,
): Promise<ProvidersResponse> {
  const response = await fetch(`${httpUrl}/providers/connection`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch providers: ${response.statusText}`);
  }
  return response.json();
}

export async function providersListHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers list [options]

List all available providers.

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
    const data = await fetchProviders(token.token, config.httpUrl);
    s.stop('Providers fetched');

    // Filter providers based on flags
    let providers = data.providers;
    if (showConnected) {
      providers = providers.filter((p) => p.isConnected);
    } else if (showDisconnected) {
      providers = providers.filter((p) => !p.isConnected);
    }

    if (providers.length === 0) {
      p.log.info('No providers found.');
      return { exitCode: 0 };
    }

    // Display providers in a table format
    p.log.info('\nAvailable Providers:\n');

    const rows: string[] = [];
    rows.push(['ID', 'Name', 'Auth Methods', 'Status'].join(' | '));
    rows.push(['---', '---', '---', '---'].join(' | '));

    for (const provider of providers) {
      const authMethods =
        provider.availableAuthMethods.map((m) => m.type).join(', ') || 'none';
      const status = provider.isConnected ? '✓ Connected' : '○ Not connected';
      rows.push(
        [
          provider.id.substring(0, 12),
          (provider.displayName || provider.id).substring(0, 18),
          authMethods.substring(0, 15),
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
