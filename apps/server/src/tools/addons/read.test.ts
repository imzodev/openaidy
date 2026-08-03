import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAddonReadTool } from './read';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

/**
 * Narrow a tool result to its success shape. Keeps each assertion focused on
 * the content instead of repeating `if (result.ok)` (the convention in the
 * sibling addon tests) and fails loudly with the tool's own error when the
 * call unexpectedly failed.
 */
function okContent(
  result: { ok: true; content: string } | { ok: false; error: string },
): string {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.content;
}

describe('addon_read', () => {
  let addonsDir: string;
  let tool: ReturnType<typeof createAddonReadTool>;

  beforeEach(async () => {
    addonsDir = await mkdtemp(join(tmpdir(), 'addon-read-test-'));
    tool = createAddonReadTool({ addonsDir });

    const dir = join(addonsDir, 'weather');
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(
      join(dir, 'addon.json'),
      JSON.stringify({
        id: 'weather',
        name: 'Weather Widget',
        description: 'Shows the weather',
        version: '1.2.0',
        permissions: ['agents.list'],
        externalDomains: ['api.weather.test'],
      }),
      'utf-8',
    );
    await writeFile(
      join(dir, 'app/index.html'),
      '<html><body>hi</body></html>',
      'utf-8',
    );
    await writeFile(
      join(dir, 'app/index.js'),
      'console.log("original");',
      'utf-8',
    );
  });

  afterEach(async () => {
    await rm(addonsDir, { recursive: true, force: true });
  });

  describe('inventory mode', () => {
    it('returns the manifest fields and the file list', async () => {
      const result = await tool.execute({ addon_id: 'weather' }, CTX);
      expect(result.ok).toBe(true);
      const content = okContent(result);
      expect(content).toContain('name: Weather Widget');
      expect(content).toContain('version: 1.2.0');
      expect(content).toContain('permissions: agents.list');
      expect(content).toContain('externalDomains: api.weather.test');
      expect(content).toContain('app/index.js');
      expect(content).toContain('app/index.html');
    });

    it('does not dump file contents in inventory mode', async () => {
      const result = await tool.execute({ addon_id: 'weather' }, CTX);
      expect(okContent(result)).not.toContain('console.log');
    });

    it('leaves addon.json out of the inventory (changed via addon_update fields)', async () => {
      const result = await tool.execute({ addon_id: 'weather' }, CTX);
      expect(okContent(result)).not.toMatch(/^\s+addon\.json/m);
    });

    it('reports (none) for manifest lists that are absent', async () => {
      const dir = join(addonsDir, 'bare');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'addon.json'),
        JSON.stringify({ id: 'bare', name: 'Bare' }),
        'utf-8',
      );
      const result = await tool.execute({ addon_id: 'bare' }, CTX);
      expect(okContent(result)).toContain('externalDomains: (none)');
      expect(okContent(result)).toContain('version: (unset)');
    });
  });

  describe('content mode', () => {
    it('returns the requested file contents', async () => {
      const result = await tool.execute(
        { addon_id: 'weather', paths: ['app/index.js'] },
        CTX,
      );
      expect(result.ok).toBe(true);
      expect(okContent(result)).toContain('console.log("original");');
    });

    it('reads several files in one call', async () => {
      const result = await tool.execute(
        { addon_id: 'weather', paths: ['app/index.js', 'app/index.html'] },
        CTX,
      );
      const content = okContent(result);
      expect(content).toContain('console.log("original");');
      expect(content).toContain('<html>');
    });

    it('reports missing files but still returns the ones that exist', async () => {
      const result = await tool.execute(
        { addon_id: 'weather', paths: ['app/index.js', 'app/nope.js'] },
        CTX,
      );
      expect(result.ok).toBe(true);
      const content = okContent(result);
      expect(content).toContain('console.log("original");');
      expect(content).toContain('Not found (skipped): app/nope.js');
    });

    it('errors when none of the requested files exist', async () => {
      const result = await tool.execute(
        { addon_id: 'weather', paths: ['app/nope.js'] },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain(
        'None of the requested files exist',
      );
    });

    it('truncates a file that would flood the context', async () => {
      await writeFile(
        join(addonsDir, 'weather', 'app/huge.js'),
        'x'.repeat(25_000),
        'utf-8',
      );
      const result = await tool.execute(
        { addon_id: 'weather', paths: ['app/huge.js'] },
        CTX,
      );
      expect(result.ok).toBe(true);
      expect(okContent(result)).toContain('truncated at 20000 characters');
    });
  });

  describe('safety', () => {
    it('rejects a path that escapes the addon directory', async () => {
      const result = await tool.execute(
        { addon_id: 'weather', paths: ['../../../etc/passwd'] },
        CTX,
      );
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain('must be relative');
    });

    it('rejects an invalid addon id', async () => {
      const result = await tool.execute({ addon_id: '../escape' }, CTX);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain('lowercase alphanumeric');
    });

    it('errors clearly for an addon that does not exist', async () => {
      const result = await tool.execute({ addon_id: 'ghost' }, CTX);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain('not found');
    });

    it('requires addon_id', async () => {
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain('addon_id is required');
    });

    it('reports an unparseable manifest instead of crashing', async () => {
      const dir = join(addonsDir, 'busted');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'addon.json'), '{ not json', 'utf-8');
      const result = await tool.execute({ addon_id: 'busted' }, CTX);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain('unreadable addon.json');
    });
  });
});
