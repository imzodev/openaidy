/**
 * Testing Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createMockAddon,
  createTestProject,
  cleanupTestProject,
  countTestFiles,
  getVitestConfig,
  createMockRuntimeAPI,
  validateTestSetup,
} from './testing.js';

describe('Testing Utilities', () => {
  describe('createMockAddon', () => {
    it('should create a mock addon with default values', () => {
      const addon = createMockAddon();
      expect(addon.id).toBe('test-addon');
      expect(addon.name).toBe('Test Addon');
      expect(addon.version).toBe('1.0.0');
    });

    it('should create a mock addon with overrides', () => {
      const addon = createMockAddon({
        id: 'custom-addon',
        name: 'Custom',
        version: '2.0.0',
      });
      expect(addon.id).toBe('custom-addon');
      expect(addon.name).toBe('Custom');
      expect(addon.version).toBe('2.0.0');
    });

    it('should have valid manifest structure', () => {
      const addon = createMockAddon();
      expect(addon.manifest).toHaveProperty('id');
      expect(addon.manifest).toHaveProperty('name');
      expect(addon.manifest).toHaveProperty('version');
      expect(addon.manifest).toHaveProperty('openaidy');
      expect(addon.manifest).toHaveProperty('ui');
    });
  });

  describe('createTestProject and cleanupTestProject', () => {
    it('should create and cleanup a test project', async () => {
      const addon = createMockAddon();
      const projectPath = await createTestProject(addon);

      // Verify project was created
      expect(fs.existsSync(projectPath)).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'addon.json'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(projectPath, 'src', 'index.ts'))).toBe(
        true,
      );

      // Cleanup
      await cleanupTestProject(projectPath);
      expect(fs.existsSync(projectPath)).toBe(false);
    });
  });

  describe('countTestFiles', () => {
    it('should return 0 for non-existent directory', () => {
      expect(countTestFiles('/non/existent/path')).toBe(0);
    });

    it('should count test files in directory', async () => {
      const addon = createMockAddon();
      const projectPath = await createTestProject(addon);

      // Create test file
      fs.writeFileSync(
        path.join(projectPath, 'tests', 'example.test.ts'),
        '// test',
      );

      const count = countTestFiles(projectPath);
      expect(count).toBeGreaterThanOrEqual(1);

      await cleanupTestProject(projectPath);
    });
  });

  describe('getVitestConfig', () => {
    it('should return valid vitest configuration', () => {
      const config = getVitestConfig('test-addon');
      expect(config).toHaveProperty('test');
      expect(config.test).toHaveProperty('environment');
      expect(config.test).toHaveProperty('include');
    });

    it('should include test patterns', () => {
      const config = getVitestConfig('test-addon') as {
        test: { include: string[] };
      };
      expect(config.test.include).toContain('tests/**/*.test.ts');
    });
  });

  describe('createMockRuntimeAPI', () => {
    it('should return mock runtime API', async () => {
      const api = createMockRuntimeAPI() as {
        invoke: (input: unknown) => Promise<{ result: string; input: unknown }>;
      };
      expect(api.invoke).toBeDefined();
      expect(typeof api.invoke).toBe('function');

      const result = await api.invoke({ test: 'input' });
      expect(result).toHaveProperty('result');
    });

    it('should handle getState and setState', () => {
      const api = createMockRuntimeAPI() as {
        getState: () => Record<string, unknown>;
        setState: (state: Record<string, unknown>) => void;
      };
      const state = api.getState();
      expect(state).toBeDefined();
      api.setState({ new: 'state' });
    });
  });

  describe('validateTestSetup', () => {
    it('should validate a complete test setup', async () => {
      const addon = createMockAddon();
      const projectPath = await createTestProject(addon);

      // Add test files
      fs.mkdirSync(path.join(projectPath, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(projectPath, 'tests', 'example.test.ts'),
        '// test',
      );

      const result = validateTestSetup(projectPath);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      await cleanupTestProject(projectPath);
    });

    it('should detect missing addon.json', () => {
      const result = validateTestSetup('/non/existent/path');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('addon.json not found');
    });
  });
});
