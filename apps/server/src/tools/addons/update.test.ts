import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createAddonUpdateTool } from './update.js';

const CTX = { agentId: 'agent', sessionId: 'test-session' };

const SEED_HTML = `<!DOCTYPE html><html><body><script src="/sdk/openaidy-sdk.js"></script><script src="index.js"></script></body></html>`;
const SEED_JS = `// original logic`;

describe('addon_update tool', () => {
  let addonsDir: string;
  let tool: ReturnType<typeof createAddonUpdateTool>;

  /** Write a complete, valid addon into addonsDir for update tests. */
  function seedAddon(
    id: string,
    manifestOverrides: Record<string, unknown> = {},
  ): void {
    const addonDir = path.join(addonsDir, id);
    fs.mkdirSync(path.join(addonDir, 'app'), { recursive: true });
    const manifest = {
      id,
      name: 'Demo',
      version: '1.0.0',
      description: 'original desc',
      openaidy: { minVersion: '0.0.0' },
      entry: 'app/index.html',
      permissions: [] as string[],
      ui: { sidebar: { icon: 'box', label: 'Demo' } },
      externalDomains: [] as string[],
      ...manifestOverrides,
    };
    fs.writeFileSync(
      path.join(addonDir, 'addon.json'),
      JSON.stringify(manifest, null, 2),
    );
    fs.writeFileSync(path.join(addonDir, 'app', 'index.html'), SEED_HTML);
    fs.writeFileSync(path.join(addonDir, 'app', 'index.js'), SEED_JS);
  }

  function readManifest(id: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(addonsDir, id, 'addon.json'), 'utf-8'),
    );
  }

  beforeEach(() => {
    addonsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-addons-update-'));
    tool = createAddonUpdateTool({ addonsDir });
    seedAddon('demo');
  });

  afterEach(() => {
    fs.rmSync(addonsDir, { recursive: true, force: true });
  });

  function expectError(
    result: Awaited<ReturnType<typeof tool.execute>>,
    pattern: RegExp,
  ): void {
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(pattern);
  }

  // ── Tool metadata ──────────────────────────────────────────────────────────

  it('has the correct name', () => {
    expect(tool.name).toBe('addon_update');
  });

  it('description leads with the addon-routing guardrail', () => {
    // Route addon edits through this tool, never generic file tools (issue #372).
    expect(tool.description).toContain('WHERE ADDONS LIVE');
    expect(tool.description).toContain('ONLY WAY TO UPDATE');
    expect(tool.description).toContain('workspace_write');
    expect(tool.description.indexOf('WHERE ADDONS LIVE')).toBeLessThan(
      tool.description.indexOf('WHAT YOU CAN CHANGE'),
    );
  });

  it('requires only id', () => {
    const required = (tool.parameters as unknown as { required: string[] })
      .required;
    expect(required).toEqual(['id']);
  });

  it('description embeds the SDK reference, same as addon_create', () => {
    // addon_update is the tool used to add a new feature (e.g. a file-upload
    // form) to an existing addon, so it needs the same SDK awareness as
    // addon_create — not just a permissions checklist.
    expect(tool.description).toContain('listAgents');
    expect(tool.description).toContain('invokeAgent');
    expect(tool.description).toContain('shareFile');
    expect(tool.description).toContain('attachFile');
  });

  it('permissions parameter derives its valid-values list from SDK_METHODS', () => {
    const params = tool.parameters as unknown as {
      properties: { permissions: { description: string } };
    };
    const description = params.properties.permissions.description;
    expect(description).toContain('workspace.write');
    expect(description).toContain('sessions.write');
  });

  // ── Input validation ───────────────────────────────────────────────────────

  it('rejects missing id', async () => {
    expectError(await tool.execute({ id: '' }, CTX), /id is required/);
  });

  it('rejects invalid id characters', async () => {
    expectError(
      await tool.execute({ id: 'My Addon!', name: 'x' }, CTX),
      /lowercase/,
    );
  });

  it('rejects a non-existent addon', async () => {
    expectError(
      await tool.execute({ id: 'ghost', name: 'x' }, CTX),
      /does not exist/,
    );
  });

  it('rejects when nothing is provided to update', async () => {
    expectError(await tool.execute({ id: 'demo' }, CTX), /Nothing to update/);
  });

  it('rejects writing addon.json directly', async () => {
    expectError(
      await tool.execute({ id: 'demo', files: { 'addon.json': '{}' } }, CTX),
      /addon\.json/,
    );
  });

  it('rejects path traversal in files', async () => {
    expectError(
      await tool.execute({ id: 'demo', files: { '../escape.js': 'bad' } }, CTX),
      /relative/i,
    );
  });

  it('rejects non-string file content', async () => {
    expectError(
      await tool.execute(
        { id: 'demo', files: { 'app/x.js': 123 as unknown as string } },
        CTX,
      ),
      /string content/,
    );
  });

  it.each(['addon.json', 'app/index.html', 'app/index.js'])(
    'rejects deleting required file %s',
    async (file) => {
      expectError(
        await tool.execute({ id: 'demo', deleteFiles: [file] }, CTX),
        /required/,
      );
    },
  );

  it('rejects path traversal in deleteFiles', async () => {
    expectError(
      await tool.execute(
        { id: 'demo', deleteFiles: ['../../etc/passwd'] },
        CTX,
      ),
      /relative/i,
    );
  });

  it('rejects overwriting index.html without the SDK script', async () => {
    expectError(
      await tool.execute(
        {
          id: 'demo',
          files: {
            'app/index.html':
              '<!DOCTYPE html><html><body><script src="index.js"></script></body></html>',
          },
        },
        CTX,
      ),
      /sdk/i,
    );
  });

  it('rejects index.html with SDK after index.js', async () => {
    expectError(
      await tool.execute(
        {
          id: 'demo',
          files: {
            'app/index.html':
              '<!DOCTYPE html><html><body><script src="index.js"></script><script src="/sdk/openaidy-sdk.js"></script></body></html>',
          },
        },
        CTX,
      ),
      /before/,
    );
  });

  it('re-injects the Tailwind CDN when overwriting index.html without it', async () => {
    // Regression: the agent never authors the Tailwind tag (create injects it),
    // so an update that rewrites index.html must re-inject it or styling breaks.
    const result = await tool.execute(
      {
        id: 'demo',
        files: {
          'app/index.html':
            '<!DOCTYPE html><html><body><script src="/sdk/openaidy-sdk.js"></script><script src="index.js"></script></body></html>',
        },
      },
      CTX,
    );
    expect(result.ok).toBe(true);
    const html = fs.readFileSync(
      path.join(addonsDir, 'demo', 'app', 'index.html'),
      'utf-8',
    );
    expect(html).toContain('https://cdn.tailwindcss.com');
    // Injected before the SDK script, so ordering is preserved.
    expect(html.indexOf('cdn.tailwindcss.com')).toBeLessThan(
      html.indexOf('/sdk/openaidy-sdk.js'),
    );
  });

  it('does not duplicate the Tailwind CDN tag when already present', async () => {
    const result = await tool.execute(
      {
        id: 'demo',
        files: {
          'app/index.html':
            '<!DOCTYPE html><html><body><script src="https://cdn.tailwindcss.com"></script><script src="/sdk/openaidy-sdk.js"></script><script src="index.js"></script></body></html>',
        },
      },
      CTX,
    );
    expect(result.ok).toBe(true);
    const html = fs.readFileSync(
      path.join(addonsDir, 'demo', 'app', 'index.html'),
      'utf-8',
    );
    expect(html.match(/cdn\.tailwindcss\.com/g)?.length).toBe(1);
  });

  it('rejects undeclared external fetch() domains', async () => {
    expectError(
      await tool.execute(
        {
          id: 'demo',
          files: { 'app/index.js': 'fetch("https://api.example.com/data")' },
        },
        CTX,
      ),
      /externalDomains/,
    );
  });

  it('accepts external fetch() when domain passed in externalDomains', async () => {
    const result = await tool.execute(
      {
        id: 'demo',
        externalDomains: ['api.example.com'],
        files: { 'app/index.js': 'fetch("https://api.example.com/data")' },
      },
      CTX,
    );
    expect(result.ok).toBe(true);
  });

  it('accepts external fetch() when domain already in existing manifest', async () => {
    seedAddon('weather', { externalDomains: ['api.example.com'] });
    const result = await tool.execute(
      {
        id: 'weather',
        files: { 'app/index.js': 'fetch("https://api.example.com/data")' },
      },
      CTX,
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['permissions', { permissions: 'agents.list' }],
    ['externalDomains', { externalDomains: 'api.example.com' }],
    ['externalImageDomains', { externalImageDomains: 5 }],
    ['name', { name: '' }],
    ['version', { version: '' }],
  ])('rejects bad %s value', async (_label, patch) => {
    expectError(
      await tool.execute({ id: 'demo', ...patch } as never, CTX),
      new RegExp(_label),
    );
  });

  // ── Successful file edits ────────────────────────────────────────────────────

  it('overwrites an existing file', async () => {
    const result = await tool.execute(
      { id: 'demo', files: { 'app/index.js': '// updated logic' } },
      CTX,
    );
    expect(result.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(addonsDir, 'demo', 'app', 'index.js'), 'utf-8'),
    ).toBe('// updated logic');
  });

  it('creates a new file in a nested folder', async () => {
    const result = await tool.execute(
      { id: 'demo', files: { 'app/lib/util.js': 'export const x = 1;' } },
      CTX,
    );
    expect(result.ok).toBe(true);
    expect(
      fs.existsSync(path.join(addonsDir, 'demo', 'app', 'lib', 'util.js')),
    ).toBe(true);
  });

  it('deletes a non-required file', async () => {
    fs.writeFileSync(path.join(addonsDir, 'demo', 'app', 'old.js'), '// stale');
    const result = await tool.execute(
      { id: 'demo', deleteFiles: ['app/old.js'] },
      CTX,
    );
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(addonsDir, 'demo', 'app', 'old.js'))).toBe(
      false,
    );
    if (result.ok) expect(result.content).toContain('Files deleted');
  });

  // ── Successful manifest edits ────────────────────────────────────────────────

  it('merges manifest fields while preserving untouched ones', async () => {
    const result = await tool.execute(
      {
        id: 'demo',
        description: 'new desc',
        version: '2.0.0',
        externalDomains: ['api.example.com'],
      },
      CTX,
    );
    expect(result.ok).toBe(true);
    const manifest = readManifest('demo');
    expect(manifest['description']).toBe('new desc');
    expect(manifest['version']).toBe('2.0.0');
    expect(manifest['externalDomains']).toEqual(['api.example.com']);
    // Untouched fields preserved
    expect(manifest['id']).toBe('demo');
    expect(manifest['entry']).toBe('app/index.html');
    expect(manifest['ui']).toEqual({ sidebar: { icon: 'box', label: 'Demo' } });
  });

  it('replaces externalDomains rather than merging', async () => {
    seedAddon('rep', { externalDomains: ['old.example.com'] });
    await tool.execute(
      { id: 'rep', externalDomains: ['new.example.com'] },
      CTX,
    );
    expect(readManifest('rep')['externalDomains']).toEqual(['new.example.com']);
  });

  it('notes DB not configured when addonService is absent', async () => {
    const result = await tool.execute({ id: 'demo', description: 'x' }, CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('DB not configured');
  });

  // ── addonService integration ─────────────────────────────────────────────────

  it('calls addonService.updateAddon when provided', async () => {
    let received: { addonId: string; manifest: { version: string } } | null =
      null;
    const mockAddonService = {
      updateAddon: async (req: {
        addonId: string;
        manifest: { version: string };
      }) => {
        received = req;
        return {};
      },
    };
    const toolWithService = createAddonUpdateTool({
      addonsDir,
      addonService: mockAddonService as never,
    });
    const result = await toolWithService.execute(
      { id: 'demo', version: '3.1.0' },
      CTX,
    );
    expect(result.ok).toBe(true);
    expect(received).not.toBeNull();
    expect(received!.addonId).toBe('demo');
    expect(received!.manifest.version).toBe('3.1.0');
    if (result.ok) expect(result.content).toContain('Manifest updated');
  });

  it('warns about reload when permissions change', async () => {
    const mockAddonService = {
      updateAddon: async () => ({}),
    };
    const toolWithService = createAddonUpdateTool({
      addonsDir,
      addonService: mockAddonService as never,
    });
    const result = await toolWithService.execute(
      { id: 'demo', permissions: ['agents.list'] },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('Permissions changed');
  });

  it('does not warn about permissions when only files change', async () => {
    const mockAddonService = { updateAddon: async () => ({}) };
    const toolWithService = createAddonUpdateTool({
      addonsDir,
      addonService: mockAddonService as never,
    });
    const result = await toolWithService.execute(
      { id: 'demo', files: { 'app/index.js': '// just files' } },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).not.toContain('Permissions changed');
  });

  it('shows a usage hint for the newly granted SDK methods when permissions are replaced', async () => {
    const mockAddonService = { updateAddon: async () => ({}) };
    const toolWithService = createAddonUpdateTool({
      addonsDir,
      addonService: mockAddonService as never,
    });
    const result = await toolWithService.execute(
      { id: 'demo', permissions: ['workspace.write'] },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('shareFile');
  });

  it('shows no usage hint when permissions are not part of the update', async () => {
    const result = await tool.execute(
      { id: 'demo', files: { 'app/index.js': '// just files' } },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).not.toContain('Available SDK methods');
    }
  });

  it('surfaces a warning when addonService.updateAddon throws', async () => {
    const mockAddonService = {
      updateAddon: async () => {
        throw new Error('boom');
      },
    };
    const toolWithService = createAddonUpdateTool({
      addonsDir,
      addonService: mockAddonService as never,
    });
    const result = await toolWithService.execute(
      { id: 'demo', description: 'x' },
      CTX,
    );
    // File/manifest writes still succeed; the DB failure is reported as a note.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain('boom');
  });
});
