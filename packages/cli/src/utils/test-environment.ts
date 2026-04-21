/**
 * Test Environment Setup
 *
 * Provides test environment configuration and utilities.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TestEnvironmentConfig {
  type: 'node' | 'jsdom' | 'happy-dom';
  setupFiles?: string[];
  globals?: boolean;
  coverage?: boolean;
  coverageProvider?: 'v8' | 'istanbul';
}

export interface TestEnvironmentResult {
  valid: boolean;
  config: TestEnvironmentConfig;
  errors: string[];
}

/**
 * Default test environment configuration
 */
export const DEFAULT_ENV_CONFIG: Required<TestEnvironmentConfig> = {
  type: 'node',
  setupFiles: [],
  globals: true,
  coverage: false,
  coverageProvider: 'v8',
};

/**
 * Create test environment for Node.js
 */
export function createNodeEnvironment(): TestEnvironmentConfig {
  return {
    type: 'node',
    globals: true,
    coverage: true,
    coverageProvider: 'v8',
  };
}

/**
 * Create test environment for JSDOM
 */
export function createJSDOMEnvironment(): TestEnvironmentConfig {
  return {
    type: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: true,
    coverageProvider: 'v8',
  };
}

/**
 * Get environment variables for testing
 */
export function getTestEnvVars(): Record<string, string> {
  return {
    ...process.env,
    NODE_ENV: 'test',
    VITEST: 'true',
  };
}

/**
 * Create test database setup
 */
export function createTestDatabase(options: {
  path?: string;
  inMemory?: boolean;
}): {
  path: string;
  cleanup: () => void;
} {
  const dbPath =
    options.path || path.join('/tmp', `test-db-${Date.now()}.sqlite`);

  return {
    path: dbPath,
    cleanup: () => {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    },
  };
}

/**
 * Mock authentication for testing
 */
export function createMockAuth(options: {
  userId?: string;
  roles?: string[];
  permissions?: string[];
}): {
  userId: string;
  roles: string[];
  permissions: string[];
  isAuthenticated: () => boolean;
  hasPermission: (permission: string) => boolean;
} {
  const {
    userId = 'test-user',
    roles = ['user'],
    permissions = ['read', 'write'],
  } = options;

  return {
    userId,
    roles,
    permissions,
    isAuthenticated: () => true,
    hasPermission: (permission: string) => permissions.includes(permission),
  };
}

/**
 * Setup test cleanup handlers
 */
export function setupCleanup(cleanups: Array<() => void>): () => void {
  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
  };
}

/**
 * Validate test environment
 */
export function validateEnvironment(
  projectPath: string,
): TestEnvironmentResult {
  const errors: string[] = [];

  // Check for vitest config
  const vitestConfigPath = path.join(projectPath, 'vitest.config.ts');
  const vitestConfigPathJs = path.join(projectPath, 'vitest.config.js');

  if (!fs.existsSync(vitestConfigPath) && !fs.existsSync(vitestConfigPathJs)) {
    errors.push(
      'vitest.config.ts not found - test configuration may be incomplete',
    );
  }

  // Check for tests directory
  const testsDir = path.join(projectPath, 'tests');
  if (!fs.existsSync(testsDir)) {
    errors.push('tests/ directory not found');
  }

  return {
    valid: errors.length === 0,
    config: DEFAULT_ENV_CONFIG,
    errors,
  };
}

/**
 * Get test file patterns
 */
export function getTestFilePatterns(): string[] {
  return [
    'tests/**/*.test.ts',
    'tests/**/*.test.tsx',
    'tests/**/*.spec.ts',
    'tests/**/*.spec.tsx',
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
  ];
}

/**
 * Create mock addon runtime
 */
export function createMockAddonRuntime(): {
  invoke: (input: unknown) => Promise<unknown>;
  getConfig: () => Record<string, unknown>;
  setConfig: (config: Record<string, unknown>) => void;
  emit: (event: string, data: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => () => void;
} {
  let config: Record<string, unknown> = {};

  return {
    invoke: async (input: unknown) => {
      return { result: 'mock-result', input };
    },
    getConfig: () => ({ ...config }),
    setConfig: (newConfig: Record<string, unknown>) => {
      config = { ...newConfig };
    },
    emit: (_event: string, _data: unknown) => {
      // Mock emit - would send to runtime in real implementation
    },
    on: (_event: string, _handler: (data: unknown) => void) => {
      return () => {}; // Return unsubscribe function
    },
  };
}

/**
 * Get test timeout configuration
 */
export function getTestTimeouts(): {
  default: number;
  integration: number;
  e2e: number;
} {
  return {
    default: 5000,
    integration: 30000,
    e2e: 60000,
  };
}

/**
 * Create test isolation environment
 */
export function createIsolatedEnvironment(): {
  isolate: () => void;
  restore: () => void;
} {
  const originalEnv = { ...process.env };

  return {
    isolate: () => {
      // Isolate environment
      process.env = { ...originalEnv, NODE_ENV: 'test' };
    },
    restore: () => {
      // Restore original environment
      process.env = originalEnv;
    },
  };
}
