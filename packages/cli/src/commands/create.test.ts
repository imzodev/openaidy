/**
 * Create Command Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createAddon } from './create.js';

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

    it('should create addon.json manifest', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const addonJsonPath = path.join(testDir, 'myaddon', 'addon.json');
      expect(fs.existsSync(addonJsonPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(addonJsonPath, 'utf-8'));
      expect(manifest.id).toBe('myaddon');
      expect(manifest.name).toBe('MyAddon');
    });

    it('should create package.json', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const packageJsonPath = path.join(testDir, 'myaddon', 'package.json');
      expect(fs.existsSync(packageJsonPath)).toBe(true);
    });

    it('should create src directory with index.ts', async () => {
      await createAddon('MyAddon', { directory: testDir });
      const indexPath = path.join(testDir, 'myaddon', 'src', 'index.ts');
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('should skip git init when noGit option is true', async () => {
      await createAddon('MyAddon', { directory: testDir, noGit: true });
      const gitDir = path.join(testDir, 'myaddon', '.git');
      expect(fs.existsSync(gitDir)).toBe(false);
    });
  });
});
