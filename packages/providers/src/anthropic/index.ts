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
 *
 * Anthropic is also the only profile that reports `oauth` as an
 * available auth method — "Sign in with Claude" lets a user connect
 * with their Pro/Max subscription instead of an API key. Unlike the
 * base class's `getOAuthAuthorizationUrl`/`exchangeOAuthCode` hooks,
 * the actual PKCE flow isn't driven through this profile: it needs
 * its own state-store + token-exchange orchestration (see
 * `apps/server/src/providers/oauth/anthropic.ts`), the same way
 * MiniMax's OAuth bypasses the generic connection-service path.
 */

import { PROVIDER_PRESETS, type AuthMethod } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Beta flag Anthropic requires on `/v1/messages` requests
 * authenticated with an OAuth access token (Bearer) instead of an
 * API key (`x-api-key`). Verified against the same public client_id
 * (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`) Claude Code's own CLI
 * uses — Anthropic hasn't published this for third-party use, so
 * re-verify if OAuth-authenticated requests start failing.
 */
export const ANTHROPIC_OAUTH_BETA_HEADER = 'oauth-2025-04-20';

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

  override getAvailableAuthMethods(): AuthMethod[] {
    return [
      { type: 'api_key', label: 'API Key' },
      { type: 'oauth', label: 'Sign in with Claude', method: 'code' },
    ];
  }
}
