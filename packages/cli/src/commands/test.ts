/**
 * Test Command - Run addon tests
 */

import fs from 'node:fs';
import path from 'node:path';
import { readAddonManifest } from '../utils/project.js';

export interface TestOptions {
  watch?: boolean;
  coverage?: boolean;
  ui?: boolean;
  filter?: string;
}

export interface TestResult {
  success: boolean;
  message: string;
  testFiles?: number;
  passed?: number;
  failed?: number;
}

/**
 * Run addon tests
 */
export async function runTests(
  projectPath: string = process.cwd(),
  _options: TestOptions = {},
): Promise<TestResult> {
  // Check if project exists
  if (!fs.existsSync(projectPath)) {
    return {
      success: false,
      message: `Project directory not found: ${projectPath}`,
    };
  }

  // Read manifest
  const manifest = readAddonManifest(projectPath);
  if (!manifest) {
    return {
      success: false,
      message:
        'addon.json not found. Run "openaidy init" to initialize the project.',
    };
  }

  // Check for test directory
  const testDir = path.join(projectPath, 'tests');
  const srcTestDir = path.join(projectPath, 'src');

  let testFiles = 0;

  // Count test files in tests/ directory
  if (fs.existsSync(testDir)) {
    testFiles += countTestFiles(testDir);
  }

  // Count test files in src/ (e.g., *.test.ts)
  if (fs.existsSync(srcTestDir)) {
    testFiles += countTestFiles(srcTestDir);
  }

  if (testFiles === 0) {
    return {
      success: true,
      message:
        'No test files found. Add tests to tests/ directory or use *.test.ts naming.',
      testFiles: 0,
    };
  }

  // In a real implementation, this would run vitest or jest
  return {
    success: true,
    message: `Found ${testFiles} test file(s). Run tests with: npm test`,
    testFiles,
  };
}

/**
 * Count test files in a directory
 */
function countTestFiles(dir: string): number {
  let count = 0;

  function walk(directory: string) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.test.tsx')
      ) {
        count++;
      }
    }
  }

  walk(dir);
  return count;
}

/**
 * Get test configuration
 */
export function getTestConfig(_projectPath: string): Record<string, unknown> {
  return {
    framework: 'vitest',
    setupFiles: ['./tests/setup.ts'],
    testMatch: ['**/tests/**/*.test.ts', '**/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  };
}

/**
 * Run tests in watch mode
 */
export async function watchTests(
  projectPath: string = process.cwd(),
  callback?: (result: TestResult) => void,
): Promise<() => void> {
  const interval = setInterval(async () => {
    const result = await runTests(projectPath);
    if (callback) {
      callback(result);
    }
  }, 10000);

  return () => clearInterval(interval);
}
