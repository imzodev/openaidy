/**
 * Providers Disconnect Command Handler
 *
 * Implements `openaidy providers disconnect` command.
 * Uses GET/PUT /config API to remove provider API keys from app config.
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

/**
 * Update config on server
 */
async function updateConfig(
  config: AppConfig,
  token: string,
  httpUrl: string,
): Promise<{ config: AppConfig }> {
  const response = await fetch(`${httpUrl}/config`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error(`Failed to update config: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Disconnect from a provider
 */
export async function providersDisconnectHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers disconnect <provider-id> [options]

Disconnect from a provider (removes API key from config).

Arguments:
  provider-id    The provider to disconnect from (e.g., openai, anthropic, groq)

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

  // Validate provider ID against presets
  const preset = PROVIDER_PRESETS.find((pr) => pr.id === providerId);
  if (!preset) {
    p.log.error(`Unknown provider: ${providerId}`);
    p.log.info(
      `Available providers: ${PROVIDER_PRESETS.map((pr) => pr.id).join(', ')}`,
    );
    return { exitCode: 1, error: `Unknown provider: ${providerId}` };
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
    // Fetch current config
    const { config: currentConfig } = await fetchConfig(
      token.token,
      config.httpUrl,
    );

    // Find provider entry
    const providers = [...(currentConfig.providers || [])];
    const existingIndex = providers.findIndex((pr) => pr.id === providerId);

    if (existingIndex === -1 || !providers[existingIndex].apiKeyEnv) {
      s.stop(`Not connected to ${providerId}`);
      p.log.error(`✗ Provider ${providerId} is not connected`);
      return { exitCode: 1, error: 'Provider not connected' };
    }

    // Remove API key (set to empty string to keep provider config but remove key)
    providers[existingIndex] = {
      ...providers[existingIndex],
      apiKeyEnv: '',
    };

    // Update config
    const updatedConfig: AppConfig = {
      ...currentConfig,
      providers,
    };

    await updateConfig(updatedConfig, token.token, config.httpUrl);

    s.stop(`Disconnected from ${providerId}`);
    p.log.success(`✓ Successfully disconnected from ${providerId}`);
    return { exitCode: 0 };
  } catch (error) {
    s.stop(`Failed to disconnect from ${providerId}`);
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(`Failed to disconnect: ${message}`);
    return { exitCode: 1, error: message };
  }
}
