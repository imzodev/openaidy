/**
 * Testing Utilities for Addon CLI
 *
 * Provides testing helpers and utilities for addon development.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface MockAddon {
  id: string;
  name: string;
  version: string;
  manifest: Record<string, unknown>;
}

export interface TestContext {
  projectPath: string;
  mockAddon: MockAddon;
}

/**
 * Create a mock addon for testing
 */
export function createMockAddon(overrides: Partial<MockAddon> = {}): MockAddon {
  const id = overrides.id || 'test-addon';
  return {
    id,
    name: overrides.name || 'Test Addon',
    version: overrides.version || '1.0.0',
    manifest: {
      id,
      name: overrides.name || 'Test Addon',
      version: overrides.version || '1.0.0',
      description: 'Test addon for unit testing',
      openaidy: {
        minVersion: '1.0.0',
        maxVersion: '2.0.0',
      },
      entry: 'dist/index.js',
      permissions: [],
      ui: {
        sidebar: {
          icon: 'box',
          label: 'Test',
          order: 100,
        },
        routes: [
          {
            path: `/${id}`,
            component: 'MainPage',
          },
        ],
      },
      agents: [],
      config: {
        schema: './config-schema.json',
        defaults: {},
      },
    },
  };
}

/**
 * Create a temporary test project
 */
export async function createTestProject(addon: MockAddon): Promise<string> {
  const projectPath = path.join('/tmp', `openaidy-test-${Date.now()}`);

  // Create project structure
  fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'dist'), { recursive: true });

  // Write manifest
  fs.writeFileSync(
    path.join(projectPath, 'addon.json'),
    JSON.stringify(addon.manifest, null, 2),
  );

  // Write package.json
  fs.writeFileSync(
    path.join(projectPath, 'package.json'),
    JSON.stringify(
      {
        name: `@openaidy/addon-${addon.id}`,
        version: addon.version,
        scripts: {
          test: 'vitest',
          build: 'tsc',
        },
      },
      null,
      2,
    ),
  );

  // Write entry point
  fs.writeFileSync(
    path.join(projectPath, 'src', 'index.ts'),
    `export default { id: '${addon.id}', name: '${addon.name}' };`,
  );

  return projectPath;
}

/**
 * Clean up test project
 */
export async function cleanupTestProject(projectPath: string): Promise<void> {
  if (fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true });
  }
}

/**
 * Count test files in directory
 */
export function countTestFiles(dirPath: string): number {
  let count = 0;

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.test.tsx') ||
        entry.name.endsWith('.spec.ts') ||
        entry.name.endsWith('.spec.tsx')
      ) {
        count++;
      }
    }
  }

  walk(dirPath);
  return count;
}

/**
 * Get test configuration for vitest
 */
export function getVitestConfig(addonId: string): Record<string, unknown> {
  return {
    test: {
      environment: 'node',
      globals: true,
      setupFiles: [],
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['node_modules/**', 'dist/**', '**/*.d.ts'],
      },
      deps: {
        optimizer: {
          ssr: {
            enabled: true,
          },
        },
      },
      workspace: [
        {
          name: addonId,
          test: {
            include: ['tests/**/*.test.ts'],
          },
        },
      ],
    },
  };
}

/**
 * Create mock test environment
 */
export function createMockTestEnvironment(): {
  console: typeof console;
  process: typeof process;
  mockAddon: MockAddon;
} {
  const mockAddon = createMockAddon();

  return {
    console: {
      ...console,
      // Mock console methods if needed
    } as typeof console,
    process: {
      ...process,
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    } as typeof process,
    mockAddon,
  };
}

/**
 * Validate test setup
 */
export function validateTestSetup(projectPath: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for addon.json
  if (!fs.existsSync(path.join(projectPath, 'addon.json'))) {
    errors.push('addon.json not found');
  }

  // Check for tests directory or test files
  const testDir = path.join(projectPath, 'tests');
  const srcDir = path.join(projectPath, 'src');
  const hasTestDir = fs.existsSync(testDir);
  const hasTestFiles = countTestFiles(srcDir) > 0;

  if (!hasTestDir && !hasTestFiles) {
    warnings.push('No test files or tests directory found');
  }

  // Check for package.json
  if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
    warnings.push('package.json not found');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get test file patterns
 */
export function getTestPatterns(): string[] {
  return [
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    'tests/**/*.ts',
    'tests/**/*.tsx',
  ];
}

/**
 * Mock addon runtime API
 */
export function createMockRuntimeAPI(): Record<string, unknown> {
  return {
    invoke: async (agentId: string, input: unknown): Promise<unknown> => {
      return { result: `Mock response from ${agentId}`, input };
    },
    getState: () => ({}),
    setState: (_state: unknown) => {},
    onEvent: (_handler: (event: unknown) => void) => () => {},
    emit: async (_event: string, _data: unknown) => {},
  };
}
