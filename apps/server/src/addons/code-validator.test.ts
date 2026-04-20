/**
 * Code Validator Tests
 *
 * Unit tests for the code validation and security scanning system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CodeValidator, getDefaultValidationRules } from './code-validator';

// ============================================================================
// Types
// ============================================================================

interface TestAddonManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions: string[];
  $schema?: string;
  license?: string;
  openaidy: { minVersion: string };
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestManifest(
  overrides?: Partial<TestAddonManifest>,
): TestAddonManifest {
  return {
    $schema: 'https://openaidy.dev/schemas/addon-v1.json',
    license: 'MIT',
    id: 'test-addon',
    name: 'Test',
    version: '1.0.0',
    entry: 'index.js',
    permissions: [],
    openaidy: { minVersion: '1.0.0' },
    ...overrides,
  };
}

/**
 * Create a clean code string (no security issues)
 */
function createCleanCode(): Map<string, { content: string; size: number }> {
  const files = new Map<string, { content: string; size: number }>();
  files.set('index.js', {
    content: `
      export function greet(name) {
        return 'Hello, ' + name + '!';
      }
      
      export function calculate(a, b) {
        return a + b;
      }
    `,
    size: 200,
  });
  files.set('manifest.json', {
    content: JSON.stringify({
      id: 'clean-addon',
      name: 'Clean Addon',
      version: '1.0.0',
    }),
    size: 100,
  });
  return files;
}

/**
 * Create code with dangerous patterns
 */
function createDangerousCode(): Map<string, { content: string; size: number }> {
  const files = new Map<string, { content: string; size: number }>();
  files.set('index.js', {
    content: `
      // Dangerous: eval usage
      eval(userInput);
      
      // Dangerous: innerHTML
      element.innerHTML = userContent;
      
      // Dangerous: fetch over HTTP
      fetch('http://insecure.example.com/api');
      
      // Dangerous: require fs
      const fs = require('fs');
      fs.readFile('/etc/passwd', callback);
    `,
    size: 300,
  });
  return files;
}

/**
 * Create code with hardcoded secrets
 */
function createSecretCode(): Map<string, { content: string; size: number }> {
  const files = new Map<string, { content: string; size: number }>();
  files.set('config.js', {
    content: `
      const API_KEY = 'sk_live_abc123xyz789secret';
      const password = 'super_secret_password';
      const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456789';
      const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    `,
    size: 250,
  });
  return files;
}

// ============================================================================
// CodeValidator Tests
// ============================================================================

describe('CodeValidator', () => {
  let validator: CodeValidator;

  beforeEach(() => {
    validator = new CodeValidator();
  });

  describe('validatePackage', () => {
    it('should pass clean code with no issues', async () => {
      const files = createCleanCode();
      const result = await validator.validatePackage(files);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.securityIssues).toHaveLength(0);
      expect(result.score).toBe(100);
    });

    it('should detect dangerous patterns', async () => {
      const files = createDangerousCode();
      const result = await validator.validatePackage(files);

      expect(result.valid).toBe(false);
      expect(result.securityIssues.length).toBeGreaterThan(0);

      const categories = result.securityIssues.map((i) => i.category);
      expect(categories).toContain('code-execution');
      expect(categories).toContain('xss');
      expect(categories).toContain('network');
      expect(categories).toContain('file-system');
    });

    it('should detect hardcoded secrets', async () => {
      const files = createSecretCode();
      const result = await validator.validatePackage(files);

      expect(result.valid).toBe(false);
      expect(
        result.securityIssues.some((i) => i.category === 'hardcoded-secret'),
      ).toBe(true);
    });

    it('should calculate risk score correctly', async () => {
      const cleanFiles = createCleanCode();
      const cleanResult = await validator.validatePackage(cleanFiles);
      expect(cleanResult.score).toBe(100);

      const dangerousFiles = createDangerousCode();
      const dangerousResult = await validator.validatePackage(dangerousFiles);
      expect(dangerousResult.score).toBeLessThan(100);
    });

    it('should include scan duration', async () => {
      const files = createCleanCode();
      const result = await validator.validatePackage(files);

      expect(result.scanDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('validateFileStructure', () => {
    it('should pass valid file structure', () => {
      const files = createCleanCode();
      const result = validator.validateFileStructure(files);

      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing manifest', () => {
      const files = new Map<string, { content: string; size: number }>();
      files.set('index.js', { content: 'export {}', size: 50 });

      const result = validator.validateFileStructure(files);

      expect(result.errors.some((e) => e.includes('manifest'))).toBe(true);
    });

    it('should detect oversized files', () => {
      const files = new Map<string, { content: string; size: number }>();
      files.set('large.js', {
        content: 'x'.repeat(11 * 1024 * 1024),
        size: 11 * 1024 * 1024,
      });

      const result = validator.validateFileStructure(files);

      expect(
        result.errors.some((e) => e.includes('exceeds maximum size')),
      ).toBe(true);
    });

    it('should detect oversized total package', () => {
      const files = new Map<string, { content: string; size: number }>();
      // 100MB+ total
      for (let i = 0; i < 10; i++) {
        files.set(`file${i}.js`, {
          content: 'x'.repeat(11 * 1024 * 1024),
          size: 11 * 1024 * 1024,
        });
      }

      const result = validator.validateFileStructure(files);

      expect(result.errors.some((e) => e.includes('total size exceeds'))).toBe(
        true,
      );
    });

    it('should warn about executable files', () => {
      const files = new Map<string, { content: string; size: number }>();
      files.set('script.sh', { content: '#!/bin/bash\necho hello', size: 50 });

      const result = validator.validateFileStructure(files);

      expect(result.warnings.some((w) => w.includes('Executable'))).toBe(true);
    });
  });

  describe('scanForSecurityIssues', () => {
    it('should detect eval usage', () => {
      const files = new Map<string, { content: string; size: number }>();
      files.set('test.js', { content: 'eval("alert(1)")', size: 50 });

      const result = validator.scanForSecurityIssues(files);

      expect(result.issues.some((i) => i.pattern?.includes('eval'))).toBe(true);
    });

    it('should detect child process execution', () => {
      const files = new Map<string, { content: string; size: number }>();
      files.set('test.js', {
        content: 'const { exec } = require("child_process")',
        size: 60,
      });

      const result = validator.scanForSecurityIssues(files);

      expect(result.issues.some((i) => i.category === 'system')).toBe(true);
    });

    it('should detect forbidden fs module import', () => {
      const files = new Map<string, { content: string; size: number }>();
      files.set('test.js', { content: 'import fs from "fs"', size: 40 });

      const result = validator.scanForSecurityIssues(files);

      expect(result.issues.some((i) => i.description.includes("'fs'"))).toBe(
        true,
      );
    });

    it('should skip source maps and type definitions', () => {
      const files = new Map<string, { content: string; size: number }>();
      files.set('source.js.map', { content: 'eval("alert(1)")', size: 50 });
      files.set('types.d.ts', {
        content: 'const fs = require("fs")',
        size: 40,
      });
      files.set('source.js', { content: 'eval("alert(1)")', size: 50 });

      const result = validator.scanForSecurityIssues(files);

      const mapAndDtsIssues = result.issues.filter(
        (i) => i.file?.endsWith('.map') || i.file?.endsWith('.d.ts'),
      );
      expect(mapAndDtsIssues).toHaveLength(0);

      const jsIssues = result.issues.filter((i) => i.file === 'source.js');
      expect(jsIssues.length).toBeGreaterThan(0);
    });
  });

  describe('validateManifest', () => {
    it('should pass valid manifest', () => {
      const manifest = createTestManifest({
        permissions: ['agents.read'],
      }) as unknown as Parameters<typeof validator.validateManifest>[0];
      const result = validator.validateManifest(manifest);

      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const manifest = { name: 'Test' } as unknown as Parameters<
        typeof validator.validateManifest
      >[0];
      const result = validator.validateManifest(manifest);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('id'))).toBe(true);
      expect(result.errors.some((e) => e.includes('version'))).toBe(true);
      expect(result.errors.some((e) => e.includes('entry'))).toBe(true);
    });

    it('should warn about missing permissions', () => {
      const manifest = createTestManifest({
        permissions: [],
      }) as unknown as Parameters<typeof validator.validateManifest>[0];
      const result = validator.validateManifest(manifest);

      expect(result.warnings.some((w) => w.includes('no permissions'))).toBe(
        true,
      );
    });

    it('should warn about suspicious permissions', () => {
      const manifest = createTestManifest({
        permissions: ['system.execute', 'network.write'],
      }) as unknown as Parameters<typeof validator.validateManifest>[0];
      const result = validator.validateManifest(manifest);

      expect(result.warnings.some((w) => w.includes('Suspicious'))).toBe(true);
    });
  });
});

// ============================================================================
// getDefaultValidationRules Tests
// ============================================================================

describe('getDefaultValidationRules', () => {
  it('should return an array of rules', () => {
    const rules = getDefaultValidationRules();

    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('should have required properties on each rule', () => {
    const rules = getDefaultValidationRules();

    for (const rule of rules) {
      expect(rule.id).toBeDefined();
      expect(rule.name).toBeDefined();
      expect(rule.description).toBeDefined();
      expect(rule.severity).toBeDefined();
      expect(typeof rule.check).toBe('function');
      expect(rule.recommendation).toBeDefined();
    }
  });

  it('should have valid severity levels', () => {
    const rules = getDefaultValidationRules();
    const validSeverities = ['critical', 'high', 'medium', 'low'];

    for (const rule of rules) {
      expect(validSeverities).toContain(rule.severity);
    }
  });

  it('should detect eval usage', () => {
    const rules = getDefaultValidationRules();
    const evalRule = rules.find((r) => r.id === 'no-eval');

    expect(evalRule).toBeDefined();
    expect(evalRule!.check('eval("x")')).toBe(true);
    expect(evalRule!.check('console.log("safe")')).toBe(false);
  });

  it('should detect child process', () => {
    const rules = getDefaultValidationRules();
    const cpRule = rules.find((r) => r.id === 'no-child-process');

    expect(cpRule).toBeDefined();
    expect(cpRule!.check('child_process.exec("ls")')).toBe(true);
    expect(cpRule!.check('console.log("safe")')).toBe(false);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('CodeValidator Integration', () => {
  it('should handle empty package', async () => {
    const validator = new CodeValidator();
    const files = new Map<string, { content: string; size: number }>();

    const result = await validator.validatePackage(files);

    expect(result.valid).toBe(false); // Missing manifest
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle large number of files', async () => {
    const validator = new CodeValidator();
    const files = new Map<string, { content: string; size: number }>();

    // Create 100 clean files
    for (let i = 0; i < 100; i++) {
      files.set(`file${i}.js`, {
        content: `export const v${i} = ${i};`,
        size: 50,
      });
    }

    const result = await validator.validatePackage(files);

    expect(result.scanDuration).toBeLessThan(5000); // Should be fast
  });

  it('should prioritize critical issues over warnings', async () => {
    const files = createDangerousCode();
    const validator = new CodeValidator();

    const result = await validator.validatePackage(files);

    // Should be invalid due to critical issues
    expect(result.valid).toBe(false);

    // Should have recommendations
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]).toContain('critical');
  });
});
