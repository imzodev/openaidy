/**
 * Security Scanner Tests
 *
 * Unit tests for the security scanner system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityScanner, type ScanConfig } from './security-scanner';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a clean package for testing
 */
function createCleanPackage(): Map<string, { content: string; size: number }> {
  const files = new Map<string, { content: string; size: number }>();
  files.set('index.js', {
    content: `
      export function greet(name) {
        return 'Hello, ' + name;
      }
      
      export function add(a, b) {
        return a + b;
      }
    `,
    size: 200,
  });
  files.set('utils.js', {
    content: `
      export function formatDate(date) {
        return date.toISOString();
      }
    `,
    size: 100,
  });
  return files;
}

/**
 * Create a package with vulnerabilities
 */
function createVulnerablePackage(): Map<
  string,
  { content: string; size: number }
> {
  const files = new Map<string, { content: string; size: number }>();
  files.set('index.js', {
    content: `
      // SQL Injection vulnerability
      const query = "SELECT * FROM users WHERE id = " + userId;
      
      // Command injection
      const cmd = "ls " + userInput;
      
      // Path traversal
      const path = "/files/" + userFile;
    `,
    size: 300,
  });
  return files;
}

/**
 * Create a package with malware patterns
 */
function createMalwarePackage(): Map<
  string,
  { content: string; size: number }
> {
  const files = new Map<string, { content: string; size: number }>();
  files.set('index.js', {
    content: `
      // Obfuscated code
      eval(atob("YWxlcnQoMSk="));
      
      // Cryptocurrency mining
      function startMiner() {
        console.log("Starting miner");
      }
      
      // Prototype pollution
      Object.defineProperty(Object.prototype, 'test', { value: 123 });
    `,
    size: 350,
  });
  return files;
}

/**
 * Create package with vulnerable dependencies
 */
function createVulnerableDependencies(): {
  dependencies?: Record<string, string>;
} {
  return {
    dependencies: {
      lodash: '^4.17.19', // Has known vulnerabilities
      moment: '^2.29.0', // Has known vulnerabilities
      axios: '^0.21.0', // Has known vulnerabilities
    },
  };
}

// ============================================================================
// SecurityScanner Tests
// ============================================================================

describe('SecurityScanner', () => {
  let scanner: SecurityScanner;

  beforeEach(() => {
    scanner = new SecurityScanner();
  });

  describe('scan', () => {
    it('should pass clean package', async () => {
      const files = createCleanPackage();
      const result = await scanner.scan(files);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.criticalIssues).toHaveLength(0);
    });

    it('should detect vulnerable code patterns', async () => {
      const files = createVulnerablePackage();
      const result = await scanner.scan(files);

      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should detect malware patterns', async () => {
      const files = createMalwarePackage();
      const result = await scanner.scan(files);

      const malwareIssues = result.issues.filter(
        (i) => i.category === 'malware',
      );
      expect(malwareIssues.length).toBeGreaterThan(0);
    });

    it('should detect vulnerable dependencies', async () => {
      const files = createCleanPackage();
      const deps = createVulnerableDependencies();
      const result = await scanner.scan(files, deps);

      const depIssues = result.issues.filter(
        (i) => i.category === 'vulnerable-dependency',
      );
      expect(depIssues.length).toBeGreaterThan(0);
    });

    it('should categorize issues correctly', async () => {
      const files = createVulnerablePackage();
      const result = await scanner.scan(files);

      expect(result.issuesByCategory.size).toBeGreaterThan(0);
      expect(result.issuesByCategory.has('vulnerability')).toBe(true);
    });

    it('should track scan duration', async () => {
      const files = createCleanPackage();
      const result = await scanner.scan(files);

      expect(result.duration).toBeGreaterThan(0);
      expect(result.scannedAt).toBeInstanceOf(Date);
    });

    it('should generate recommendations', async () => {
      const files = createVulnerablePackage();
      const result = await scanner.scan(files);

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations[0]).toContain('critical');
    });

    it('should generate detailed report', async () => {
      const files = createCleanPackage();
      const result = await scanner.scan(files);

      expect(result.report).toContain('SECURITY SCAN REPORT');
      expect(result.report).toContain('Score');
      expect(result.report).toContain('Issues Found');
    });

    it('should fail on critical issues', async () => {
      const files = createMalwarePackage();
      const result = await scanner.scan(files);

      expect(result.passed).toBe(false);
      expect(result.criticalIssues.length).toBeGreaterThan(0);
    });
  });

  describe('scan configuration', () => {
    it('should accept custom configuration', () => {
      const config: ScanConfig = {
        enableVulnerabilityDb: false,
        enableDependencyScan: false,
        enableMalwareDetection: false,
        timeout: 60000,
      };

      const customScanner = new SecurityScanner(config);
      expect(customScanner).toBeInstanceOf(SecurityScanner);
    });

    it('should disable vulnerability database scanning', async () => {
      const scanner = new SecurityScanner({ enableVulnerabilityDb: false });
      const files = createVulnerablePackage();

      const result = await scanner.scan(files);

      // Should still catch issues from code validator, just not from vuln DB
      const vulnDbIssues = result.issues.filter(
        (i) => i.category === 'vulnerability',
      );
      expect(vulnDbIssues.length).toBe(0);
    });

    it('should disable dependency scanning', async () => {
      const scanner = new SecurityScanner({ enableDependencyScan: false });
      const files = createCleanPackage();
      const deps = createVulnerableDependencies();

      const result = await scanner.scan(files, deps);

      const depIssues = result.issues.filter(
        (i) => i.category === 'vulnerable-dependency',
      );
      expect(depIssues.length).toBe(0);
    });

    it('should disable malware detection', async () => {
      const scanner = new SecurityScanner({ enableMalwareDetection: false });
      const files = createMalwarePackage();

      const result = await scanner.scan(files);

      const malwareIssues = result.issues.filter(
        (i) => i.category === 'malware',
      );
      expect(malwareIssues.length).toBe(0);
    });
  });

  describe('addVulnerability', () => {
    it('should add custom vulnerability to database', async () => {
      scanner.addVulnerability({
        id: 'CUSTOM-001',
        name: 'Custom Vulnerability',
        description: 'A custom vulnerability for testing',
        severity: 'high',
        affectedPatterns: ['customPattern\\.test'],
        remediation: 'Update to latest version',
      });

      const files = new Map<string, { content: string; size: number }>();
      files.set('test.js', {
        content: 'if (customPattern.test()) {}',
        size: 50,
      });

      const result = await scanner.scan(files);

      const customVuln = result.issues.find((i) =>
        i.description.includes('Custom Vulnerability'),
      );
      expect(customVuln).toBeDefined();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration dynamically', async () => {
      scanner.updateConfig({ enableMalwareDetection: false });

      const files = createMalwarePackage();
      const result = await scanner.scan(files);

      const malwareIssues = result.issues.filter(
        (i) => i.category === 'malware',
      );
      expect(malwareIssues.length).toBe(0);
    });
  });
});

// ============================================================================
// Score Calculation Tests
// ============================================================================

describe('SecurityScanner Score Calculation', () => {
  it('should return 100 for clean package', async () => {
    const scanner = new SecurityScanner();
    const files = createCleanPackage();

    const result = await scanner.scan(files);

    expect(result.score).toBe(100);
  });

  it('should deduct points for critical issues', async () => {
    const scanner = new SecurityScanner();
    const files = createMalwarePackage();

    const result = await scanner.scan(files);

    expect(result.score).toBeLessThan(70); // Critical issues present
  });

  it('should calculate score based on issue severity', async () => {
    const scanner = new SecurityScanner();

    // Create package with known vulnerability patterns
    const files = new Map<string, { content: string; size: number }>();
    files.set('index.js', {
      content: 'const x = 1; // clean',
      size: 50,
    });

    const cleanResult = await scanner.scan(files);
    const vulnerableResult = await scanner.scan(createVulnerablePackage());

    expect(vulnerableResult.score).toBeLessThan(cleanResult.score);
  });
});

// ============================================================================
// Report Generation Tests
// ============================================================================

describe('SecurityScanner Report Generation', () => {
  it('should generate report with score', async () => {
    const scanner = new SecurityScanner();
    const files = createCleanPackage();

    const result = await scanner.scan(files);

    expect(result.report).toContain('100');
    expect(result.report).toContain('/100');
  });

  it('should include issue counts in report', async () => {
    const scanner = new SecurityScanner();
    const files = createVulnerablePackage();

    const result = await scanner.scan(files);

    expect(result.report).toContain(`Issues Found: ${result.issues.length}`);
    expect(result.report).toContain('Critical:');
    expect(result.report).toContain('High:');
  });

  it('should list issues by category in report', async () => {
    const scanner = new SecurityScanner();
    const files = createVulnerablePackage();

    const result = await scanner.scan(files);

    expect(result.report).toContain('ISSUES BY CATEGORY');
    expect(result.report).toContain('VULNERABILITY');
  });

  it('should show pass status for clean packages', async () => {
    const scanner = new SecurityScanner();
    const files = createCleanPackage();

    const result = await scanner.scan(files);

    expect(result.passed).toBe(true);
    expect(result.report).toContain('No security issues detected');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('SecurityScanner Edge Cases', () => {
  it('should handle empty file map', async () => {
    const scanner = new SecurityScanner();
    const files = new Map<string, { content: string; size: number }>();

    const result = await scanner.scan(files);

    expect(result.passed).toBe(true); // Empty is clean
    expect(result.issues).toHaveLength(0);
  });

  it('should handle manifest without dependencies', async () => {
    const scanner = new SecurityScanner();
    const files = createCleanPackage();

    const result = await scanner.scan(files, {});

    expect(
      result.issues.filter((i) => i.category === 'vulnerable-dependency'),
    ).toHaveLength(0);
  });

  it('should handle undefined manifest', async () => {
    const scanner = new SecurityScanner();
    const files = createCleanPackage();

    const result = await scanner.scan(files, undefined);

    expect(
      result.issues.filter((i) => i.category === 'vulnerable-dependency'),
    ).toHaveLength(0);
  });

  it('should handle very large files efficiently', async () => {
    const scanner = new SecurityScanner({ timeout: 60000 });
    const files = new Map<string, { content: string; size: number }>();

    // Create files near max size (10MB)
    const largeContent = 'x'.repeat(9 * 1024 * 1024);
    files.set('large.js', { content: largeContent, size: 9 * 1024 * 1024 });

    const start = Date.now();
    const result = await scanner.scan(files);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(30000); // Should complete within 30s
    expect(result.duration).toBeLessThan(60000); // Scan should timeout appropriately
  });
});
