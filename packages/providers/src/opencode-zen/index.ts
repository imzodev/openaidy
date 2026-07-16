/**
 * OpenCode Zen Provider Profile — free tier models.
 *
 * Backed by OpenCode Zen's free-tier catalog. The user signs up at
 * opencode.ai/zen, adds billing (required to get an API key), and
 * receives a long-lived API key. No OAuth / device code — the API key
 * is the auth boundary.
 *
 * Endpoint: https://opencode.ai/zen/v1/chat/completions
 * (OpenAI-compatible — no format translation needed.)
 *
 * Only free-tier models are included here (mimo-v2.5-free,
 * north-mini-code-free, nemotron-3-ultra-free, deepseek-v4-flash-free).
 * The full Zen catalog (GPT-5, Claude, Gemini, DeepSeek V4 Pro, etc.)
 * requires a paid plan and is available through OpenCode Go instead.
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` — the single source of truth.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'opencode-zen');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'opencode-zen' entry — keep shared-types and providers in sync.",
  );
}

export class OpenCodeZenProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        signupUrl: 'https://opencode.ai/zen',
        aliases: ['opencode-zen', 'openai-zen'],
      }),
    );
  }

  /**
   * OpenCode Zen is API-key-only. No OAuth or device code flow is
   * exposed by the Zen gateway. Restrict to api_key so the UI never
   * surfaces OAuth for this provider.
   */
  getAvailableAuthMethods(): import('@openaidy/shared-types').AuthMethod[] {
    return [{ type: 'api_key', label: 'API Key' }];
  }
}
