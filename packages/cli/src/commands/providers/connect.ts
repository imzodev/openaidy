/**
 * Providers Connect Command Handler
 *
 * Implements `openaidy providers connect` command.
 * Uses GET/PUT /config API to store provider API keys in app config.
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
 * Connect to a provider with API key
 */
export async function providersConnectHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy providers connect <provider-id> [options]

Connect to a provider using an API key.

Arguments:
  provider-id    The provider to connect to (e.g., openai, anthropic, groq, deepseek)

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
  // Validate provider ID against presets
  const preset = PROVIDER_PRESETS.find((pr) => pr.id === providerId);
  if (!preset) {
    p.log.error(`Unknown provider: ${providerId}`);
    p.log.info(
      `Available providers: ${PROVIDER_PRESETS.map((pr) => pr.id).join(', ')}`,
    );
    return { exitCode: 1, error: `Unknown provider: ${providerId}` };
  }

  // Local providers (Ollama, LM Studio) ship no model list — it's host-specific
  // and discovered from the running server. The CLI connect flow would build a
  // config with an empty `models` array (and no API key), which the server's
  // config schema rejects. Direct the user to the UI, which has the discovery
  // step.
  if (preset.local) {
    p.log.error(
      `${preset.name} is a local provider — configure it in the OpenAidy UI.`,
    );
    p.log.info(
      `Open Settings → Providers → ${preset.name} → "Discover models", then Save. ` +
        'No API key is required.',
    );
    return {
      exitCode: 1,
      error: 'Local providers are configured via the UI, not the CLI',
    };
  }

  // Get API key from --api-key argument
  const apiKeyIndex = args.indexOf('--api-key');
  let apiKey: string | undefined;

  if (apiKeyIndex !== -1 && args[apiKeyIndex + 1]) {
    apiKey = args[apiKeyIndex + 1];
  }

  // Try to get from environment variable
  if (!apiKey) {
    apiKey = process.env.OPENAIDY_PROVIDER_API_KEY;
  }

  if (!apiKey) {
    p.log.error('API key is required.');
    p.log.info(
      'Provide it via --api-key argument or OPENAIDY_PROVIDER_API_KEY env var',
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
    // Fetch current config
    const { config: currentConfig } = await fetchConfig(
      token.token,
      config.httpUrl,
    );

    // Find or create provider entry
    const providers = [...(currentConfig.providers || [])];
    const existingIndex = providers.findIndex((pr) => pr.id === providerId);

    const providerEntry: ProviderConfig = {
      id: providerId,
      name: preset.name,
      vendorFamily: preset.vendorFamily,
      enabled: true,
      baseUrl: preset.baseUrl,
      apiKeyEnv: apiKey, // Store API key directly (misnamed as apiKeyEnv)
      defaultModel: preset.recommendedModel,
      models: preset.models.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        contextWindow: m.contextWindow,
      })),
    };

    if (existingIndex !== -1) {
      providers[existingIndex] = providerEntry;
    } else {
      providers.push(providerEntry);
    }

    // Update config
    const updatedConfig: AppConfig = {
      ...currentConfig,
      providers,
    };

    await updateConfig(updatedConfig, token.token, config.httpUrl);

    s.stop(`Connected to ${providerId}`);
    p.log.success(`✓ Successfully connected to ${providerId}`);
    return { exitCode: 0 };
  } catch (error) {
    s.stop(`Failed to connect to ${providerId}`);
    const message = error instanceof Error ? error.message : 'Unknown error';
    p.log.error(`Failed to connect: ${message}`);
    return { exitCode: 1, error: message };
  }
}
