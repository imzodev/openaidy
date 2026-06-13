/**
 * Google/Gemini Provider Profile
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` (in `@openaidy/shared-types`) — the single
 * source of truth. Handles Google Gemini API requests using the
 * gemini vendor family.
 *
 * The default `validateApiKey` would `GET ${baseUrl}/models` with
 * `Authorization: Bearer <key>`, but the Gemini API rejects that
 * and expects the key as either a `?key=` query parameter or an
 * `x-goog-api-key` header. Override the method to match Google's
 * auth scheme.
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

  override async validateApiKey(
    apiKey: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/models`, {
        headers: {
          'x-goog-api-key': apiKey,
        },
      });
      return { valid: response.ok };
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  }
}
