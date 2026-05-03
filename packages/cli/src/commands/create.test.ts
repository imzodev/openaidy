/**
 * Create Command Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createAddon } from './addons/create.js';

const testDir = path.join('/tmp', 'openaidy-cli-test-' + Date.now());

describe('Create Command', () => {
  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test projects
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('createAddon', () => {
    it('should create an addon with valid name', async () => {
      const result = await createAddon('Test Addon', { directory: testDir });
      expect(result.success).toBe(true);
      expect(result.projectPath).toBeDefined();
    });

    it('should reject invalid addon names', async () => {
      const result = await createAddon('@invalid!');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid addon name');
    });

    it('should reject duplicate project paths', async () => {
      const result1 = await createAddon('Duplicate', { directory: testDir });
      expect(result1.success).toBe(true);

      const result2 = await createAddon('Duplicate', { directory: testDir });
      expect(result2.success).toBe(false);
      expect(result2.message).toContain('already exists');
    });

    it('should create addon.json manifest with correct fields', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const addonJsonPath = path.join(testDir, 'myaddon', 'addon.json');
      expect(fs.existsSync(addonJsonPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(addonJsonPath, 'utf-8'));
      expect(manifest.id).toBe('myaddon');
      expect(manifest.name).toBe('MyAddon');
      expect(manifest.entry).toBe('app/index.html');
    });

    it('should create index.html and index.js inside the app subfolder', async () => {
      await createAddon('MyAddon', { directory: testDir });
      expect(
        fs.existsSync(path.join(testDir, 'myaddon', 'app', 'index.html')),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(testDir, 'myaddon', 'app', 'index.js')),
      ).toBe(true);
    });

    it('index.html should load index.js as a script tag', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const html = fs.readFileSync(
        path.join(testDir, 'myaddon', 'app', 'index.html'),
        'utf-8',
      );
      expect(html).toContain('<script src="index.js">');
    });

    it('index.js should send ADDON_READY to parent', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const js = fs.readFileSync(
        path.join(testDir, 'myaddon', 'app', 'index.js'),
        'utf-8',
      );
      expect(js).toContain("postMessage({ type: 'ADDON_READY' }");
    });

    it('index.js should listen for OPENAIDY_INIT and call onSdkReady', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const js = fs.readFileSync(
        path.join(testDir, 'myaddon', 'app', 'index.js'),
        'utf-8',
      );
      expect(js).toContain("msg.type !== 'OPENAIDY_INIT'");
      expect(js).toContain('onSdkReady(msg)');
      expect(js).toContain('function onSdkReady');
    });

    it('index.js should not use window.status (conflicts with browser built-in)', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const js = fs.readFileSync(
        path.join(testDir, 'myaddon', 'app', 'index.js'),
        'utf-8',
      );
      expect(js).not.toContain("getElementById('status')");
      expect(js).not.toContain('var status ');
    });

    it('should not create package.json or tsconfig.json', async () => {
      await createAddon('MyAddon', { directory: testDir });
      expect(fs.existsSync(path.join(testDir, 'myaddon', 'package.json'))).toBe(
        false,
      );
      expect(
        fs.existsSync(path.join(testDir, 'myaddon', 'tsconfig.json')),
      ).toBe(false);
    });

    it('should skip git init when noGit option is true', async () => {
      await createAddon('MyAddon', { directory: testDir, noGit: true });
      const gitDir = path.join(testDir, 'myaddon', '.git');
      expect(fs.existsSync(gitDir)).toBe(false);
    });

    it('agent template should include agent select and invoke logic', async () => {
      await createAddon('MyAddon', {
        directory: testDir,
        template: 'agent',
      });
      const js = fs.readFileSync(
        path.join(testDir, 'myaddon', 'app', 'index.js'),
        'utf-8',
      );
      expect(js).toContain('agent-select');
      expect(js).toContain('invokeAgent');
      expect(js).toContain('listAgents');
    });
  });
});
