/**
 * Google/Gemini Provider Profile
 *
 * Handles Google Gemini API requests using the gemini vendor family.
 */

import { ProviderProfile } from '../types';

// ── GoogleProfile ───────────────────────────────────────────────────────────

export class GoogleProfile extends ProviderProfile {
  constructor() {
    super({
      id: 'google',
      name: 'Google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      aliases: ['gemini', 'google-gemini'],
      apiMode: 'gemini',
      vendorFamily: 'gemini',
      displayName: 'Google Gemini',
      description: 'Google Gemini models',
      signupUrl: 'https://ai.google.dev/',
      defaultModel: 'gemini-2.0-flash',
      models: [
        {
          id: 'gemini-2.0-flash',
          name: 'Gemini 2.0 Flash',
          capabilities: [
            'text_generation',
            'streaming',
            'tool_calls',
            'vision',
          ],
          contextWindow: 1_000_000,
          maxOutputTokens: 8_192,
        },
        {
          id: 'gemini-1.5-flash',
          name: 'Gemini 1.5 Flash',
          capabilities: [
            'text_generation',
            'streaming',
            'tool_calls',
            'vision',
          ],
          contextWindow: 1_000_000,
          maxOutputTokens: 8_192,
        },
      ],
    });
  }
}
