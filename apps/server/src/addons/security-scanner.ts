/**
 * Security Scanner
 *
 * Advanced security scanning for addon packages.
 * Detects vulnerabilities, malicious code, and compliance issues.
 */

import { CodeValidator, type SecurityIssue } from './code-validator';

// Re-export SecurityIssue for external use
export type { SecurityIssue } from './code-validator';

// ============================================================================
// Types
// ============================================================================

/**
 * Scan configuration
 */
export interface ScanConfig {
  /** Enable vulnerability database scanning */
  enableVulnerabilityDb?: boolean;
  /** Enable dependency scanning */
  enableDependencyScan?: boolean;
  /** Enable malware detection */
  enableMalwareDetection?: boolean;
  /** Maximum file size to scan */
  maxFileSize?: number;
  /** Timeout for scan in milliseconds */
  timeout?: number;
}

/**
 * Scan result
 */
export interface ScanResult {
  /** Whether the package passed security scan */
  passed: boolean;
  /** Overall security score (0-100) */
  score: number;
  /** All issues found */
  issues: SecurityIssue[];
  /** Critical issues that must be fixed */
  criticalIssues: SecurityIssue[];
  /** Issues grouped by category */
  issuesByCategory: Map<string, SecurityIssue[]>;
  /** Scan timestamp */
  scannedAt: Date;
  /** Scan duration in ms */
  duration: number;
  /** Recommendations for improving security */
  recommendations: string[];
  /** Detailed report */
  report: string;
}

/**
 * Vulnerability reference
 */
export interface VulnerabilityReference {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  cwe?: string;
  cvss?: number;
  affectedPatterns?: string[];
  remediation?: string;
}

// ============================================================================
// Known Vulnerabilities Database
// ============================================================================

const KNOWN_VULNERABILITIES: VulnerabilityReference[] = [
  {
    id: 'CVE-2021-44228',
    name: 'Log4Shell',
    description: 'Remote code execution via log4j',
    severity: 'critical',
    cwe: 'CWE-502',
    cvss: 10.0,
    affectedPatterns: ['log4j', 'logger\\.info.*\\$', 'logger\\.error.*\\$'],
  },
  {
    id: 'CVE-2021-45046',
    name: 'Log4j DoS',
    description: 'Denial of service via log4j',
    severity: 'high',
    cwe: 'CWE-400',
    cvss: 9.0,
    affectedPatterns: ['log4j'],
  },
  {
    id: 'SIMPLE-EVAL',
    name: 'Python eval usage',
    description: 'Dangerous use of eval in Python code',
    severity: 'high',
    affectedPatterns: ['eval\\s*\\(', 'exec\\s*\\('],
  },
  {
    id: 'SQL-INJECTION-001',
    name: 'SQL Injection',
    description: 'Potential SQL injection vulnerability',
    severity: 'critical',
    cwe: 'CWE-89',
    affectedPatterns: ['query\\s*\\+', 'execute\\s*\\(', 'SELECT.*\\+.*user'],
  },
  {
    id: 'CMD-INJECTION',
    name: 'Command Injection',
    description: 'Potential command injection vulnerability',
    severity: 'critical',
    cwe: 'CWE-78',
    affectedPatterns: ['system\\s*\\(', 'popen\\s*\\(', 'shell_exec'],
  },
  {
    id: 'PATH-TRAVERSAL',
    name: 'Path Traversal',
    description: 'Potential path traversal vulnerability',
    severity: 'high',
    cwe: 'CWE-22',
    affectedPatterns: ['\\.\\.\\/', '\\.\\.\\\\', 'readFile.*\\.\\.'],
  },
  {
    id: 'XXE',
    name: 'XML External Entity',
    description: 'XXE vulnerability in XML parsing',
    severity: 'high',
    cwe: 'CWE-611',
    affectedPatterns: ['XMLReader', 'simplexml_load_string', 'parseXML'],
  },
  {
    id: 'DESERIALIZATION',
    name: 'Insecure Deserialization',
    description: 'Potential insecure deserialization',
    severity: 'critical',
    cwe: 'CWE-502',
    affectedPatterns: ['unserialize', 'pickle\\.load', 'yaml\\.load.*unsafe'],
  },
];

// ============================================================================
// Security Scanner
// ============================================================================

/**
 * Security scanner for addon packages
 */
export class SecurityScanner {
  private validator: CodeValidator;
  private config: Required<ScanConfig>;
  private vulnerabilityDb: VulnerabilityReference[];

  constructor(config: ScanConfig = {}) {
    this.validator = new CodeValidator();
    this.config = {
      enableVulnerabilityDb: config.enableVulnerabilityDb ?? true,
      enableDependencyScan: config.enableDependencyScan ?? true,
      enableMalwareDetection: config.enableMalwareDetection ?? true,
      maxFileSize: config.maxFileSize ?? 10 * 1024 * 1024, // 10MB
      timeout: config.timeout ?? 30000, // 30s
    };
    this.vulnerabilityDb = KNOWN_VULNERABILITIES;
  }

  /**
   * Scan a package for security issues
   */
  async scan(
    files: Map<string, { content: string; size: number }>,
    manifest?: { dependencies?: Record<string, string> },
  ): Promise<ScanResult> {
    const startTime = Date.now();
    const allIssues: SecurityIssue[] = [];

    // Run code validation
    const validationResult = await this.validator.validatePackage(
      files,
      undefined,
    );
    allIssues.push(...validationResult.securityIssues);

    // Run vulnerability database scan
    if (this.config.enableVulnerabilityDb) {
      const vulnIssues = this.scanForVulnerabilities(files);
      allIssues.push(...vulnIssues);
    }

    // Run dependency scan
    if (this.config.enableDependencyScan && manifest?.dependencies) {
      const depIssues = this.scanDependencies(manifest.dependencies);
      allIssues.push(...depIssues);
    }

    // Run malware detection
    if (this.config.enableMalwareDetection) {
      const malwareIssues = this.detectMalware(files);
      allIssues.push(...malwareIssues);
    }

    // Categorize issues
    const issuesByCategory = this.categorizeIssues(allIssues);

    // Get critical issues
    const criticalIssues = allIssues.filter(
      (i) => i.severity === 'critical' || i.severity === 'high',
    );

    // Calculate score
    const score = this.calculateSecurityScore(allIssues);

    // Generate recommendations
    const recommendations = this.generateRecommendations(allIssues);

    // Generate report
    const report = this.generateReport(allIssues, issuesByCategory, score);

    // Determine pass/fail
    const passed = criticalIssues.length === 0 && score >= 70;

    return {
      passed,
      score,
      issues: allIssues,
      criticalIssues,
      issuesByCategory,
      scannedAt: new Date(),
      duration: Date.now() - startTime,
      recommendations,
      report,
    };
  }

  /**
   * Scan for known vulnerabilities
   */
  private scanForVulnerabilities(
    files: Map<string, { content: string; size: number }>,
  ): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    for (const [fileName, file] of files) {
      for (const vuln of this.vulnerabilityDb) {
        if (!vuln.affectedPatterns) continue;

        for (const pattern of vuln.affectedPatterns) {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(file.content)) {
            issues.push({
              severity: vuln.severity,
              category: 'vulnerability',
              description: `${vuln.name}: ${vuln.description}`,
              file: fileName,
              recommendation:
                vuln.remediation ??
                'Update the affected component to a secure version.',
            });
            break; // Only report once per file per vulnerability
          }
        }
      }
    }

    return issues;
  }

  /**
   * Scan dependencies for known issues
   */
  private scanDependencies(
    dependencies: Record<string, string>,
  ): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    // Check for vulnerable dependencies
    const knownVulnerableDeps: Record<string, string[]> = {
      lodash: ['<4.17.21'],
      moment: ['<2.29.4'],
      axios: ['<0.21.2'],
      handlebars: ['<4.7.7'],
      vue: ['<2.6.14', '<3.0.0'],
      react: ['<17.0.2'],
      jQuery: ['<3.5.0'],
    };

    for (const [dep, version] of Object.entries(dependencies)) {
      const vulnerableVersions = knownVulnerableDeps[dep];
      if (vulnerableVersions) {
        for (const vulnVersion of vulnerableVersions) {
          if (version.startsWith('^') || version.startsWith('~')) {
            issues.push({
              severity: 'high',
              category: 'vulnerable-dependency',
              description: `Dependency '${dep}@${version}' has known vulnerabilities`,
              recommendation: `Update ${dep} to a version beyond ${vulnVersion}`,
            });
          }
        }
      }
    }

    return issues;
  }

  /**
   * Detect malware patterns
   */
  private detectMalware(
    files: Map<string, { content: string; size: number }>,
  ): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    // Malware detection patterns
    const malwarePatterns = [
      // Obfuscation
      {
        pattern: /eval\s*\(\s*atob\s*\(/,
        name: 'Obfuscated code (atob)',
        severity: 'high' as const,
      },
      {
        pattern: /eval\s*\(\s*String\.fromCharCode/,
        name: 'Obfuscated code (fromCharCode)',
        severity: 'high' as const,
      },
      {
        pattern: /decodeURIComponent\s*\(\s*encoded/,
        name: 'Encoded content decoding',
        severity: 'medium' as const,
      },

      // Suspicious behavior
      {
        pattern: /setTimeout\s*\(\s*.*\s*,\s*0\s*\).*eval/,
        name: 'Delayed eval execution',
        severity: 'critical' as const,
      },
      {
        pattern: /webSocket\s*\(|new\s+WebSocket\s*\(/,
        name: 'Suspicious WebSocket usage',
        severity: 'medium' as const,
      },
      {
        pattern: /navigator\.userAgent.*PhantomJS|navigator\.webdriver/,
        name: 'Bot/automation detection',
        severity: 'low' as const,
      },

      // Data exfiltration
      {
        pattern: /fetch\s*\([^)]*\.example\.com/,
        name: 'Suspicious external communication',
        severity: 'high' as const,
      },
      {
        pattern: /localStorage\.setItem.*base64/,
        name: 'Base64 encoded localStorage',
        severity: 'medium' as const,
      },
      {
        pattern: /document\.cookie.*eval/,
        name: 'Cookie-based code execution',
        severity: 'critical' as const,
      },

      // Crypto mining
      {
        pattern: /miner|coinhive|cryptonight|hashrate/,
        name: 'Cryptocurrency mining detected',
        severity: 'critical' as const,
      },

      // Rootkit-like behavior
      {
        pattern: /Object\.defineProperty.*proto/,
        name: 'Prototype pollution attempt',
        severity: 'high' as const,
      },
      {
        pattern: /__defineGetter__|__defineSetter__/,
        name: 'Suspicious property access',
        severity: 'medium' as const,
      },
    ];

    for (const [fileName, file] of files) {
      for (const mp of malwarePatterns) {
        if (mp.pattern.test(file.content)) {
          issues.push({
            severity: mp.severity,
            category: 'malware',
            description: mp.name,
            file: fileName,
            recommendation:
              'Review this code for potential malicious behavior.',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Categorize issues by type
   */
  private categorizeIssues(
    issues: SecurityIssue[],
  ): Map<string, SecurityIssue[]> {
    const categories = new Map<string, SecurityIssue[]>();

    for (const issue of issues) {
      const categoryIssues = categories.get(issue.category) ?? [];
      categoryIssues.push(issue);
      categories.set(issue.category, categoryIssues);
    }

    return categories;
  }

  /**
   * Calculate security score
   */
  private calculateSecurityScore(issues: SecurityIssue[]): number {
    if (issues.length === 0) return 100;

    let penalty = 0;

    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          penalty += 30;
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
    const mediumCount = issues.filter((i) => i.severity === 'medium').length;

    if (criticalCount > 0) {
      recommendations.push(
        `Fix ${criticalCount} critical issue(s) immediately. These pose severe security risks.`,
      );
    }

    if (highCount > 0) {
      recommendations.push(
        `Address ${highCount} high severity issue(s) before publishing.`,
      );
    }

    if (mediumCount > 0) {
      recommendations.push(
        `Consider fixing ${mediumCount} medium severity issue(s) for improved security.`,
      );
    }

    // Add specific recommendations
    const categories = new Set(issues.map((i) => i.category));
    if (categories.has('vulnerable-dependency')) {
      recommendations.push(
        'Update all dependencies to their latest secure versions.',
      );
    }
    if (categories.has('malware')) {
      recommendations.push(
        'Review all detected patterns for potential malicious code.',
      );
    }
    if (issues.length === 0) {
      recommendations.push('Security scan passed. No issues detected.');
    }

    return recommendations;
  }

  /**
   * Generate detailed report
   */
  private generateReport(
    issues: SecurityIssue[],
    issuesByCategory: Map<string, SecurityIssue[]>,
    score: number,
  ): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('SECURITY SCAN REPORT');
    lines.push('='.repeat(60));
    lines.push('');
    lines.push(`Overall Score: ${score}/100`);
    lines.push(`Issues Found: ${issues.length}`);
    lines.push(
      `Critical: ${issues.filter((i) => i.severity === 'critical').length}`,
    );
    lines.push(`High: ${issues.filter((i) => i.severity === 'high').length}`);
    lines.push(
      `Medium: ${issues.filter((i) => i.severity === 'medium').length}`,
    );
    lines.push(`Low: ${issues.filter((i) => i.severity === 'low').length}`);
    lines.push('');

    if (issues.length === 0) {
      lines.push('No security issues detected.');
      return lines.join('\n');
    }

    lines.push('-'.repeat(60));
    lines.push('ISSUES BY CATEGORY');
    lines.push('-'.repeat(60));
    lines.push('');

    for (const [category, categoryIssues] of issuesByCategory) {
      lines.push(
        `${category.toUpperCase()} (${categoryIssues.length} issue(s))`,
      );
      for (const issue of categoryIssues) {
        lines.push(`  [${issue.severity.toUpperCase()}] ${issue.description}`);
        if (issue.file) {
          lines.push(
            `    Location: ${issue.file}${issue.line ? `:${issue.line}` : ''}`,
          );
        }
        lines.push(`    Fix: ${issue.recommendation}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Add vulnerability to database
   */
  addVulnerability(vuln: VulnerabilityReference): void {
    this.vulnerabilityDb.push(vuln);
  }

  /**
   * Update scan configuration
   */
  updateConfig(config: Partial<ScanConfig>): void {
    Object.assign(this.config, config);
  }
}

// ============================================================================
// Default export
// ============================================================================

export default new SecurityScanner();
