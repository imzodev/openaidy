/**
 * Providers Connect Command Handler
 *
 * Implements `openaidy providers connect` command.
 * Calls POST /providers/:id/connect/api-key via the HTTP REST API.
 */

import * as p from '@clack/prompts';
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';
import type { CommandResult } from '../../types.js';

interface ConnectResponse {
  success: boolean;
  error?: string;
}

/**
 * Connect to a provider with API key
 */
async function connectProvider(
  providerId: string,
  apiKey: string,
  token: string,
  httpUrl: string,
): Promise<ConnectResponse> {
  const response = await fetch(
    `${httpUrl}/providers/${providerId}/connect/api-key`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apiKey }),
    },
  );
  return response.json();
}

export async function providersConnectHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers connect <provider-id> [options]

Connect to a provider using an API key.

Arguments:
  provider-id    The provider to connect to (e.g., openai, anthropic, deepseek)

Options:
  --api-key <key>  Your API key for the provider
  --help           Show this help message

Examples:
  pnpm openaidy providers connect openai --api-key sk-...
  PROVIDER_API_KEY=sk-... pnpm openaidy providers connect anthropic

Exit Codes:
  0  Success
  1  Provider not found, invalid API key, or server error`,
      'providers connect',
    );
    return { exitCode: 0 };
  }

  const providerId = args[0];
  if (!providerId) {
    p.log.error('Provider ID is required.');
    p.log.info(
      'Usage: openaidy providers connect <provider-id> [--api-key <key>]',
    );
    return { exitCode: 1, error: 'Provider ID is required' };
  }

  // Get API key from --api-key argument
  const apiKeyIndex = args.indexOf('--api-key');
  let apiKey: string | undefined;

  if (apiKeyIndex !== -1 && args[apiKeyIndex + 1]) {
    apiKey = args[apiKeyIndex + 1];
  }

  // Try to get from environment variable
  if (!apiKey) {
    apiKey = process.env.OPENAIFY_PROVIDER_API_KEY;
  }

  if (!apiKey) {
    p.log.error('API key is required.');
    p.log.info(
      'Provide it via --api-key argument or OPENAIFY_PROVIDER_API_KEY env var',
    );
    return { exitCode: 1, error: 'API key is required' };
  }

  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const s = p.spinner();
  s.start(`Connecting to ${providerId}...`);

  try {
    const result = await connectProvider(
      providerId,
      apiKey,
      token.token,
      config.httpUrl,
    );

    if (result.success) {
      s.stop(`Connected to ${providerId}`);
      p.log.success(`✓ Successfully connected to ${providerId}`);
      return { exitCode: 0 };
    } else {
      s.stop(`Failed to connect to ${providerId}`);
      p.log.error(`✗ Failed to connect: ${result.error || 'Unknown error'}`);
      return { exitCode: 1, error: result.error };
    }
  } catch (error) {
    s.stop(`Failed to connect to ${providerId}`);
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(`Failed to connect: ${message}`);
    return { exitCode: 1, error: message };
  }
}
