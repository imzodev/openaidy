/**
 * Documentation Generator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateDocs, validateDocs } from './docs-generator.js';

describe('Docs Generator', () => {
  const testDir = path.join('/tmp', 'openaidy-docs-test-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('generateDocs', () => {
    it('should return error for non-existent project', async () => {
      const result = await generateDocs('/non/existent/path');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should return error for missing addon.json', async () => {
      const result = await generateDocs(testDir);
      expect(result.success).toBe(false);
      expect(result.message).toContain('addon.json not found');
    });

    it('should generate documentation for valid addon', async () => {
      // Create addon.json
      const manifest = {
        id: 'test-addon',
        name: 'Test Addon',
        version: '1.0.0',
        description: 'A test addon',
        author: { name: 'Test Author', email: 'test@example.com' },
        permissions: ['read', 'write'],
        ui: {
          routes: [{ path: '/test', component: 'TestPage' }],
        },
        agents: [{ id: 'test-agent', description: 'Test agent' }],
      };

      fs.writeFileSync(
        path.join(testDir, 'addon.json'),
        JSON.stringify(manifest, null, 2),
      );

      const result = await generateDocs(testDir, {
        outputDir: path.join(testDir, 'docs'),
      });
      expect(result.success).toBe(true);

      // Check README was created
      const readmePath = path.join(testDir, 'docs', 'README.md');
      expect(fs.existsSync(readmePath)).toBe(true);

      const readmeContent = fs.readFileSync(readmePath, 'utf-8');
      expect(readmeContent).toContain('Test Addon');
      expect(readmeContent).toContain('1.0.0');
    });

    it('should generate API documentation when requested', async () => {
      const manifest = {
        id: 'test-addon',
        name: 'Test Addon',
        version: '1.0.0',
      };

      fs.writeFileSync(
        path.join(testDir, 'addon.json'),
        JSON.stringify(manifest),
      );

      const result = await generateDocs(testDir, { includeApi: true });
      expect(result.success).toBe(true);

      const apiPath = path.join(testDir, 'docs', 'API.md');
      expect(fs.existsSync(apiPath)).toBe(true);
    });
  });

  describe('validateDocs', () => {
    it('should return invalid when docs directory missing', () => {
      fs.writeFileSync(path.join(testDir, 'addon.json'), '{}');
      const result = validateDocs(testDir);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('docs/');
    });

    it('should return valid when all docs exist', () => {
      fs.mkdirSync(path.join(testDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'addon.json'), '{}');

      // Create required files
      fs.writeFileSync(path.join(testDir, 'docs', 'README.md'), '# Test');
      fs.writeFileSync(path.join(testDir, 'docs', 'API.md'), '# API');
      fs.writeFileSync(
        path.join(testDir, 'docs', 'CONFIGURATION.md'),
        '# Config',
      );

      const result = validateDocs(testDir);
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should report missing files', () => {
      fs.mkdirSync(path.join(testDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'addon.json'), '{}');
      fs.writeFileSync(path.join(testDir, 'docs', 'README.md'), '# Test');

      const result = validateDocs(testDir);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('docs/API.md');
      expect(result.missing).toContain('docs/CONFIGURATION.md');
    });
  });
});
