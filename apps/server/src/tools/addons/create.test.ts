import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createAddonCreateTool } from './create.js';

describe('addon_create tool', () => {
  let addonsDir: string;
  let tool: ReturnType<typeof createAddonCreateTool>;

  const VALID_HTML = `<!DOCTYPE html><html><body><script src="/sdk/openaidy-sdk.js"></script><script src="index.js"></script></body></html>`;
  const VALID_JS = `window.parent.postMessage({ type: 'ADDON_READY' }, '*');
OpenAidy.ready(function(sdk) {});`;

  const VALID_ARGS = {
    id: 'my-addon',
    name: 'My Addon',
    description: 'A test addon',
    permissions: ['agents.list'],
    files: {
      'app/index.html': VALID_HTML,
      'app/index.js': VALID_JS,
    },
  };

  beforeEach(() => {
    addonsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-addons-'));
    tool = createAddonCreateTool({ addonsDir });
  });

  afterEach(() => {
    fs.rmSync(addonsDir, { recursive: true, force: true });
  });

  // ── Tool metadata ──────────────────────────────────────────────────────────

  it('has the correct name', () => {
    expect(tool.name).toBe('addon_create');
  });

  it('description embeds the SDK reference', () => {
    expect(tool.description).toContain('listAgents');
    expect(tool.description).toContain('invokeAgent');
    expect(tool.description).toContain('listSessions');
    expect(tool.description).toContain('sendMessage');
    expect(tool.description).toContain('getConfig');
  });

  it('description leads with the addon-routing guardrail', () => {
    // The agent must be told addons live outside the workspace and that this
    // tool is the only way to create them (issue #372).
    expect(tool.description).toContain('WHERE ADDONS LIVE');
    expect(tool.description).toContain('ONLY WAY TO CREATE');
    expect(tool.description).toContain('workspace_write');
    // Guardrail precedes the structural guidance.
    expect(tool.description.indexOf('WHERE ADDONS LIVE')).toBeLessThan(
      tool.description.indexOf('ADDON STRUCTURE'),
    );
  });

  it('catalog descriptions carry the addon-routing guardrail', async () => {
    const { addonCreateMeta, addonUpdateMeta } = await import('../catalog.js');
    expect(addonCreateMeta.description).toMatch(/never use workspace_write/i);
    expect(addonUpdateMeta.description).toMatch(/never use workspace_write/i);
  });

  it('description embeds the bootstrap code snippet verbatim', () => {
    expect(tool.description).toContain(
      "window.parent.postMessage({ type: 'ADDON_READY' }, '*');",
    );
    expect(tool.description).toContain('/sdk/openaidy-sdk.js');
    expect(tool.description).toContain('OpenAidy.ready(function(sdk)');
  });

  it('requires id, name, description, permissions, files', () => {
    const required = (tool.parameters as unknown as { required: string[] })
      .required;
    expect(required).toContain('id');
    expect(required).toContain('name');
    expect(required).toContain('description');
    expect(required).toContain('permissions');
    expect(required).toContain('files');
  });

  // ── Input validation ───────────────────────────────────────────────────────

  function expectError(
    result: Awaited<ReturnType<typeof tool.execute>>,
    pattern: RegExp,
  ): void {
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  }

  it('rejects missing id', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, id: '' },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /id is required/,
    );
  });

  it('rejects invalid id characters', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, id: 'My Addon!' },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /lowercase/,
    );
  });

  it('rejects missing name', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, name: '' },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /name is required/,
    );
  });

  it('rejects missing description', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, description: '' },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /description is required/,
    );
  });

  it('rejects non-array permissions', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, permissions: 'agents.list' },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /permissions/,
    );
  });

  it('rejects missing files', async () => {
    const { files: _f, ...noFiles } = VALID_ARGS;
    expectError(
      await tool.execute(noFiles, {
        agentId: 'agent',
        sessionId: 'test-session',
      }),
      /files is required/,
    );
  });

  it('rejects files missing app/index.html', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, files: { 'app/index.js': VALID_JS } },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /app\/index\.html/,
    );
  });

  it('rejects files missing app/index.js', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, files: { 'app/index.html': VALID_HTML } },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /app\/index\.js/,
    );
  });

  it('rejects app/index.html missing script tag', async () => {
    expectError(
      await tool.execute(
        {
          ...VALID_ARGS,
          files: {
            'app/index.html': '<html></html>',
            'app/index.js': VALID_JS,
          },
        },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /script src/,
    );
  });

  it('rejects app/index.html missing SDK script tag', async () => {
    expectError(
      await tool.execute(
        {
          ...VALID_ARGS,
          files: {
            'app/index.html':
              '<!DOCTYPE html><html><body><script src="index.js"></script></body></html>',
            'app/index.js': VALID_JS,
          },
        },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /sdk/i,
    );
  });

  it('rejects app/index.html with SDK after index.js', async () => {
    expectError(
      await tool.execute(
        {
          ...VALID_ARGS,
          files: {
            'app/index.html':
              '<!DOCTYPE html><html><body><script src="index.js"></script><script src="/sdk/openaidy-sdk.js"></script></body></html>',
            'app/index.js': VALID_JS,
          },
        },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /before/,
    );
  });

  it('rejects undeclared external fetch() domains', async () => {
    const jsWithFetch = `window.parent.postMessage({ type: 'ADDON_READY' }, '*');
OpenAidy.ready(function(sdk) {
  fetch('https://api.example.com/data').then(r => r.json());
});`;
    expectError(
      await tool.execute(
        {
          ...VALID_ARGS,
          files: { ...VALID_ARGS.files, 'app/index.js': jsWithFetch },
        },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /externalDomains/,
    );
  });

  it('accepts external fetch() when domain is declared in externalDomains', async () => {
    const jsWithFetch = `window.parent.postMessage({ type: 'ADDON_READY' }, '*');
OpenAidy.ready(function(sdk) {
  fetch('https://api.example.com/data').then(r => r.json());
});`;
    const result = await tool.execute(
      {
        ...VALID_ARGS,
        externalDomains: ['api.example.com'],
        files: { ...VALID_ARGS.files, 'app/index.js': jsWithFetch },
      },
      { agentId: 'agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects path traversal in extra files', async () => {
    const files = { ...VALID_ARGS.files, '../escape.js': 'bad' };
    expectError(
      await tool.execute(
        { ...VALID_ARGS, files },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /relative/i,
    );
  });

  it('rejects addon.json in files param', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, files: { ...VALID_ARGS.files, 'addon.json': '{}' } },
        { agentId: 'agent', sessionId: 'test-session' },
      ),
      /addon\.json/,
    );
  });

  it('rejects a duplicate addon id', async () => {
    await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    expectError(
      await tool.execute(VALID_ARGS, {
        agentId: 'agent',
        sessionId: 'test-session',
      }),
      /already exists/,
    );
  });

  // ── Successful creation (basic template — default) ─────────────────────────

  it('returns ok: true on success', async () => {
    const result = await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    expect(result.ok).toBe(true);
  });

  it('creates the addon directory', async () => {
    await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    expect(fs.existsSync(path.join(addonsDir, 'my-addon'))).toBe(true);
  });

  it('writes addon.json with correct structure', async () => {
    await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(addonsDir, 'my-addon', 'addon.json'), 'utf-8'),
    );
    expect(manifest.id).toBe('my-addon');
    expect(manifest.name).toBe('My Addon');
    expect(manifest.entry).toBe('app/index.html');
    expect(manifest.version).toBe('1.0.0');
  });

  it('writes app/index.html from files param (with Tailwind CDN auto-injected)', async () => {
    await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    const htmlPath = path.join(addonsDir, 'my-addon', 'app', 'index.html');
    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, 'utf-8');
    // The Tailwind <script> is injected right before the SDK script tag (see
    // 'auto-injects the Tailwind CDN script tag' below); everything else is
    // written verbatim.
    expect(html).toBe(
      VALID_HTML.replace(
        '<script src="/sdk/openaidy-sdk.js">',
        '<script src="https://cdn.tailwindcss.com"></script>\n  <script src="/sdk/openaidy-sdk.js">',
      ),
    );
  });

  it('auto-injects the Tailwind CDN script tag before the SDK script tag', async () => {
    await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    const htmlPath = path.join(addonsDir, 'my-addon', 'app', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    expect(html).toContain('<script src="https://cdn.tailwindcss.com">');
    expect(html.indexOf('cdn.tailwindcss.com')).toBeLessThan(
      html.indexOf('/sdk/openaidy-sdk.js'),
    );
  });

  it('does not duplicate the Tailwind tag if the agent already included it', async () => {
    const htmlWithTailwind = VALID_HTML.replace(
      '<script src="/sdk/openaidy-sdk.js">',
      '<script src="https://cdn.tailwindcss.com"></script><script src="/sdk/openaidy-sdk.js">',
    );
    await tool.execute(
      {
        ...VALID_ARGS,
        files: { ...VALID_ARGS.files, 'app/index.html': htmlWithTailwind },
      },
      { agentId: 'agent', sessionId: 'test-session' },
    );
    const htmlPath = path.join(addonsDir, 'my-addon', 'app', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    expect(html.match(/cdn\.tailwindcss\.com/g)?.length).toBe(1);
  });

  it('auto-adds cdn.tailwindcss.com to addon.json externalDomains', async () => {
    await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(addonsDir, 'my-addon', 'addon.json'), 'utf-8'),
    );
    expect(manifest.externalDomains).toContain('cdn.tailwindcss.com');
  });

  it('keeps agent-declared externalDomains alongside the auto-added Tailwind host', async () => {
    const jsWithFetch = `window.parent.postMessage({ type: 'ADDON_READY' }, '*');
OpenAidy.ready(function(sdk) {
  fetch('https://api.example.com/data').then(r => r.json());
});`;
    await tool.execute(
      {
        ...VALID_ARGS,
        externalDomains: ['api.example.com'],
        files: { ...VALID_ARGS.files, 'app/index.js': jsWithFetch },
      },
      { agentId: 'agent', sessionId: 'test-session' },
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(addonsDir, 'my-addon', 'addon.json'), 'utf-8'),
    );
    expect(manifest.externalDomains).toContain('api.example.com');
    expect(manifest.externalDomains).toContain('cdn.tailwindcss.com');
  });

  it('writes app/index.js from files param', async () => {
    await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    const jsPath = path.join(addonsDir, 'my-addon', 'app', 'index.js');
    expect(fs.existsSync(jsPath)).toBe(true);
    const js = fs.readFileSync(jsPath, 'utf-8');
    expect(js).toBe(VALID_JS);
  });

  it('writes additional files alongside required ones', async () => {
    const files = {
      ...VALID_ARGS.files,
      'app/styles.css': 'body { color: red; }',
    };
    await tool.execute(
      { ...VALID_ARGS, files },
      { agentId: 'agent', sessionId: 'test-session' },
    );
    const css = fs.readFileSync(
      path.join(addonsDir, 'my-addon', 'app', 'styles.css'),
      'utf-8',
    );
    expect(css).toBe('body { color: red; }');
  });

  it('success message lists template files', async () => {
    const result = await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('addon.json');
      expect(result.content).toContain('app/index.html');
      expect(result.content).toContain('app/index.js');
    }
  });

  it('success message includes usage hints for granted permissions', async () => {
    const result = await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('listAgents');
  });

  it('does not include hints for permissions not granted', async () => {
    const result = await tool.execute(
      { ...VALID_ARGS, permissions: ['agents.list'] },
      { agentId: 'agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).not.toContain('invokeAgent');
  });

  it('success note mentions DB not configured when addonService is absent', async () => {
    const result = await tool.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('openaidy addon install');
  });

  it('calls addonService.installAddon and enableAddon when provided', async () => {
    let installCalled = false;
    let enableCalled = false;
    const mockAddonService = {
      installAddon: async () => {
        installCalled = true;
        return { addon: {}, permissions: [], requiresApproval: false };
      },
      enableAddon: async () => {
        enableCalled = true;
        return { addon: {}, accessToken: 'tok' };
      },
    };
    const toolWithService = createAddonCreateTool({
      addonsDir,
      addonService: mockAddonService as never,
    });
    const result = await toolWithService.execute(VALID_ARGS, {
      agentId: 'agent',
      sessionId: 'test-session',
    });
    expect(result.ok).toBe(true);
    expect(installCalled).toBe(true);
    expect(enableCalled).toBe(true);
    if (result.ok) expect(result.content).toContain('Registered and enabled');
  });

  // ── Storage ────────────────────────────────────────────────────────────────

  it('declares a storage parameter and documents it', () => {
    const props = (
      tool.parameters as unknown as { properties: Record<string, unknown> }
    ).properties;
    expect(props.storage).toBeDefined();
    expect(tool.description).toContain('storage.migrations');
    expect(tool.description).toContain('agentQueries');
    expect(tool.description).toContain('sdk.storage');
  });

  it('merges the storage block into addon.json', async () => {
    const storage = {
      migrations: ['CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT)'],
      agentAccess: 'readwrite',
      agentQueries: [
        {
          name: 'add_note',
          description: 'Add a note',
          params: { title: 'string' },
          access: 'write',
          sql: 'INSERT INTO notes (title) VALUES (:title)',
        },
      ],
    };
    const result = await tool.execute(
      {
        ...VALID_ARGS,
        permissions: ['storage.read', 'storage.write'],
        storage,
      },
      { agentId: 'agent', sessionId: 'test-session' },
    );
    expect(result.ok).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(addonsDir, 'my-addon', 'addon.json'), 'utf-8'),
    );
    expect(manifest.storage).toEqual(storage);
  });
});

// ── sdk-reference integration ──────────────────────────────────────────────────

describe('sdk-reference', () => {
  it('every non-UI SDK_METHOD has a proxyPath starting with /api/addon-proxy/', async () => {
    const { SDK_METHODS } = await import('../../addons/sdk-reference.js');
    for (const method of SDK_METHODS) {
      if (method.name === 'request' || method.category === 'UI') continue;
      expect(method.proxyPath).toMatch(/^\/api\/addon-proxy\//);
    }
  });

  it('UI components have no proxyPath/httpMethod — pure client-side, no server round-trip', async () => {
    const { SDK_METHODS } = await import('../../addons/sdk-reference.js');
    const uiMethods = SDK_METHODS.filter((m) => m.category === 'UI');
    expect(uiMethods.length).toBe(25);
    for (const m of uiMethods) {
      expect(m.proxyPath).toBeUndefined();
      expect(m.httpMethod).toBeUndefined();
      expect(m.requiredPermission).toBeUndefined();
    }
  });

  it('renderSdkReference produces non-empty markdown', async () => {
    const { renderSdkReference } =
      await import('../../addons/sdk-reference.js');
    const ref = renderSdkReference();
    expect(ref.length).toBeGreaterThan(100);
    expect(ref).toContain('listAgents');
    expect(ref).toContain('Agents');
    expect(ref).toContain('Sessions');
  });

  it('documents the storage SDK methods', async () => {
    const { SDK_METHODS, renderSdkReference } =
      await import('../../addons/sdk-reference.js');
    const names = SDK_METHODS.map((m) => m.name);
    expect(names).toContain('storage.kv.get');
    expect(names).toContain('storage.query');
    expect(names).toContain('storage.search');
    expect(renderSdkReference()).toContain('Storage');
  });
});
