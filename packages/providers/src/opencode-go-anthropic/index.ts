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
 * covers the 6 models the OpenCode team routes through `/messages`:
 *   - MiniMax M3, MiniMax M2.7, MiniMax M2.5
 *   - Qwen3.7 Max, Qwen3.7 Plus, Qwen3.6 Plus
 *
 * Auth is identical to the OpenAI-compatible side: a single Bearer
 * API key from the same OpenCode Go subscription.
 *
 * Visibility model: in the UI, all 13 models (this subset + the 8
 * openai-compatible ones) surface under a single "OpenCode Go" card.
 * The frontend re-maps the `providerId` to `opencode-go-anthropic`
 * when the user picks one of the models in
 * `OPENCODE_GO_ANTHROPIC_MODEL_IDS`. This profile is registered in
 * the provider registry so the chat adapter can route those
 * requests to `/messages` with the Anthropic request format.
 *
 * Model list is read from the hidden `OPENCODE_GO_ANTHROPIC_PRESET`
 * (defined alongside `PROVIDER_PRESETS` in `@openaidy/shared-types`).
 * It is deliberately excluded from the visible `PROVIDER_PRESETS`
 * array so the UI doesn't render two separate "OpenCode Go" cards.
 */

import {
  OPENCODE_GO_ANTHROPIC_PRESET,
  type AuthMethod,
} from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

export class OpenCodeGoAnthropicProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(OPENCODE_GO_ANTHROPIC_PRESET, {
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
  getAvailableAuthMethods(): AuthMethod[] {
    return [{ type: 'api_key', label: 'API Key' }];
  }
}
