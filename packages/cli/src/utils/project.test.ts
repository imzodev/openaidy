/**
 * Project Management Utilities Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectAddonProject,
  readAddonManifest,
  getProjectInfo,
  validateProjectStructure,
  listProjectFiles,
  slugify,
} from './project.js';

// Test directory setup
const testDir = path.join('/tmp', 'openaidy-test-' + Date.now());
const projectPath = path.join(testDir, 'test-project');

describe('Project Utilities', () => {
  beforeEach(() => {
    // Create test directory structure
    fs.mkdirSync(projectPath, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('detectAddonProject', () => {
    it('should return false when addon.json does not exist', () => {
      expect(detectAddonProject(projectPath)).toBe(false);
    });

    it('should return true when addon.json exists', () => {
      fs.writeFileSync(path.join(projectPath, 'addon.json'), '{}');
      expect(detectAddonProject(projectPath)).toBe(true);
    });
  });

  describe('readAddonManifest', () => {
    it('should return null when addon.json does not exist', () => {
      expect(readAddonManifest(projectPath)).toBeNull();
    });

    it('should return parsed manifest when addon.json exists', () => {
      const manifest = { id: 'test-addon', name: 'Test' };
      fs.writeFileSync(
        path.join(projectPath, 'addon.json'),
        JSON.stringify(manifest),
      );
      const result = readAddonManifest(projectPath);
      expect(result).toEqual(manifest);
    });

    it('should return null for invalid JSON', () => {
      fs.writeFileSync(path.join(projectPath, 'addon.json'), 'invalid json');
      expect(readAddonManifest(projectPath)).toBeNull();
    });
  });

  describe('getProjectInfo', () => {
    it('should return null when no manifest exists', () => {
      expect(getProjectInfo(projectPath)).toBeNull();
    });

    it('should return project info when manifest exists', () => {
      const manifest = {
        id: 'test-addon',
        name: 'Test Addon',
        template: 'basic',
      };
      fs.writeFileSync(
        path.join(projectPath, 'addon.json'),
        JSON.stringify(manifest),
      );
      const info = getProjectInfo(projectPath);
      expect(info).toEqual({
        id: 'test-addon',
        name: 'Test Addon',
        path: projectPath,
        template: 'basic',
      });
    });
  });

  describe('validateProjectStructure', () => {
    it('should have errors for missing addon.json', () => {
      const result = validateProjectStructure(projectPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required file: addon.json');
    });

    it('should have warnings for missing optional files', () => {
      fs.writeFileSync(path.join(projectPath, 'addon.json'), '{}');
      const result = validateProjectStructure(projectPath);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('src'))).toBe(true);
    });

    it('should be valid with all required files', () => {
      fs.writeFileSync(path.join(projectPath, 'addon.json'), '{}');
      fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
      fs.writeFileSync(path.join(projectPath, 'package.json'), '{}');
      const result = validateProjectStructure(projectPath);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('listProjectFiles', () => {
    it('should return empty array for empty directory', () => {
      const files = listProjectFiles(projectPath);
      expect(files).toEqual([]);
    });

    it('should list files in directory', () => {
      fs.writeFileSync(path.join(projectPath, 'file1.txt'), 'content');
      fs.writeFileSync(path.join(projectPath, 'file2.txt'), 'content');
      const files = listProjectFiles(projectPath);
      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
    });

    it('should recursively list files when recursive=true', () => {
      fs.mkdirSync(path.join(projectPath, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(projectPath, 'file.txt'), 'content');
      fs.writeFileSync(
        path.join(projectPath, 'subdir', 'nested.txt'),
        'content',
      );
      const files = listProjectFiles(projectPath, true);
      expect(files).toContain('file.txt');
      expect(files).toContain('subdir/nested.txt');
    });
  });

  describe('slugify', () => {
    it('should convert name to lowercase slug', () => {
      expect(slugify('My Addon')).toBe('my-addon');
      expect(slugify('Price Analyzer')).toBe('price-analyzer');
    });

    it('should replace special characters with hyphens', () => {
      expect(slugify('My@Addon#123')).toBe('my-addon-123');
    });

    it('should trim leading and trailing hyphens', () => {
      expect(slugify('  My Addon  ')).toBe('my-addon');
    });
  });
});
