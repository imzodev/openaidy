/**
 * Groq Provider Profile
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` (in `@openaidy/shared-types`) — the single
 * source of truth. Simple OpenAI-compatible provider with fast
 * inference. No special hooks needed — pure passthrough.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'groq');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'groq' entry — keep shared-types and providers in sync.",
  );
}

export class GroqProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        signupUrl: 'https://console.groq.com/',
      }),
    );
  }
}
