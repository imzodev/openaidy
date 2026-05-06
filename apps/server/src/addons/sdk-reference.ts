/**
 * Addon SDK Reference — Single Source of Truth
 *
 * This file describes every method exposed by `openaidy-sdk.js` to addon UIs.
 * It is the ONLY place where the SDK surface is documented in TypeScript.
 *
 * Consumer responsibilities:
 *  - `addon_create` tool   → imports SDK_METHODS to generate accurate docs in
 *                            its tool description and return value.
 *  - template-generator    → may import SDK_METHODS to auto-generate code
 *                            comments / stubs.
 *  - Any future introspection endpoint → reads SDK_METHODS directly.
 *
 * When you add a new method to openaidy-sdk.js:
 *  1. Add it here (one entry).
 *  2. That's it. All consumers update automatically.
 */

export type SdkParamKind =
  | 'string'
  | 'object'
  | 'optional_string'
  | 'optional_object';

export type SdkParam = {
  readonly name: string;
  readonly kind: SdkParamKind;
  readonly description: string;
};

export type SdkMethod = {
  readonly name: string;
  readonly category: string;
  readonly proxyPath: string;
  readonly httpMethod: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly requiredPermission?: string;
  readonly params: readonly SdkParam[];
  readonly returns: string;
  readonly description: string;
  readonly exampleJs: string;
};

export const SDK_METHODS: readonly SdkMethod[] = [
  // ── Sessions ─────────────────────────────────────────────────────────────
  {
    name: 'listSessions',
    category: 'Sessions',
    proxyPath: '/api/addon-proxy/sessions',
    httpMethod: 'GET',
    requiredPermission: 'sessions.list',
    params: [],
    returns: 'Promise<{ items: Session[] }>',
    description: 'List all sessions visible to this addon.',
    exampleJs:
      'sdk.listSessions().then(function(r) { console.log(r.items); });',
  },
  {
    name: 'sendMessage',
    category: 'Sessions',
    proxyPath: '/api/addon-proxy/sessions/:sessionId/messages',
    httpMethod: 'POST',
    requiredPermission: 'sessions.write',
    params: [
      {
        name: 'sessionId',
        kind: 'string',
        description: 'ID of the session to send the message to',
      },
      {
        name: 'content',
        kind: 'string',
        description: 'The message text to send',
      },
      {
        name: 'agentId',
        kind: 'string',
        description: 'ID of the agent that should respond',
      },
    ],
    returns: 'Promise<{ message: string; sessionId: string }>',
    description:
      'Send a message to an existing session and get the agent response. ' +
      'Sessions are created automatically by invokeAgent() — use sessions.list to pick one. ' +
      'Does NOT create a new session.',
    exampleJs:
      "sdk.sendMessage('sess-123', 'Summarize this', 'default').then(function(r) { console.log(r.message); });",
  },
  {
    name: 'getSession',
    category: 'Sessions',
    proxyPath: '/api/addon-proxy/sessions/:sessionId',
    httpMethod: 'GET',
    requiredPermission: 'sessions.read',
    params: [
      {
        name: 'sessionId',
        kind: 'string',
        description: 'ID of the session to fetch',
      },
    ],
    returns: 'Promise<Session>',
    description: 'Get a single session by ID.',
    exampleJs:
      "sdk.getSession('sess-123').then(function(s) { console.log(s); });",
  },

  // ── Agents ────────────────────────────────────────────────────────────────
  {
    name: 'listAgents',
    category: 'Agents',
    proxyPath: '/api/addon-proxy/agents',
    httpMethod: 'GET',
    requiredPermission: 'agents.list',
    params: [],
    returns: 'Promise<{ items: AgentSummary[] }>',
    description: 'List all enabled agents.',
    exampleJs: 'sdk.listAgents().then(function(r) { console.log(r.items); });',
  },
  {
    name: 'invokeAgent',
    category: 'Agents',
    proxyPath: '/api/addon-proxy/agents/:agentId/invoke',
    httpMethod: 'POST',
    requiredPermission: 'agents.invoke',
    params: [
      {
        name: 'agentId',
        kind: 'string',
        description: 'ID of the agent to invoke',
      },
      {
        name: 'input',
        kind: 'string',
        description: 'The prompt / user message to send',
      },
      {
        name: 'context',
        kind: 'optional_object',
        description: 'Optional context object passed to the agent',
      },
    ],
    returns: 'Promise<{ message: string; sessionId: string }>',
    description: 'Invoke an agent with a prompt and get a response.',
    exampleJs:
      "sdk.invokeAgent('my-agent', 'Hello!').then(function(r) { console.log(r.message); });",
  },

  // ── Config ────────────────────────────────────────────────────────────────
  {
    name: 'getConfig',
    category: 'Config',
    proxyPath: '/api/addon-proxy/config/:namespace',
    httpMethod: 'GET',
    requiredPermission: 'config.read',
    params: [
      {
        name: 'namespace',
        kind: 'optional_string',
        description: 'Config namespace (defaults to "default")',
      },
    ],
    returns: 'Promise<Record<string, unknown>>',
    description: "Get the addon's stored configuration for a namespace.",
    exampleJs: 'sdk.getConfig().then(function(cfg) { console.log(cfg); });',
  },

  // ── Raw escape hatch ──────────────────────────────────────────────────────
  {
    name: 'request',
    category: 'Raw',
    proxyPath: '/api/addon-proxy/*',
    httpMethod: 'GET',
    params: [
      {
        name: 'method',
        kind: 'string',
        description: 'HTTP method (GET, POST, PATCH, DELETE)',
      },
      {
        name: 'path',
        kind: 'string',
        description: 'Full path starting with /api/addon-proxy/',
      },
      {
        name: 'body',
        kind: 'optional_object',
        description: 'Optional request body',
      },
    ],
    returns: 'Promise<unknown>',
    description:
      'Low-level escape hatch for routes not covered by named methods.',
    exampleJs:
      "sdk.request('GET', '/api/addon-proxy/agents').then(function(r) { console.log(r); });",
  },
] as const;

/**
 * Returns a human-readable Markdown reference of all SDK methods,
 * grouped by category. Used in tool descriptions and docs generation.
 */
export function renderSdkReference(): string {
  const byCategory = new Map<string, SdkMethod[]>();
  for (const method of SDK_METHODS) {
    if (!byCategory.has(method.category)) byCategory.set(method.category, []);
    byCategory.get(method.category)!.push(method);
  }

  const lines: string[] = ['## OpenAidy Addon SDK Reference', ''];
  for (const [category, methods] of byCategory) {
    lines.push(`### ${category}`, '');
    for (const m of methods) {
      const paramList =
        m.params.length > 0
          ? m.params.map((p) => `${p.name}: ${p.kind}`).join(', ')
          : '';
      lines.push(`**\`${m.name}(${paramList})\`** → \`${m.returns}\``);
      lines.push(m.description);
      if (m.requiredPermission) {
        lines.push(`Requires permission: \`${m.requiredPermission}\``);
      }
      lines.push(`Example: \`${m.exampleJs}\``, '');
    }
  }
  return lines.join('\n');
}
