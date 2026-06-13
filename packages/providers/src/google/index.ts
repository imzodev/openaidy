/**
 * Google/Gemini Provider Profile
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` (in `@openaidy/shared-types`) — the single
 * source of truth. Handles Google Gemini API requests using the
 * gemini vendor family.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'google');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'google' entry — keep shared-types and providers in sync.",
  );
}

export class GoogleProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        aliases: ['gemini', 'google-gemini'],
        signupUrl: 'https://ai.google.dev/',
      }),
    );
  }
}
