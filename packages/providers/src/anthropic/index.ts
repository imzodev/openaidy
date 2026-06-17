/**
 * Anthropic Provider Profile
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` (in `@openaidy/shared-types`) — the single
 * source of truth.
 *
 * The default `validateApiKey` would `GET ${baseUrl}/models` with
 * `Authorization: Bearer <key>`, but Anthropic's `/v1/models`
 * endpoint rejects that and requires `x-api-key` +
 * `anthropic-version` headers instead. Override the method to
 * match the Anthropic auth scheme.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const ANTHROPIC_VERSION = '2023-06-01';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'anthropic');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'anthropic' entry — keep shared-types and providers in sync.",
  );
}

export class AnthropicProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        aliases: ['claude'],
        signupUrl: 'https://console.anthropic.com/',
        // `defaultHeaders` are merged into every request the chat
        // adapter makes. `anthropic-version` is required for the
        // Messages API; `x-api-key` is set per-request from the
        // resolved credential, so it doesn't go here.
        defaultHeaders: {
          'anthropic-version': ANTHROPIC_VERSION,
        },
      }),
    );
  }

  override async validateApiKey(
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      });
      return { valid: response.ok };
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  }
}
