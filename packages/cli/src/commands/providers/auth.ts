/**
 * Providers Auth Command Handler
 *
 * Implements `openaidy providers auth` command.
 * Shows available authentication methods for a provider.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

interface AuthMethod {
  type: string;
  label: string;
  description?: string;
}

interface AuthMethodsResponse {
  providerId: string;
  authMethods: AuthMethod[];
}

/**
 * Fetch auth methods for a provider
 */
async function fetchAuthMethods(
  providerId: string,
  token: string,
  httpUrl: string,
): Promise<AuthMethodsResponse> {
  const response = await fetch(
    `${httpUrl}/providers/${providerId}/auth-methods`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch auth methods: ${response.statusText}`);
  }
  return response.json();
}

export async function providersAuthHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers auth <provider-id> [options]

Show available authentication methods for a provider.

Arguments:
  provider-id    The provider to check (e.g., openai, anthropic)

Options:
  --help           Show this help message

Examples:
  pnpm openaidy providers auth openai
  pnpm openaidy providers auth anthropic

Exit Codes:
  0  Success
  1  Provider not found or server error`,
      'providers auth',
    );
    return { exitCode: 0 };
  }

  const providerId = args[0];
  if (!providerId) {
    p.log.error('Provider ID is required.');
    p.log.info('Usage: openaidy providers auth <provider-id>');
    return { exitCode: 1, error: 'Provider ID is required' };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start(`Fetching auth methods for ${providerId}...`);

  try {
    const data = await fetchAuthMethods(
      providerId,
      token.token,
      config.httpUrl,
    );
    s.stop('Auth methods fetched');

    if (data.authMethods.length === 0) {
      p.log.info(
        `No authentication methods available for provider ${providerId}`,
      );
      return { exitCode: 0 };
    }

    p.log.info(`\nAuthentication methods for ${providerId}:\n`);

    for (const method of data.authMethods) {
      p.log.info(`  • ${method.type} - ${method.label}`);
      if (method.description) {
        p.log.info(`    ${method.description}`);
      }
    }
    p.log.info('');

    return { exitCode: 0 };
  } catch (error) {
    s.stop(`Failed to fetch auth methods for ${providerId}`);
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(message);
    return { exitCode: 1, error: message };
  }
}
