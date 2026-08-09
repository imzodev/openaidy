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
  | 'number'
  | 'boolean'
  | 'function'
  | 'array'
  | 'element'
  | 'optional_string'
  | 'optional_object'
  | 'optional_number'
  | 'optional_boolean'
  | 'optional_function'
  | 'optional_array'
  | 'optional_element';

export type SdkParam = {
  readonly name: string;
  readonly kind: SdkParamKind;
  readonly description: string;
};

export type SdkMethod = {
  readonly name: string;
  readonly category: string;
  /**
   * Server proxy path for methods that make a round-trip (`/api/addon-proxy/...`).
   * Omitted for pure client-side DOM builders (category 'UI') — they never
   * touch the network, so there is no proxy path or HTTP method to document.
   */
  readonly proxyPath?: string;
  readonly httpMethod?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
      {
        name: 'attachmentIds',
        kind: 'optional_array',
        description:
          'IDs returned by attachFile() to include as media on this message',
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
    name: 'attachFile',
    category: 'Sessions',
    proxyPath: '/api/addon-proxy/sessions/:sessionId/attachments',
    httpMethod: 'POST',
    requiredPermission: 'sessions.write',
    params: [
      {
        name: 'sessionId',
        kind: 'string',
        description: 'ID of the session to attach the file to',
      },
      {
        name: 'file',
        kind: 'object',
        description:
          '{ mimeType, data (base64), name? } — image/audio/video only',
      },
    ],
    returns: 'Promise<{ id: string; mimeType: string; sizeBytes: number }>',
    description:
      'Upload an image/audio/video file for this session. The attachment is ' +
      'unlinked until its id is passed in attachmentIds on a sendMessage call — ' +
      'that is what makes it visible to the LLM (vision/audio-capable models only).',
    exampleJs:
      "sdk.attachFile('sess-123', { mimeType: 'image/png', data: base64Png }).then(function(a) { return sdk.sendMessage('sess-123', 'What is this?', 'default', [a.id]); });",
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
  {
    name: 'shareFile',
    category: 'Agents',
    proxyPath: '/api/addon-proxy/workspace/:agentId/files',
    httpMethod: 'POST',
    requiredPermission: 'workspace.write',
    params: [
      {
        name: 'agentId',
        kind: 'string',
        description: 'ID of the agent whose workspace should receive the file',
      },
      {
        name: 'file',
        kind: 'object',
        description:
          '{ path, data (base64) } — any file type, e.g. csv/txt/json',
      },
    ],
    returns: 'Promise<{ agentId: string; path: string }>',
    description:
      "Write a file into an agent's workspace. The agent reads it back with " +
      'its own workspace_read/workspace_list tools — nothing is inlined into ' +
      'the LLM context automatically. Use attachFile() instead for images/audio ' +
      'you want the LLM to see inline.',
    exampleJs:
      "sdk.shareFile('my-agent', { path: 'shared/report.csv', data: base64Csv });",
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

  // ── Media (microphone / camera) ─────────────────────────────────────────
  // No proxyPath/httpMethod — these never hit /api/addon-proxy/*. The addon
  // iframe's opaque origin can't hold a persistent browser media permission,
  // so the host captures on the addon's behalf over the postMessage bridge
  // and hands back the result.
  {
    name: 'media.recordAudio',
    category: 'Media',
    requiredPermission: 'media.read',
    params: [
      {
        name: 'opts',
        kind: 'optional_object',
        description:
          '{ maxSeconds?, lang? } — recording stops automatically after maxSeconds (default 30, capped at 600 by the host); lang (e.g. "es-MX") sets the transcription language, defaulting to the browser\'s own language',
      },
    ],
    returns:
      'Promise<{ data: string; mimeType: string; durationMs: number; transcript: string | null }>',
    description:
      "Record audio from the user's microphone. The host shows a visible " +
      'recording indicator with a Stop control; recording also ends early ' +
      'if the user clicks it or the addon calls stopRecording(). `data` is ' +
      'base64-encoded, no `data:` URL prefix. `transcript` is a best-effort ' +
      "live transcription from the browser's own Web Speech API — a native " +
      'web API, not an LLM call — so an agent asked to structure a voice ' +
      'note only ever needs text; `null` if the browser lacks Web Speech ' +
      'support or nothing was recognized. Also accepts the scoped ' +
      'permission `media.read:microphone`.',
    exampleJs:
      'sdk.media.recordAudio({ maxSeconds: 15 }).then(function(r) { console.log(r.transcript); });',
  },
  {
    name: 'media.stopRecording',
    category: 'Media',
    params: [],
    returns: 'void',
    description:
      "End an in-progress recordAudio() early, e.g. the addon's own " +
      "'tap to stop' control — the host's own Stop indicator works " +
      'independently of this. The pending recordAudio() promise resolves ' +
      'normally with whatever was captured; a no-op if nothing is recording.',
    exampleJs: 'sdk.media.stopRecording();',
  },
  {
    name: 'media.takePhoto',
    category: 'Media',
    requiredPermission: 'media.read',
    params: [],
    returns:
      'Promise<{ data: string; mimeType: string; width: number; height: number }>',
    description:
      'Open a camera preview in the host and let the user capture a single ' +
      'photo. Rejects if the user cancels. `data` is base64-encoded, no ' +
      '`data:` URL prefix. Also accepts the scoped permission ' +
      '`media.read:camera`.',
    exampleJs:
      'sdk.media.takePhoto().then(function(p) { console.log(p.width, p.height); });',
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

  // ── Storage (per-addon SQLite) ────────────────────────────────────────────
  // Declare the schema in the manifest under `storage.migrations`. KV needs no
  // schema. Requires the `storage.read` / `storage.write` permissions.
  {
    name: 'storage.kv.get',
    category: 'Storage',
    proxyPath: '/api/addon-proxy/storage/kv/:key',
    httpMethod: 'GET',
    requiredPermission: 'storage.read',
    params: [{ name: 'key', kind: 'string', description: 'Key to read' }],
    returns: 'Promise<any>',
    description: 'Read a JSON value by key (resolves undefined if absent).',
    exampleJs:
      "sdk.storage.kv.get('prefs').then(function(v) { console.log(v); });",
  },
  {
    name: 'storage.kv.set',
    category: 'Storage',
    proxyPath: '/api/addon-proxy/storage/kv/:key',
    httpMethod: 'PATCH',
    requiredPermission: 'storage.write',
    params: [
      { name: 'key', kind: 'string', description: 'Key to write' },
      {
        name: 'value',
        kind: 'object',
        description: 'Any JSON-serializable value',
      },
    ],
    returns: 'Promise<{ ok: true }>',
    description: 'Write a JSON value by key.',
    exampleJs: "sdk.storage.kv.set('prefs', { theme: 'dark' });",
  },
  {
    name: 'storage.kv.list',
    category: 'Storage',
    proxyPath: '/api/addon-proxy/storage/kv',
    httpMethod: 'GET',
    requiredPermission: 'storage.read',
    params: [
      {
        name: 'prefix',
        kind: 'optional_string',
        description: 'Only return keys starting with this prefix',
      },
    ],
    returns: 'Promise<{ key: string; value: any }[]>',
    description: 'List key/value entries, optionally filtered by key prefix.',
    exampleJs:
      "sdk.storage.kv.list('note:').then(function(items) { console.log(items); });",
  },
  {
    name: 'storage.kv.delete',
    category: 'Storage',
    proxyPath: '/api/addon-proxy/storage/kv/:key',
    httpMethod: 'DELETE',
    requiredPermission: 'storage.write',
    params: [{ name: 'key', kind: 'string', description: 'Key to delete' }],
    returns: 'Promise<boolean>',
    description: 'Delete a key; resolves true if a row was removed.',
    exampleJs: "sdk.storage.kv.delete('prefs');",
  },
  {
    name: 'storage.query',
    category: 'Storage',
    proxyPath: '/api/addon-proxy/storage/query',
    httpMethod: 'POST',
    requiredPermission: 'storage.read',
    params: [
      { name: 'sql', kind: 'string', description: 'A SELECT statement' },
      {
        name: 'params',
        kind: 'optional_object',
        description: 'Positional (array) or named (:name → object) parameters',
      },
    ],
    returns: 'Promise<object[]>',
    description:
      "Run a read query against the addon's own SQLite file; resolves row objects.",
    exampleJs:
      "sdk.storage.query('SELECT * FROM notes WHERE tag = ?', ['work']).then(function(rows) { console.log(rows); });",
  },
  {
    name: 'storage.exec',
    category: 'Storage',
    proxyPath: '/api/addon-proxy/storage/exec',
    httpMethod: 'POST',
    requiredPermission: 'storage.write',
    params: [
      {
        name: 'sql',
        kind: 'string',
        description: 'An INSERT/UPDATE/DELETE/CREATE statement',
      },
      {
        name: 'params',
        kind: 'optional_object',
        description: 'Positional (array) or named (:name → object) parameters',
      },
    ],
    returns: 'Promise<{ changes: number; lastInsertRowid: number }>',
    description: "Run a write statement against the addon's own SQLite file.",
    exampleJs:
      "sdk.storage.exec('INSERT INTO notes (title) VALUES (?)', ['Hello']);",
  },
  {
    name: 'storage.search',
    category: 'Storage',
    proxyPath: '/api/addon-proxy/storage/search',
    httpMethod: 'POST',
    requiredPermission: 'storage.read',
    params: [
      {
        name: 'table',
        kind: 'string',
        description: 'Name of a declared FTS5 virtual table',
      },
      { name: 'match', kind: 'string', description: 'FTS5 MATCH query' },
      {
        name: 'limit',
        kind: 'optional_number',
        description: 'Max rows (default 50)',
      },
    ],
    returns: 'Promise<object[]>',
    description: 'Full-text search over a declared FTS5 table.',
    exampleJs:
      "sdk.storage.search('notes_fts', 'vite').then(function(rows) { console.log(rows); });",
  },

  // ── UI (Tailwind-styled component library) ─────────────────────────────────
  // Pure client-side DOM builders — no proxyPath/httpMethod (no server
  // round-trip) and no requiredPermission (nothing to gate). Every entry
  // mirrors the @component JSDoc above the method in openaidy-sdk.js; see
  // GET /sdk/components.json for the machine-readable version of the same data.
  {
    name: 'ui.card',
    category: 'UI',
    params: [
      { name: 'title', kind: 'string', description: 'The card title' },
      {
        name: 'subtitle',
        kind: 'optional_string',
        description: 'Optional subtitle text',
      },
      {
        name: 'children',
        kind: 'optional_element',
        description:
          'Content to render inside the card (HTMLElement or string)',
      },
    ],
    returns: 'HTMLElement',
    description: 'A styled card container with a title and optional subtitle.',
    exampleJs: "sdk.ui.card({ title: 'Stats', subtitle: 'Last 7 days' });",
  },
  {
    name: 'ui.tabs',
    category: 'UI',
    params: [
      {
        name: 'tabs',
        kind: 'array',
        description: 'Array of { id, label, content: HTMLElement|string }',
      },
      {
        name: 'activeTab',
        kind: 'optional_string',
        description: 'id of the initially active tab (defaults to the first)',
      },
    ],
    returns: 'HTMLElement',
    description:
      'A tabbed panel with keyboard navigation (Left/Right arrow keys).',
    exampleJs:
      "sdk.ui.tabs({ tabs: [{ id: 'a', label: 'A', content: 'Tab A' }] });",
  },
  {
    name: 'ui.accordion',
    category: 'UI',
    params: [
      {
        name: 'items',
        kind: 'array',
        description: 'Array of { title, content: HTMLElement|string }',
      },
      {
        name: 'multiple',
        kind: 'optional_boolean',
        description: 'Allow more than one item open at once (default false)',
      },
    ],
    returns: 'HTMLElement',
    description: 'A vertically-stacked accordion of expandable items.',
    exampleJs:
      "sdk.ui.accordion({ items: [{ title: 'FAQ', content: '...' }] });",
  },
  {
    name: 'ui.separator',
    category: 'UI',
    params: [
      {
        name: 'orientation',
        kind: 'optional_string',
        description: '"horizontal" (default) or "vertical"',
      },
    ],
    returns: 'HTMLElement',
    description: 'A thin horizontal or vertical divider line.',
    exampleJs: 'sdk.ui.separator();',
  },
  {
    name: 'ui.button',
    category: 'UI',
    params: [
      { name: 'text', kind: 'string', description: 'Button label' },
      {
        name: 'variant',
        kind: 'optional_string',
        description: '"primary" (default), "secondary", "ghost", or "danger"',
      },
      {
        name: 'onClick',
        kind: 'optional_function',
        description: 'Click handler',
      },
      {
        name: 'loading',
        kind: 'optional_boolean',
        description: 'Show a spinner and disable the button',
      },
    ],
    returns: 'HTMLElement',
    description:
      'A clickable button with variants, sizes, an optional icon, and loading/disabled states.',
    exampleJs: "sdk.ui.button({ text: 'Save', onClick: function() {} });",
  },
  {
    name: 'ui.buttonGroup',
    category: 'UI',
    params: [
      {
        name: 'buttons',
        kind: 'array',
        description: 'Array of { text, variant, onClick }',
      },
      {
        name: 'orientation',
        kind: 'optional_string',
        description: '"horizontal" (default) or "vertical"',
      },
    ],
    returns: 'HTMLElement',
    description: 'A visually grouped set of buttons with shared borders.',
    exampleJs:
      "sdk.ui.buttonGroup({ buttons: [{ text: 'A' }, { text: 'B' }] });",
  },
  {
    name: 'ui.dropdownMenu',
    category: 'UI',
    params: [
      {
        name: 'trigger',
        kind: 'element',
        description: 'The element or label that opens the menu',
      },
      {
        name: 'items',
        kind: 'array',
        description: 'Array of { label, onClick, icon: HTMLElement|string }',
      },
    ],
    returns: 'HTMLElement',
    description:
      'A trigger button that opens a menu of clickable items; closes on outside click, item selection, or Escape.',
    exampleJs:
      "sdk.ui.dropdownMenu({ trigger: 'Actions', items: [{ label: 'Edit', onClick: function() {} }] });",
  },
  {
    name: 'ui.table',
    category: 'UI',
    params: [
      {
        name: 'columns',
        kind: 'array',
        description: 'Array of { key, label }',
      },
      { name: 'rows', kind: 'array', description: 'Array of row objects' },
      {
        name: 'onRowClick',
        kind: 'optional_function',
        description: 'Called with the row object when a row is clicked',
      },
    ],
    returns: 'HTMLElement',
    description:
      'A data table with an empty state and optional row-click handling.',
    exampleJs:
      "sdk.ui.table({ columns: [{ key: 'name', label: 'Name' }], rows: [{ name: 'Ada' }] });",
  },
  {
    name: 'ui.badge',
    category: 'UI',
    params: [
      { name: 'text', kind: 'string', description: 'Badge text' },
      {
        name: 'color',
        kind: 'optional_string',
        description: '"blue" (default), "green", "red", "gray", or "yellow"',
      },
    ],
    returns: 'HTMLElement',
    description: 'A small colored label for status/tags.',
    exampleJs: "sdk.ui.badge({ text: 'Active', color: 'green' });",
  },
  {
    name: 'ui.avatar',
    category: 'UI',
    params: [
      { name: 'src', kind: 'optional_string', description: 'Image URL' },
      {
        name: 'fallback',
        kind: 'optional_string',
        description:
          'Fallback text (e.g. initials) shown when there is no image',
      },
      {
        name: 'size',
        kind: 'optional_string',
        description: '"sm", "md" (default), or "lg"',
      },
    ],
    returns: 'HTMLElement',
    description:
      'A circular avatar image with a text fallback when no image loads.',
    exampleJs: "sdk.ui.avatar({ fallback: 'AB' });",
  },
  {
    name: 'ui.skeleton',
    category: 'UI',
    params: [
      {
        name: 'variant',
        kind: 'optional_string',
        description: '"text" (default, rounded bar), "circle", or "rect"',
      },
      { name: 'width', kind: 'optional_string', description: 'CSS width' },
      { name: 'height', kind: 'optional_string', description: 'CSS height' },
    ],
    returns: 'HTMLElement',
    description: 'A pulsing placeholder shown while content is loading.',
    exampleJs: "sdk.ui.skeleton({ variant: 'circle', width: '2.5rem' });",
  },
  {
    name: 'ui.breadcrumb',
    category: 'UI',
    params: [
      {
        name: 'items',
        kind: 'array',
        description: 'Array of { label, href, onClick }',
      },
    ],
    returns: 'HTMLElement',
    description: 'A breadcrumb trail of navigation items.',
    exampleJs: "sdk.ui.breadcrumb({ items: [{ label: 'Home', href: '/' }] });",
  },
  {
    name: 'ui.toast',
    category: 'UI',
    params: [
      { name: 'message', kind: 'string', description: 'Toast message' },
      {
        name: 'type',
        kind: 'optional_string',
        description: '"info" (default), "success", "error", or "warning"',
      },
      {
        name: 'duration',
        kind: 'optional_number',
        description: 'Auto-dismiss delay in ms (default 4000; 0 disables)',
      },
    ],
    returns: 'HTMLElement',
    description:
      'Shows a transient stacked notification in the top-right corner; auto-dismisses after `duration`.',
    exampleJs: "sdk.ui.toast({ message: 'Saved!', type: 'success' });",
  },
  {
    name: 'ui.alert',
    category: 'UI',
    params: [
      { name: 'message', kind: 'string', description: 'Alert message' },
      {
        name: 'variant',
        kind: 'optional_string',
        description: '"info" (default), "success", "warning", or "error"',
      },
      {
        name: 'dismissible',
        kind: 'optional_boolean',
        description: 'Show a close button that removes the alert',
      },
    ],
    returns: 'HTMLElement',
    description:
      'An inline banner for important messages, with an optional dismiss button.',
    exampleJs:
      "sdk.ui.alert({ message: 'Something needs attention', variant: 'warning' });",
  },
  {
    name: 'ui.dialog',
    category: 'UI',
    params: [
      { name: 'title', kind: 'string', description: 'Dialog title' },
      {
        name: 'content',
        kind: 'element',
        description: 'Dialog body content (HTMLElement or string)',
      },
      {
        name: 'buttons',
        kind: 'optional_array',
        description:
          'Array of { text, variant, onClick } rendered in the footer',
      },
      {
        name: 'onClose',
        kind: 'optional_function',
        description: 'Called when the dialog is dismissed (any method)',
      },
    ],
    returns: 'HTMLElement',
    description:
      'A focus-trapped modal dialog with a backdrop; closes on Escape, backdrop click, or Cancel/close.',
    exampleJs:
      "sdk.ui.dialog({ title: 'Confirm', content: 'Are you sure?', buttons: [{ text: 'OK' }] });",
  },
  {
    name: 'ui.tooltip',
    category: 'UI',
    params: [
      { name: 'content', kind: 'string', description: 'Tooltip text' },
      {
        name: 'children',
        kind: 'element',
        description: 'The element the tooltip is attached to',
      },
      {
        name: 'position',
        kind: 'optional_string',
        description: '"top" (default), "bottom", "left", or "right"',
      },
    ],
    returns: 'HTMLElement',
    description:
      'Wraps `children` with a hover/focus-triggered tooltip bubble.',
    exampleJs:
      "sdk.ui.tooltip({ content: 'More info', children: sdk.ui.button({ text: '?' }) });",
  },
  {
    name: 'ui.input',
    category: 'UI',
    params: [
      { name: 'label', kind: 'optional_string', description: 'Label text' },
      {
        name: 'placeholder',
        kind: 'optional_string',
        description: 'Placeholder text',
      },
      {
        name: 'onChange',
        kind: 'optional_function',
        description: 'Called with the new string value on every input event',
      },
    ],
    returns: 'HTMLElement',
    description: 'A labeled text input.',
    exampleJs: "sdk.ui.input({ label: 'Name', onChange: function(v) {} });",
  },
  {
    name: 'ui.textarea',
    category: 'UI',
    params: [
      { name: 'label', kind: 'optional_string', description: 'Label text' },
      {
        name: 'rows',
        kind: 'optional_number',
        description: 'Visible rows (default 3)',
      },
      {
        name: 'onChange',
        kind: 'optional_function',
        description: 'Called with the new string value on every input event',
      },
    ],
    returns: 'HTMLElement',
    description: 'A labeled multi-line text input.',
    exampleJs: "sdk.ui.textarea({ label: 'Notes' });",
  },
  {
    name: 'ui.select',
    category: 'UI',
    params: [
      { name: 'label', kind: 'optional_string', description: 'Label text' },
      {
        name: 'options',
        kind: 'array',
        description: 'Array of { value, label }',
      },
      {
        name: 'onChange',
        kind: 'optional_function',
        description: 'Called with the new string value on change',
      },
    ],
    returns: 'HTMLElement',
    description: 'A labeled dropdown select.',
    exampleJs:
      "sdk.ui.select({ label: 'Sort', options: [{ value: 'asc', label: 'Ascending' }] });",
  },
  {
    name: 'ui.switch',
    category: 'UI',
    params: [
      {
        name: 'checked',
        kind: 'optional_boolean',
        description: 'Initial checked state',
      },
      { name: 'label', kind: 'optional_string', description: 'Label text' },
      {
        name: 'onChange',
        kind: 'optional_function',
        description: 'Called with the new boolean state on toggle',
      },
    ],
    returns: 'HTMLElement',
    description: 'An accessible toggle switch (role="switch").',
    exampleJs: "sdk.ui.switch({ label: 'Enabled', onChange: function(v) {} });",
  },
  {
    name: 'ui.checkbox',
    category: 'UI',
    params: [
      {
        name: 'checked',
        kind: 'optional_boolean',
        description: 'Initial checked state',
      },
      { name: 'label', kind: 'optional_string', description: 'Label text' },
      {
        name: 'onChange',
        kind: 'optional_function',
        description: 'Called with the new boolean state on change',
      },
    ],
    returns: 'HTMLElement',
    description: 'A native checkbox with a label.',
    exampleJs: "sdk.ui.checkbox({ label: 'Accept terms' });",
  },
  {
    name: 'ui.radioGroup',
    category: 'UI',
    params: [
      {
        name: 'name',
        kind: 'string',
        description: 'Shared name attribute for the group',
      },
      {
        name: 'options',
        kind: 'array',
        description: 'Array of { value, label }',
      },
      {
        name: 'onChange',
        kind: 'optional_function',
        description: 'Called with the new string value on change',
      },
    ],
    returns: 'HTMLElement',
    description: 'A group of mutually-exclusive radio buttons.',
    exampleJs:
      "sdk.ui.radioGroup({ name: 'plan', options: [{ value: 'free', label: 'Free' }] });",
  },
  {
    name: 'ui.label',
    category: 'UI',
    params: [
      { name: 'text', kind: 'string', description: 'Label text' },
      {
        name: 'required',
        kind: 'optional_boolean',
        description: 'Show a red asterisk after the text',
      },
    ],
    returns: 'HTMLElement',
    description: 'A form label, with an optional required-field asterisk.',
    exampleJs: "sdk.ui.label({ text: 'Email', required: true });",
  },
  {
    name: 'ui.sheet',
    category: 'UI',
    params: [
      { name: 'title', kind: 'string', description: 'Sheet title' },
      {
        name: 'children',
        kind: 'element',
        description: 'Sheet body content (HTMLElement or string)',
      },
      {
        name: 'side',
        kind: 'optional_string',
        description: '"right" (default) or "left"',
      },
      {
        name: 'onClose',
        kind: 'optional_function',
        description: 'Called when the sheet is dismissed',
      },
    ],
    returns: 'HTMLElement',
    description:
      'A focus-trapped panel that slides in from a screen edge; closes on Escape, backdrop click, or close button.',
    exampleJs: "sdk.ui.sheet({ title: 'Details', children: 'Body content' });",
  },
  {
    name: 'ui.popover',
    category: 'UI',
    params: [
      {
        name: 'trigger',
        kind: 'element',
        description: 'The element that toggles the popover',
      },
      {
        name: 'content',
        kind: 'element',
        description: 'Popover body content (HTMLElement or string)',
      },
      {
        name: 'onOpenChange',
        kind: 'optional_function',
        description: 'Called with the new boolean open state on toggle',
      },
    ],
    returns: 'HTMLElement',
    description:
      'An anchored popover that opens near its trigger; closes on outside click or Escape.',
    exampleJs:
      "sdk.ui.popover({ trigger: sdk.ui.button({ text: 'More' }), content: 'Popover body' });",
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

/**
 * Every distinct base (unscoped) permission string referenced by at least
 * one SDK method's `requiredPermission` — sorted, deduped. This is the
 * single source of truth for the "valid values" hint shown in
 * addon_create/addon_update's `permissions` parameter, so adding a new SDK
 * method's permission here updates both tool schemas automatically instead
 * of drifting out of sync with a hand-maintained list.
 */
export function listSdkPermissions(): string[] {
  const permissions = new Set<string>();
  for (const method of SDK_METHODS) {
    if (method.requiredPermission) permissions.add(method.requiredPermission);
  }
  return [...permissions].sort();
}
