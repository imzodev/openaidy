/**
 * OpenAI Provider Profile
 *
 * Reads `id`, `name`, `baseUrl`, and the model list from
 * `PROVIDER_PRESETS` (in `@openaidy/shared-types`) — the single
 * source of truth. The default `validateApiKey` (a `GET /models`
 * probe with `Authorization: Bearer <key>`) works for OpenAI, so
 * no overrides are needed.
 */

import { PROVIDER_PRESETS } from '@openaidy/shared-types';
import { ProviderProfile } from '../types';

const PRESET = PROVIDER_PRESETS.find((p) => p.id === 'openai');
if (!PRESET) {
  throw new Error(
    "PROVIDER_PRESETS is missing the 'openai' entry — keep shared-types and providers in sync.",
  );
}

export class OpenAIProfile extends ProviderProfile {
  constructor() {
    super(
      ProviderProfile.fromPreset(PRESET!, {
        signupUrl: 'https://platform.openai.com/',
      }),
    );
  }
}
