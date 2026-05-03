import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createAddonCreateTool } from './create.js';

describe('addon_create tool', () => {
  let addonsDir: string;
  let tool: ReturnType<typeof createAddonCreateTool>;

  const VALID_ARGS = {
    id: 'my-addon',
    name: 'My Addon',
    description: 'A test addon',
    permissions: ['agents.list'],
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
    expect(tool.description).toContain('createSession');
    expect(tool.description).toContain('getConfig');
  });

  it('description embeds the bootstrap code snippet verbatim', () => {
    expect(tool.description).toContain(
      "window.parent.postMessage({ type: 'ADDON_READY' }, '*');",
    );
    expect(tool.description).toContain("msg.type !== 'OPENAIDY_INIT'");
    expect(tool.description).toContain('/sdk/openaidy-sdk.js');
    expect(tool.description).toContain('onSdkReady(msg)');
    expect(tool.description).toContain('OpenAidy.ready(function(sdk)');
  });

  it('requires id, name, description, permissions', () => {
    const required = (tool.parameters as unknown as { required: string[] })
      .required;
    expect(required).toContain('id');
    expect(required).toContain('name');
    expect(required).toContain('description');
    expect(required).toContain('permissions');
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
      await tool.execute({ ...VALID_ARGS, id: '' }, { agentId: 'agent' }),
      /id is required/,
    );
  });

  it('rejects invalid id characters', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, id: 'My Addon!' },
        { agentId: 'agent' },
      ),
      /lowercase/,
    );
  });

  it('rejects missing name', async () => {
    expectError(
      await tool.execute({ ...VALID_ARGS, name: '' }, { agentId: 'agent' }),
      /name is required/,
    );
  });

  it('rejects missing description', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, description: '' },
        { agentId: 'agent' },
      ),
      /description is required/,
    );
  });

  it('rejects non-array permissions', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, permissions: 'agents.list' },
        { agentId: 'agent' },
      ),
      /permissions/,
    );
  });

  it('rejects path traversal in extra files', async () => {
    const files = { '../escape.js': 'bad' };
    expectError(
      await tool.execute({ ...VALID_ARGS, files }, { agentId: 'agent' }),
      /relative/i,
    );
  });

  it('rejects addon.json in files param', async () => {
    expectError(
      await tool.execute(
        { ...VALID_ARGS, files: { 'addon.json': '{}' } },
        { agentId: 'agent' },
      ),
      /addon\.json/,
    );
  });

  it('rejects a duplicate addon id', async () => {
    await tool.execute(VALID_ARGS, { agentId: 'agent' });
    expectError(
      await tool.execute(VALID_ARGS, { agentId: 'agent' }),
      /already exists/,
    );
  });

  // ── Successful creation (basic template — default) ─────────────────────────

  it('returns ok: true on success', async () => {
    const result = await tool.execute(VALID_ARGS, { agentId: 'agent' });
    expect(result.ok).toBe(true);
  });

  it('creates the addon directory', async () => {
    await tool.execute(VALID_ARGS, { agentId: 'agent' });
    expect(fs.existsSync(path.join(addonsDir, 'my-addon'))).toBe(true);
  });

  it('writes addon.json with correct structure', async () => {
    await tool.execute(VALID_ARGS, { agentId: 'agent' });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(addonsDir, 'my-addon', 'addon.json'), 'utf-8'),
    );
    expect(manifest.id).toBe('my-addon');
    expect(manifest.name).toBe('My Addon');
    expect(manifest.entry).toBe('app/index.html');
    expect(manifest.version).toBe('1.0.0');
  });

  it('scaffolds app/index.html from template', async () => {
    await tool.execute(VALID_ARGS, { agentId: 'agent' });
    const htmlPath = path.join(addonsDir, 'my-addon', 'app', 'index.html');
    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, 'utf-8');
    expect(html).toContain('My Addon');
  });

  it('scaffolds app/index.js from template', async () => {
    await tool.execute(VALID_ARGS, { agentId: 'agent' });
    const jsPath = path.join(addonsDir, 'my-addon', 'app', 'index.js');
    expect(fs.existsSync(jsPath)).toBe(true);
    const js = fs.readFileSync(jsPath, 'utf-8');
    expect(js).toContain('ADDON_READY');
  });

  it('uses the agent template when specified', async () => {
    await tool.execute(
      { ...VALID_ARGS, template: 'agent' },
      { agentId: 'agent' },
    );
    const js = fs.readFileSync(
      path.join(addonsDir, 'my-addon', 'app', 'index.js'),
      'utf-8',
    );
    expect(js).toContain('listAgents');
  });

  it('writes extra files on top of the template', async () => {
    const files = { 'app/styles.css': 'body { color: red; }' };
    await tool.execute({ ...VALID_ARGS, files }, { agentId: 'agent' });
    const css = fs.readFileSync(
      path.join(addonsDir, 'my-addon', 'app', 'styles.css'),
      'utf-8',
    );
    expect(css).toBe('body { color: red; }');
  });

  it('extra files override template files when same path is given', async () => {
    const customHtml = '<!DOCTYPE html><html><body>Custom</body></html>';
    await tool.execute(
      { ...VALID_ARGS, files: { 'app/index.html': customHtml } },
      { agentId: 'agent' },
    );
    const html = fs.readFileSync(
      path.join(addonsDir, 'my-addon', 'app', 'index.html'),
      'utf-8',
    );
    expect(html).toBe(customHtml);
  });

  it('success message lists template files', async () => {
    const result = await tool.execute(VALID_ARGS, { agentId: 'agent' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('addon.json');
      expect(result.content).toContain('app/index.html');
      expect(result.content).toContain('app/index.js');
    }
  });

  it('success message includes usage hints for granted permissions', async () => {
    const result = await tool.execute(VALID_ARGS, { agentId: 'agent' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('listAgents');
  });

  it('does not include hints for permissions not granted', async () => {
    const result = await tool.execute(
      { ...VALID_ARGS, permissions: ['agents.list'] },
      { agentId: 'agent' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).not.toContain('invokeAgent');
  });

  it('success note mentions DB not configured when addonService is absent', async () => {
    const result = await tool.execute(VALID_ARGS, { agentId: 'agent' });
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
    });
    expect(result.ok).toBe(true);
    expect(installCalled).toBe(true);
    expect(enableCalled).toBe(true);
    if (result.ok) expect(result.content).toContain('Registered and enabled');
  });
});

// ── sdk-reference integration ──────────────────────────────────────────────────

describe('sdk-reference', () => {
  it('every SDK_METHOD has a proxyPath starting with /api/addon-proxy/', async () => {
    const { SDK_METHODS } = await import('../../addons/sdk-reference.js');
    for (const method of SDK_METHODS) {
      if (method.name === 'request') continue;
      expect(method.proxyPath).toMatch(/^\/api\/addon-proxy\//);
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
});
