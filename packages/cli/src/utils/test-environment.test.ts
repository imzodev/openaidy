/**
 * Test Environment Tests
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createNodeEnvironment,
  createJSDOMEnvironment,
  getTestEnvVars,
  createTestDatabase,
  createMockAuth,
  setupCleanup,
  validateEnvironment,
  getTestFilePatterns,
  createMockAddonRuntime,
  getTestTimeouts,
  createIsolatedEnvironment,
} from './test-environment.js';

describe('Test Environment Utils', () => {
  describe('createNodeEnvironment', () => {
    it('should create node environment config', () => {
      const env = createNodeEnvironment();
      expect(env.type).toBe('node');
      expect(env.globals).toBe(true);
      expect(env.coverage).toBe(true);
    });
  });

  describe('createJSDOMEnvironment', () => {
    it('should create jsdom environment config', () => {
      const env = createJSDOMEnvironment();
      expect(env.type).toBe('jsdom');
      expect(env.globals).toBe(true);
      expect(env.setupFiles).toBeDefined();
    });
  });

  describe('getTestEnvVars', () => {
    it('should return test environment variables', () => {
      const vars = getTestEnvVars();
      expect(vars.NODE_ENV).toBe('test');
      expect(vars.VITEST).toBe('true');
    });
  });

  describe('createTestDatabase', () => {
    it('should create test database path', () => {
      const db = createTestDatabase({ inMemory: true });
      expect(db.path).toBeDefined();
      expect(db.cleanup).toBeDefined();
    });

    it('should clean up database', async () => {
      const dbPath = path.join('/tmp', `test-db-${Date.now()}.sqlite`);
      const db = createTestDatabase({ path: dbPath });
      fs.writeFileSync(db.path, 'test data');
      expect(fs.existsSync(db.path)).toBe(true);
      db.cleanup();
      expect(fs.existsSync(db.path)).toBe(false);
    });
  });

  describe('createMockAuth', () => {
    it('should create mock auth with defaults', () => {
      const auth = createMockAuth({});
      expect(auth.userId).toBe('test-user');
      expect(auth.roles).toContain('user');
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('should create mock auth with custom values', () => {
      const auth = createMockAuth({
        userId: 'admin',
        roles: ['admin', 'user'],
      });
      expect(auth.userId).toBe('admin');
      expect(auth.roles).toContain('admin');
    });

    it('should check permissions correctly', () => {
      const auth = createMockAuth({ permissions: ['read', 'write'] });
      expect(auth.hasPermission('read')).toBe(true);
      expect(auth.hasPermission('delete')).toBe(false);
    });
  });

  describe('setupCleanup', () => {
    it('should run all cleanup functions', () => {
      let count = 0;
      const cleanups = [
        () => {
          count++;
        },
        () => {
          count += 2;
        },
      ];

      const cleanupAll = setupCleanup(cleanups);
      cleanupAll();
      expect(count).toBe(3);
    });

    it('should handle cleanup errors gracefully', () => {
      const cleanups = [
        () => {
          throw new Error('cleanup error');
        },
      ];

      const cleanupAll = setupCleanup(cleanups);
      expect(() => cleanupAll()).not.toThrow();
    });
  });

  describe('validateEnvironment', () => {
    it('should validate existing project with tests', async () => {
      const projectPath = path.join('/tmp', `test-env-${Date.now()}`);
      fs.mkdirSync(path.join(projectPath, 'tests'), { recursive: true });
      fs.writeFileSync(
        path.join(projectPath, 'vitest.config.ts'),
        'export default {}',
      );

      const result = validateEnvironment(projectPath);
      expect(result.valid).toBe(true);

      fs.rmSync(projectPath, { recursive: true });
    });

    it('should detect missing vitest config', async () => {
      const projectPath = path.join('/tmp', `test-env-${Date.now()}`);
      fs.mkdirSync(path.join(projectPath, 'tests'), { recursive: true });

      const result = validateEnvironment(projectPath);
      expect(result.valid).toBe(false);

      fs.rmSync(projectPath, { recursive: true });
    });
  });

  describe('getTestFilePatterns', () => {
    it('should return test file patterns', () => {
      const patterns = getTestFilePatterns();
      expect(patterns.some((p) => p.includes('*.test.ts'))).toBe(true);
    });
  });

  describe('createMockAddonRuntime', () => {
    it('should create mock runtime with API methods', async () => {
      const runtime = createMockAddonRuntime();
      expect(runtime.invoke).toBeDefined();
      expect(runtime.getConfig).toBeDefined();
      expect(runtime.setConfig).toBeDefined();
      expect(runtime.emit).toBeDefined();
      expect(runtime.on).toBeDefined();
    });

    it('should handle invoke', async () => {
      const runtime = createMockAddonRuntime();
      const result = await runtime.invoke({ test: 'data' });
      expect(result).toHaveProperty('result');
    });

    it('should handle config operations', () => {
      const runtime = createMockAddonRuntime();
      runtime.setConfig({ key: 'value' });
      const config = runtime.getConfig();
      expect(config.key).toBe('value');
    });

    it('should return unsubscribe function from on', () => {
      const runtime = createMockAddonRuntime();
      const unsub = runtime.on('event', () => {});
      expect(typeof unsub).toBe('function');
    });
  });

  describe('getTestTimeouts', () => {
    it('should return timeout values', () => {
      const timeouts = getTestTimeouts();
      expect(timeouts.default).toBe(5000);
      expect(timeouts.integration).toBe(30000);
      expect(timeouts.e2e).toBe(60000);
    });
  });

  describe('createIsolatedEnvironment', () => {
    it('should isolate and restore environment', () => {
      const env = createIsolatedEnvironment();
      const originalNodeEnv = process.env.NODE_ENV;

      env.isolate();
      expect(process.env.NODE_ENV).toBe('test');

      env.restore();
      expect(process.env.NODE_ENV).toBe(originalNodeEnv);
    });
  });
});
