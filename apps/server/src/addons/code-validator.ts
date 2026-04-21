/**
 * Code Validator
 *
 * Core validation and security scanning logic for addon packages.
 */

import type { AddonManifest } from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Validation result for a package
 */
export interface ValidationResult {
  /** Whether the package passed validation */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Security issues found */
  securityIssues: SecurityIssue[];
  /** Risk score (0-100) */
  score: number;
  /** Recommendations for fixing issues */
  recommendations: string[];
  /** Time taken to scan in milliseconds */
  scanDuration: number;
}

/**
 * A security issue found in an addon
 */
export interface SecurityIssue {
  /** Issue severity */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Issue category */
  category: string;
  /** Description of the issue */
  description: string;
  /** File containing the issue */
  file?: string;
  /** Line number (if applicable) */
  line?: number;
  /** The problematic code pattern */
  pattern?: string;
  /** Recommendation to fix */
  recommendation: string;
}

/**
 * Extracted package files
 */
export interface ExtractedPackage {
  manifest?: AddonManifest;
  files: Map<string, PackageFile>;
  metadata: PackageMetadata;
}

/**
 * A file within the package
 */
export interface PackageFile {
  name: string;
  path: string;
  size: number;
  content: string;
  isExecutable: boolean;
}

/**
 * Package metadata
 */
export interface PackageMetadata {
  totalSize: number;
  fileCount: number;
  entryPoint?: string;
  extractedAt: Date;
}

// ============================================================================
// Dangerous Patterns
// ============================================================================

/**
 * Dangerous code patterns to detect
 */
const DANGEROUS_PATTERNS = [
  // Code execution
  {
    pattern: /\beval\s*\(/,
    severity: 'critical' as const,
    category: 'code-execution',
    description: 'Use of eval() detected',
    recommendation: 'Remove eval() usage. Use safer alternatives.',
  },
  {
    pattern: /\bnew\s+Function\s*\(/,
    severity: 'critical' as const,
    category: 'code-execution',
    description: 'Dynamic function creation detected',
    recommendation: 'Avoid dynamic function creation.',
  },
  {
    pattern: /\bexec\s*\(/,
    severity: 'critical' as const,
    category: 'code-execution',
    description: 'Shell execution detected',
    recommendation: 'Remove shell execution. Use safe alternatives.',
  },

  // DOM manipulation
  {
    pattern: /document\.write\s*\(/,
    severity: 'high' as const,
    category: 'dom-manipulation',
    description: 'Insecure DOM manipulation',
    recommendation: 'Use safer DOM manipulation methods.',
  },
  {
    pattern: /innerHTML\s*=/,
    severity: 'medium' as const,
    category: 'xss',
    description: 'Potential XSS via innerHTML',
    recommendation: 'Use textContent or sanitized HTML.',
  },

  // Network requests
  {
    pattern: /fetch\s*\([^)]*http:/,
    severity: 'high' as const,
    category: 'network',
    description: 'HTTP fetch detected (not HTTPS)',
    recommendation: 'Use HTTPS for all network requests.',
  },
  {
    pattern: /XMLHttpRequest/,
    severity: 'medium' as const,
    category: 'network',
    description: 'XMLHttpRequest usage detected',
    recommendation: 'Use fetch API with proper security.',
  },

  // File system
  {
    pattern: /fs\.readFile|fs\.writeFile|fs\.readdir/,
    severity: 'critical' as const,
    category: 'file-system',
    description: 'File system access detected',
    recommendation: 'Remove file system access from addons.',
  },
  {
    pattern: /require\s*\(\s*['"]fs['"]\s*\)/,
    severity: 'critical' as const,
    category: 'file-system',
    description: 'Node.js fs module import',
    recommendation: 'Remove fs module usage.',
  },
  {
    pattern: /child_process|spawn|exec/,
    severity: 'critical' as const,
    category: 'system',
    description: 'Child process execution detected',
    recommendation: 'Remove child process execution.',
  },

  // Cryptography
  {
    pattern: /crypto\.|\.sign\(|\.encrypt\(/,
    severity: 'medium' as const,
    category: 'crypto',
    description: 'Cryptographic operations detected',
    recommendation: 'Ensure crypto operations are necessary and safe.',
  },
];

/**
 * Forbidden imports/modules
 */
const FORBIDDEN_MODULES = [
  'child_process',
  'fs',
  'path',
  'os',
  'net',
  'tls',
  'https',
  'http',
  'dns',
  'dgram',
  'crypto',
  'vm',
  'worker_threads',
  'cluster',
];

/**
 * Secret patterns to detect
 */
const SECRET_PATTERNS = [
  {
    pattern: /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
    type: 'API key',
  },
  {
    pattern: /secret[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
    type: 'Secret key',
  },
  { pattern: /password\s*[:=]\s*['"][^'"]+['"]/i, type: 'Password' },
  { pattern: /token\s*[:=]\s*['"][a-zA-Z0-9_-]{30,}['"]/i, type: 'Token' },
  {
    pattern: /-----BEGIN\s+(RSA|EC|DSA)?\s+PRIVATE\s+KEY-----/,
    type: 'Private key',
  },
  { pattern: /aws[_-]?access[_-]?key/i, type: 'AWS key' },
  { pattern: /github[_-]?token/i, type: 'GitHub token' },
];

// ============================================================================
// Code Validator
// ============================================================================

/**
 * Code validator for addon packages
 */
export class CodeValidator {
  private rules: ValidationRule[];

  constructor(rules?: ValidationRule[]) {
    this.rules = rules ?? getDefaultValidationRules();
  }

  /**
   * Validate a complete package
   */
  async validatePackage(
    files: Map<string, { content: string; size: number }>,
    manifest?: AddonManifest,
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    const securityIssues: SecurityIssue[] = [];

    // Validate file structure
    const structureResult = this.validateFileStructure(files);
    errors.push(...structureResult.errors);
    warnings.push(...structureResult.warnings);

    // Scan for security issues
    const scanResult = this.scanForSecurityIssues(files);
    securityIssues.push(...scanResult.issues);

    // Validate manifest if provided
    if (manifest) {
      const manifestResult = this.validateManifest(manifest);
      errors.push(...manifestResult.errors);
      warnings.push(...manifestResult.warnings);
    }

    // Calculate score
    const score = this.calculateRiskScore(securityIssues);

    // Generate recommendations
    const recommendations = this.generateRecommendations(securityIssues);

    const valid =
      errors.length === 0 &&
      securityIssues.filter(
        (i) => i.severity === 'critical' || i.severity === 'high',
      ).length === 0;

    return {
      valid,
      errors,
      warnings,
      securityIssues,
      score,
      recommendations,
      scanDuration: Date.now() - startTime,
    };
  }

  /**
   * Validate file structure
   */
  validateFileStructure(
    files: Map<string, { content: string; size: number }>,
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for required files
    if (!files.has('manifest.json') && !files.has('package.json')) {
      errors.push('Missing manifest.json or package.json');
    }

    // Check total size
    let totalSize = 0;
    for (const [name, file] of files) {
      totalSize += file.size;
      if (file.size > 10 * 1024 * 1024) {
        // 10MB
        errors.push(`File ${name} exceeds maximum size of 10MB`);
      }
    }

    if (totalSize > 100 * 1024 * 1024) {
      // 100MB
      errors.push('Package total size exceeds 100MB limit');
    }

    // Check for executable files
    for (const [name] of files) {
      if (name.endsWith('.sh') || name.endsWith('.exe')) {
        warnings.push(`Executable file detected: ${name}`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Scan for security issues
   */
  scanForSecurityIssues(
    files: Map<string, { content: string; size: number }>,
  ): { issues: SecurityIssue[] } {
    const issues: SecurityIssue[] = [];

    for (const [fileName, file] of files) {
      if (fileName.endsWith('.map') || fileName.endsWith('.d.ts')) {
        continue; // Skip source maps and type definitions
      }

      // Check dangerous patterns
      for (const rule of DANGEROUS_PATTERNS) {
        const matches = file.content.match(rule.pattern);
        if (matches) {
          issues.push({
            severity: rule.severity,
            category: rule.category,
            description: rule.description,
            file: fileName,
            pattern: matches[0],
            recommendation: rule.recommendation,
          });
        }
      }

      // Check for forbidden imports
      for (const module of FORBIDDEN_MODULES) {
        const importPattern = new RegExp(
          `require\\s*\\(\\s*['"]${module}['"]\\s*\\)|import\\s+.*\\s+from\\s+['"]${module}['"]`,
          'g',
        );
        if (importPattern.test(file.content)) {
          issues.push({
            severity: 'critical',
            category: 'forbidden-module',
            description: `Forbidden module '${module}' imported`,
            file: fileName,
            pattern: module,
            recommendation: `Remove usage of '${module}' module. This is not allowed in addons.`,
          });
        }
      }

      // Check for secrets
      for (const secretRule of SECRET_PATTERNS) {
        const matches = file.content.match(secretRule.pattern);
        if (matches) {
          issues.push({
            severity: 'critical',
            category: 'hardcoded-secret',
            description: `Hardcoded ${secretRule.type} detected`,
            file: fileName,
            recommendation:
              'Remove hardcoded secrets. Use environment variables or secure storage.',
          });
        }
      }
    }

    return { issues };
  }

  /**
   * Validate manifest
   */
  validateManifest(manifest: AddonManifest): {
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!manifest.id) errors.push('Manifest missing required field: id');
    if (!manifest.name) errors.push('Manifest missing required field: name');
    if (!manifest.version)
      errors.push('Manifest missing required field: version');
    if (!manifest.entry) errors.push('Manifest missing required field: entry');

    // Check permissions
    if (!manifest.permissions || manifest.permissions.length === 0) {
      warnings.push('Addon has no permissions declared');
    }

    // Check for suspicious permissions
    const dangerousPermissions = ['system.execute', 'fs.write', 'network.*'];
    for (const perm of manifest.permissions ?? []) {
      if (dangerousPermissions.some((d) => perm.includes(d))) {
        warnings.push(`Suspicious permission detected: ${perm}`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Calculate risk score
   */
  private calculateRiskScore(issues: SecurityIssue[]): number {
    if (issues.length === 0) return 100;

    let penalty = 0;
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          penalty += 25;
          break;
        case 'high':
          penalty += 15;
          break;
        case 'medium':
          penalty += 5;
          break;
        case 'low':
          penalty += 1;
          break;
      }
    }

    return Math.max(0, 100 - penalty);
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(issues: SecurityIssue[]): string[] {
    const recommendations: string[] = [];

    const criticalCount = issues.filter(
      (i) => i.severity === 'critical',
    ).length;
    const highCount = issues.filter((i) => i.severity === 'high').length;

    if (criticalCount > 0) {
      recommendations.push(
        `Fix ${criticalCount} critical security issue(s) before publishing`,
      );
    }
    if (highCount > 0) {
      recommendations.push(
        `Review ${highCount} high severity issue(s) for potential risks`,
      );
    }
    if (issues.length === 0) {
      recommendations.push(
        'No security issues detected. Package appears safe.',
      );
    }

    return recommendations;
  }
}

// ============================================================================
// Validation Rule
// ============================================================================

/**
 * A validation rule
 */
export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  check: (content: string) => boolean;
  recommendation: string;
}

/**
 * Get default validation rules
 */
export function getDefaultValidationRules(): ValidationRule[] {
  return [
    {
      id: 'no-eval',
      name: 'No eval usage',
      description: 'Prohibit use of eval()',
      severity: 'critical',
      check: (content) => /\beval\s*\(/.test(content),
      recommendation: 'Replace eval() with safer alternatives',
    },
    {
      id: 'no-child-process',
      name: 'No child process',
      description: 'Prohibit child process execution',
      severity: 'critical',
      check: (content) => /child_process|spawn|exec/.test(content),
      recommendation: 'Remove child process execution',
    },
    {
      id: 'no-fs-access',
      name: 'No file system access',
      description: 'Prohibit direct file system access',
      severity: 'critical',
      check: (content) => /require\s*\(\s*['"]fs['"]\s*\)/.test(content),
      recommendation: 'Use OpenAidy storage API instead',
    },
    {
      id: 'no-innerHTML',
      name: 'Safe DOM manipulation',
      description: 'Prefer textContent over innerHTML',
      severity: 'medium',
      check: (content) => /\.innerHTML\s*=/.test(content),
      recommendation: 'Use textContent or sanitize HTML',
    },
  ];
}

// ============================================================================
// Default export
// ============================================================================

export default new CodeValidator();
