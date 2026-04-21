/**
 * Test Helpers - Testing utilities for CLI integration tests
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface TestProject {
  path: string;
  name: string;
  cleanup: () => void;
}

export interface TestResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
}

/**
 * Create a temporary test project
 */
export function createTempProject(name: string = 'test-addon'): TestProject {
  const projectPath = path.join('/tmp', `openaidy-test-${Date.now()}-${name}`);

  return {
    path: projectPath,
    name,
    cleanup: () => {
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Run CLI command and capture output
 */
export async function runCLICommand(
  command: string,
  cwd: string = process.cwd(),
  timeout: number = 30000,
): Promise<TestResult> {
  const start = Date.now();
  let output = '';
  let error = '';
  let exitCode = 0;

  try {
    const result = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: 'pipe',
    });
    output = result as string;
  } catch (err: unknown) {
    const execError = err as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    output = execError.stdout || '';
    error = execError.stderr || String(err);
    exitCode = execError.status || 1;
  }

  return {
    success: exitCode === 0,
    output,
    error,
    exitCode,
    duration: Date.now() - start,
  };
}

/**
 * Assert file exists in project
 */
export function assertFileExists(
  projectPath: string,
  relativePath: string,
): void {
  const fullPath = path.join(projectPath, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Expected file does not exist: ${relativePath}`);
  }
}

/**
 * Assert file contains content
 */
export function assertFileContains(
  projectPath: string,
  relativePath: string,
  searchTerm: string,
): void {
  assertFileExists(projectPath, relativePath);
  const fullPath = path.join(projectPath, relativePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  if (!content.includes(searchTerm)) {
    throw new Error(`File ${relativePath} does not contain "${searchTerm}"`);
  }
}

/**
 * Measure CLI command performance
 */
export async function measureCLIPerformance(
  command: string,
  cwd: string = process.cwd(),
  iterations: number = 5,
): Promise<{ avg: number; min: number; max: number }> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const result = await runCLICommand(command, cwd);
    if (result.success) {
      durations.push(result.duration);
    }
  }

  if (durations.length === 0) {
    return { avg: 0, min: 0, max: 0 };
  }

  return {
    avg: durations.reduce((a, b) => a + b, 0) / durations.length,
    min: Math.min(...durations),
    max: Math.max(...durations),
  };
}

/**
 * Create mock addon manifest
 */
export function createMockManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'test-addon',
    name: 'Test Addon',
    version: '1.0.0',
    description: 'A test addon for CLI validation',
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
      routes: [{ path: '/test', component: 'MainPage' }],
    },
    agents: [],
    config: {
      schema: './config-schema.json',
      defaults: {},
    },
    ...overrides,
  };
}

/**
 * Setup test project with manifest
 */
export async function setupTestProject(
  name: string,
  manifest: Record<string, unknown> = {},
): Promise<TestProject> {
  const project = createTempProject(name);
  fs.mkdirSync(project.path, { recursive: true });

  // Create addon.json
  fs.writeFileSync(
    path.join(project.path, 'addon.json'),
    JSON.stringify(createMockManifest(manifest), null, 2),
  );

  // Create package.json
  fs.writeFileSync(
    path.join(project.path, 'package.json'),
    JSON.stringify(
      {
        name: `@openaidy/addon-${name}`,
        version: '1.0.0',
        scripts: {
          test: 'echo "test"',
          build: 'echo "build"',
        },
      },
      null,
      2,
    ),
  );

  // Create src directory
  fs.mkdirSync(path.join(project.path, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(project.path, 'src', 'index.ts'),
    `export default { id: '${name}', name: 'Test Addon' };`,
  );

  return project;
}

/**
 * Validate addon manifest structure
 */
export function validateManifestStructure(manifest: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const required = ['id', 'name', 'version', 'openaidy'];

  for (const field of required) {
    if (!manifest[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Compare directory contents
 */
export function compareDirectories(
  dir1: string,
  dir2: string,
  ignorePatterns: string[] = [],
): { match: boolean; differences: string[] } {
  const differences: string[] = [];
  const files1 = listFiles(dir1, ignorePatterns);
  const files2 = listFiles(dir2, ignorePatterns);

  for (const file of files1) {
    if (!files2.includes(file)) {
      differences.push(`Missing in dir2: ${file}`);
    }
  }

  for (const file of files2) {
    if (!files1.includes(file)) {
      differences.push(`Missing in dir1: ${file}`);
    }
  }

  return {
    match: differences.length === 0,
    differences,
  };
}

/**
 * List all files in directory
 */
export function listFiles(
  dir: string,
  ignorePatterns: string[] = [],
): string[] {
  const files: string[] = [];

  function walk(currentDir: string): void {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, fullPath);

      if (ignorePatterns.some((pattern) => relativePath.includes(pattern))) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walk(dir);
  return files.sort();
}
