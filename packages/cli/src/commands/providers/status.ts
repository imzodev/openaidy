/**
 * Providers Status Command Handler
 *
 * Implements `openaidy providers status` command.
 * Shows connection status of all providers.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

interface ProviderInfo {
  id: string;
  displayName: string;
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

export async function providersStatusHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers status [options]

Show connection status of all providers.

Options:
  --help           Show this help message

Examples:
  pnpm openaidy providers status

Exit Codes:
  0  Success
  1  Server unreachable or not authenticated`,
      'providers status',
    );
    return { exitCode: 0 };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start('Fetching provider status...');

  try {
    const data = await fetchProviders(token.token, config.httpUrl);
    s.stop('Status fetched');

    const connected = data.providers.filter((p) => p.isConnected);
    const disconnected = data.providers.filter((p) => !p.isConnected);

    p.log.info('\nProvider Connection Status:\n');

    if (connected.length > 0) {
      p.log.success('Connected Providers:');
      for (const provider of connected) {
        p.log.success(
          `  ✓ ${provider.id} (${provider.displayName || provider.id})`,
        );
      }
      p.log.info('');
    }

    if (disconnected.length > 0) {
      p.log.warning('Disconnected Providers:');
      for (const provider of disconnected) {
        p.log.warning(
          `  ○ ${provider.id} (${provider.displayName || provider.id})`,
        );
      }
      p.log.info('');
    }

    if (connected.length === 0 && disconnected.length === 0) {
      p.log.info('No providers configured.');
    }

    return { exitCode: 0 };
  } catch (error) {
    s.stop('Failed to fetch status');
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
    return { exitCode: 1, error: message };
  }
}
