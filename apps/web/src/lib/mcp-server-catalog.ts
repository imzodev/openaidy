/**
 * "How do I get an API key for this?" metadata for OpenAidy's preinstalled
 * MCP servers (config/openaidy.template.json), keyed by server `id`.
 *
 * This is intentionally frontend-only, static data — not part of
 * McpServerConfig/McpServerRecord. The backend has no notion of "builtin vs.
 * user-added" server, and the builtin id set is small and known ahead of
 * time, so there's no real gain from threading this through the API/schema.
 * A server not in this catalog (any user-added one, or a preinstalled one
 * that needs no secret) simply gets no extra hint — the generic "paste your
 * API key" copy in McpsPage.tsx already covers that case.
 *
 * To add instructions for a new preinstalled server: add one entry here with
 * the same `id` used in config/openaidy.template.json. No other code needs
 * to change — McpsPage.tsx looks servers up by id and renders nothing extra
 * for ids that aren't present.
 */
export interface McpServerSetupInfo {
  /** Where to actually go get the key/token. */
  setupUrl: string;
  /** One short sentence of context shown next to the link. */
  instructions: string;
}

export const MCP_SERVER_SETUP_CATALOG: Record<string, McpServerSetupInfo> = {
  github: {
    setupUrl: 'https://github.com/settings/tokens',
    instructions:
      'Create a personal access token with repo and read:user scopes.',
  },
  context7: {
    setupUrl: 'https://context7.com/dashboard',
    instructions:
      'Works without a key on the free tier; sign in for an API key to get higher rate limits.',
  },
  'brave-search': {
    setupUrl: 'https://brave.com/search/api/',
    instructions: 'Free tier available (~2,000 requests/month).',
  },
  tavily: {
    setupUrl: 'https://tavily.com/',
    instructions: 'Free tier available — sign up and copy your API key.',
  },
  buffer: {
    setupUrl: 'https://buffer.com/developers/api',
    instructions:
      'Generate a per-account API key from Buffer’s developer settings.',
  },
  supabase: {
    setupUrl: 'https://supabase.com/dashboard/account/tokens',
    instructions:
      'Generate a personal access token from your Supabase account settings.',
  },
  notion: {
    setupUrl: 'https://www.notion.so/my-integrations',
    instructions:
      'Create an internal integration, then share the pages/databases you want it to access from each page’s "Connections" menu.',
  },
};
