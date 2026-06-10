/**
 * Providers Disconnect Command Handler
 *
 * Implements `openaidy providers disconnect` command.
 * Calls DELETE /providers/:id/connection via the HTTP REST API.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

interface DisconnectResponse {
  success: boolean;
  error?: string;
}

/**
 * Disconnect from a provider
 */
async function disconnectProvider(
  providerId: string,
  token: string,
  httpUrl: string,
): Promise<DisconnectResponse> {
  const response = await fetch(
    `${httpUrl}/providers/${providerId}/connection`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  return response.json();
}

export async function providersDisconnectHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers disconnect <provider-id> [options]

Disconnect from a provider.

Arguments:
  provider-id    The provider to disconnect from (e.g., openai, anthropic)

Options:
  --help           Show this help message

Examples:
  pnpm openaidy providers disconnect openai

Exit Codes:
  0  Success
  1  Provider not connected or server error`,
      'providers disconnect',
    );
    return { exitCode: 0 };
  }

  const providerId = args[0];
  if (!providerId) {
    p.log.error('Provider ID is required.');
    p.log.info('Usage: openaidy providers disconnect <provider-id>');
    return { exitCode: 1, error: 'Provider ID is required' };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start(`Disconnecting from ${providerId}...`);

  try {
    const result = await disconnectProvider(
      providerId,
      token.token,
      config.httpUrl,
    );

    if (result.success) {
      s.stop(`Disconnected from ${providerId}`);
      p.log.success(`✓ Successfully disconnected from ${providerId}`);
      return { exitCode: 0 };
    } else {
      s.stop(`Failed to disconnect from ${providerId}`);
      p.log.error(
        `✗ Failed to disconnect: ${result.error || 'Provider not connected'}`,
      );
      return { exitCode: 1, error: result.error };
    }
  } catch (error) {
    s.stop(`Failed to disconnect from ${providerId}`);
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(`Failed to disconnect: ${message}`);
    return { exitCode: 1, error: message };
  }
}
