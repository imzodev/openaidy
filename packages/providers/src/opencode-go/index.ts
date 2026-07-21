/**
 * OpenCode Go Provider Profile (OpenAI-compatible subset).
 *
 * Backed by the OpenCode Go subscription — `$5` first month, then
 * `$10/month` — which exposes a curated set of open coding models
 * through an OpenAI-compatible endpoint:
 *
 *   https://opencode.ai/zen/go/v1/chat/completions
 *
 * Auth: Bearer API key (the same key used by the OpenCode CLI's
 * `/connect` flow). No OAuth, no device code — the subscription
 * itself is the auth boundary; the API key is long-lived.
 *
 * This profile covers the 8 models in the Go catalog that the
 * OpenCode team routes through `/chat/completions`:
 *   - GLM-5.1, GLM-5
 *   - Kimi K2.7 Code, Kimi K2.6
 *   - DeepSeek V4 Pro, DeepSeek V4 Flash
 *   - MiMo V2.5, MiMo V2.5 Pro
 *
 * The remaining 5 models (MiniMax M3 / M2.7 / M2.5 and the Qwen
 * family) are served through a separate Anthropic-compatible
 * endpoint and live in `opencode-go-anthropic/index.ts`.
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` — the single source of truth.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'opencode-go');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'opencode-go' entry — keep shared-types and providers in sync.",
  );
}

export class OpenCodeGoProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        signupUrl: 'https://opencode.ai/auth',
        aliases: ['opencode-go', 'oc-go'],
      }),
    );
  }

  /**
   * OpenCode Go is API-key-only. The subscription itself is the auth
   * boundary; the API key is long-lived and there is no OAuth / device
   * code flow exposed by OpenCode. Override the base default
   * explicitly so the auth-methods endpoint and any future UI that
   * filters by `availableAuthMethods` never surfaces OAuth for this
   * provider.
   */
  getAvailableAuthMethods(): import('@openaidy/shared-types').AuthMethod[] {
    return [{ type: 'api_key', label: 'API Key' }];
  }
}
