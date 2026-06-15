/**
 * OpenCode Go Provider Profile (Anthropic-compatible subset).
 *
 * Backed by the same OpenCode Go subscription as `opencode-go/`, but
 * routes requests through the Anthropic-compatible endpoint:
 *
 *   https://opencode.ai/zen/go/v1/messages
 *
 * The Go subscription splits its catalog across two endpoints based
 * on the upstream provider's native request format. This profile
 * covers the 5 models the OpenCode team routes through `/messages`:
 *   - MiniMax M3, MiniMax M2.7, MiniMax M2.5
 *   - Qwen3.7 Max, Qwen3.7 Plus, Qwen3.6 Plus
 *
 * Auth is identical to the OpenAI-compatible side: a single Bearer
 * API key from the same OpenCode Go subscription.
 *
 * Splitting the catalog into two profiles (rather than one
 * `apiMode: 'custom'` profile with a per-model router) lets
 * openaidy's existing adapter dispatch by `apiMode` with zero
 * special-casing.
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` — the single source of truth.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'opencode-go-anthropic');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'opencode-go-anthropic' entry — keep shared-types and providers in sync.",
  );
}

export class OpenCodeGoAnthropicProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        signupUrl: 'https://opencode.ai/auth',
        aliases: ['opencode-go-anthropic', 'oc-go-anthropic'],
      }),
    );
  }

  /**
   * OpenCode Go is API-key-only (same subscription as the OpenAI-
   * compatible sibling). No OAuth / device code flow is exposed by
   * OpenCode, so we restrict the auth methods explicitly to keep the
   * UI honest.
   */
  getAvailableAuthMethods(): import('@openaidy/shared-types').AuthMethod[] {
    return [{ type: 'api_key', label: 'API Key' }];
  }
}
