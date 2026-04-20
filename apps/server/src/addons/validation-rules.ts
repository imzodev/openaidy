/**
 * Validation Rules
 *
 * Comprehensive validation rule definitions for addon packages.
 */

import type { ValidationRule } from './code-validator';

// ============================================================================
// Security Rules
// ============================================================================

/**
 * Security-focused validation rules
 */
export const SECURITY_RULES: ValidationRule[] = [
  // Code execution
  {
    id: 'no-eval',
    name: 'No eval usage',
    description: 'Prohibit use of eval() and similar dynamic code execution',
    severity: 'critical',
    check: (content) => /\beval\s*\(/.test(content),
    recommendation:
      'Replace eval() with safer alternatives like JSON.parse() for data or function references.',
  },
  {
    id: 'no-function-constructor',
    name: 'No Function constructor',
    description: 'Prohibit dynamic function creation via new Function()',
    severity: 'critical',
    check: (content) => /\bnew\s+Function\s*\(/.test(content),
    recommendation:
      'Avoid dynamic function creation. Use predefined functions or a safe sandbox.',
  },
  {
    id: 'no-setTimeout-string',
    name: 'No setTimeout with string',
    description:
      'Prohibit setTimeout/setInterval with string argument (eval alternative)',
    severity: 'critical',
    check: (content) =>
      /setTimeout\s*\(\s*['"`][^'"`]+['"`]\s*,/.test(content) ||
      /setInterval\s*\(\s*['"`][^'"`]+['"`]\s*,/.test(content),
    recommendation:
      'Use setTimeout with a function reference instead of a string.',
  },

  // System access
  {
    id: 'no-child-process',
    name: 'No child process execution',
    description: 'Prohibit child_process module usage',
    severity: 'critical',
    check: (content) => /child_process|\bspawn\(|\bexec\(/.test(content),
    recommendation:
      'Remove all child process execution. Addons run in a sandboxed environment.',
  },
  {
    id: 'no-fs-access',
    name: 'No file system access',
    description: 'Prohibit direct file system access',
    severity: 'critical',
    check: (content) =>
      /require\s*\(\s*['"]fs['"]\s*\)|import\s+.*\s+from\s+['"]fs['"]|fs\.(readFile|writeFile|readdir|readFileSync|writeFileSync)/.test(
        content,
      ),
    recommendation: 'Use the OpenAidy Storage API for file operations.',
  },
  {
    id: 'no-os-module',
    name: 'No OS module access',
    description: 'Prohibit access to OS module for system information',
    severity: 'high',
    check: (content) =>
      /require\s*\(\s*['"]os['"]\s*\)|import\s+.*\s+from\s+['"]os['"]/.test(
        content,
      ),
    recommendation:
      'Remove OS module usage. System info should come from OpenAidy APIs.',
  },
  {
    id: 'no-net-module',
    name: 'No network module',
    description: 'Prohibit raw socket/network access',
    severity: 'critical',
    check: (content) =>
      /require\s*\(\s*['"](net|tls|https?|dns|dgram)['"]\s*\)/.test(content),
    recommendation: 'Use fetch API for network requests with proper HTTPS.',
  },
  {
    id: 'no-vm-module',
    name: 'No VM module',
    description: 'Prohibit VM module for code sandbox escape',
    severity: 'critical',
    check: (content) =>
      /require\s*\(\s*['"]vm['"]\s*\)|import\s+.*\s+from\s+['"]vm['"]/.test(
        content,
      ),
    recommendation: 'VM module is not available in addon sandbox.',
  },
  {
    id: 'no-worker-threads',
    name: 'No worker threads',
    description: 'Prohibit worker_threads module',
    severity: 'high',
    check: (content) =>
      /require\s*\(\s*['"]worker_threads['"]\s*\)/.test(content),
    recommendation: 'Worker threads are not allowed in addon sandbox.',
  },
  {
    id: 'no-cluster-module',
    name: 'No cluster module',
    description: 'Prohibit cluster module for process forking',
    severity: 'high',
    check: (content) => /require\s*\(\s*['"]cluster['"]\s*\)/.test(content),
    recommendation: 'Cluster module is not available in addon sandbox.',
  },

  // Cryptography
  {
    id: 'no-crypto-module',
    name: 'No crypto module',
    description: 'Prohibit direct cryptographic operations',
    severity: 'medium',
    check: (content) =>
      /require\s*\(\s*['"]crypto['"]\s*\)|import\s+.*\s+from\s+['"]crypto['"]/.test(
        content,
      ),
    recommendation: 'Use OpenAidy APIs for cryptographic operations if needed.',
  },

  // Code quality - XSS
  {
    id: 'no-innerHTML-assignment',
    name: 'Safe DOM manipulation',
    description: 'Prefer textContent over innerHTML to prevent XSS',
    severity: 'medium',
    check: (content) => /\.innerHTML\s*=/.test(content),
    recommendation:
      'Use textContent for plain text, or sanitize HTML before setting innerHTML.',
  },
  {
    id: 'no-document-write',
    name: 'No document.write',
    description: 'Prohibit document.write() which can cause XSS',
    severity: 'high',
    check: (content) => /document\.write\s*\(/.test(content),
    recommendation: 'Use DOM APIs like createElement and appendChild instead.',
  },
  {
    id: 'no-outerHTML-assignment',
    name: 'Safe outerHTML manipulation',
    description: 'Check outerHTML assignments for XSS risk',
    severity: 'medium',
    check: (content) => /\.outerHTML\s*=/.test(content),
    recommendation: 'Sanitize any HTML content before setting outerHTML.',
  },

  // Network security
  {
    id: 'no-http-fetch',
    name: 'HTTPS only for fetch',
    description: 'Prohibit HTTP (non-HTTPS) fetch requests',
    severity: 'high',
    check: (content) => /fetch\s*\(\s*['"]http:\/\//.test(content),
    recommendation:
      'Use HTTPS for all network requests to ensure data security.',
  },
  {
    id: 'no-xmlhttprequest',
    name: 'Use fetch API',
    description: 'Prohibit XMLHttpRequest in favor of fetch',
    severity: 'low',
    check: (content) => /XMLHttpRequest\s*\(/.test(content),
    recommendation:
      'Use fetch API instead of XMLHttpRequest for better security and usability.',
  },

  // Data validation
  {
    id: 'no-sql-string-concat',
    name: 'Safe SQL queries',
    description: 'Prevent SQL injection via string concatenation',
    severity: 'critical',
    check: (content) =>
      /(['"`])SELECT.*\1\s*\+|^.*"\s*\+\s*".*SELECT/.test(content) ||
      /(['"`])INSERT.*\1\s*\+|^.*"\s*\+\s*".*INSERT/.test(content) ||
      /(['"`])UPDATE.*\1\s*\+|^.*"\s*\+\s*".*UPDATE/.test(content),
    recommendation:
      'Use parameterized queries or an ORM for database operations.',
  },
  {
    id: 'no-shell-injection',
    name: 'Safe shell commands',
    description: 'Prevent command injection in shell execution',
    severity: 'critical',
    check: (content) => /`.*\$\{.*\}`.*exec|exec\s*\(`.*\$\{/.test(content),
    recommendation:
      'Never pass user input to shell commands. Validate and sanitize all inputs.',
  },

  // Secrets
  {
    id: 'no-hardcoded-secrets',
    name: 'No hardcoded secrets',
    description: 'Detect hardcoded API keys, passwords, and tokens',
    severity: 'critical',
    check: (content) =>
      /(api[_-]?key|secret[_-]?key|password|token|auth)\s*[:=]\s*['"][a-zA-Z0-9_/-]{20,}['"]/i.test(
        content,
      ),
    recommendation: 'Use environment variables or secure storage for secrets.',
  },
  {
    id: 'no-private-keys',
    name: 'No embedded private keys',
    description: 'Detect embedded private keys and certificates',
    severity: 'critical',
    check: (content) =>
      /-----BEGIN\s+(RSA|EC|DSA)?\s+PRIVATE\s+KEY-----/.test(content),
    recommendation:
      'Private keys should never be embedded in code. Use secure key management.',
  },
];

// ============================================================================
// Code Quality Rules
// ============================================================================

/**
 * Code quality validation rules
 */
export const CODE_QUALITY_RULES: ValidationRule[] = [
  // Complexity
  {
    id: 'max-function-length',
    name: 'Max function length',
    description: 'Functions should not exceed 100 lines',
    severity: 'low',
    check: (content) => {
      const functionMatches = content.match(
        /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?^\}/gm,
      );
      if (!functionMatches) return false;
      return functionMatches.some((fn) => fn.split('\n').length > 100);
    },
    recommendation:
      'Break large functions into smaller, more focused functions.',
  },
  {
    id: 'max-cyclomatic-complexity',
    name: 'Max cyclomatic complexity',
    description: 'Functions should have complexity below 10',
    severity: 'medium',
    check: (content) => {
      // Simple heuristic: too many if/else or &&/|| in a row
      const complexBlocks = content.match(
        /if\s*\(.*\)\s*\{[^}]*(\?\s*[^}]*\}?\s*:){3,}/g,
      );
      return (complexBlocks?.length ?? 0) > 0;
    },
    recommendation:
      'Simplify complex conditionals. Consider extracting logic into separate functions.',
  },

  // Error handling
  {
    id: 'no-bare-throw',
    name: 'No bare throw',
    description: 'Thrown errors should include message',
    severity: 'low',
    check: (content) => /\bthrow\s+[^'"`]/.test(content),
    recommendation:
      'Include error message when throwing: throw new Error("description").',
  },
  {
    id: 'no-try-empty-catch',
    name: 'No empty try-catch',
    description: 'Empty catch blocks hide errors',
    severity: 'medium',
    check: (content) => /catch\s*\([^)]*\)\s*\{\s*\}/g.test(content),
    recommendation:
      'Either handle the error or let it propagate with proper logging.',
  },

  // Performance
  {
    id: 'no-inner-loop',
    name: 'No nested loops',
    description: 'Deep nesting of loops impacts performance',
    severity: 'low',
    check: (content) => {
      let maxDepth = 0;
      let currentDepth = 0;
      for (const char of content) {
        if (char === '{') currentDepth++;
        if (char === '}') currentDepth--;
        maxDepth = Math.max(maxDepth, currentDepth);
      }
      return maxDepth > 6; // More than 3 levels of nested blocks
    },
    recommendation:
      'Flatten nested structures or extract inner loops into separate functions.',
  },
  {
    id: 'no-regex-in-loop',
    name: 'No regex in loops',
    description: 'Creating regex in loops is inefficient',
    severity: 'low',
    check: (content) => {
      // Check for /pattern/.test() or similar in likely loop context
      const lines = content.split('\n');
      let inLoop = false;
      let loopDepth = 0;

      for (const line of lines) {
        if (/for\s*\(|while\s*\(/.test(line)) {
          inLoop = true;
          loopDepth = (line.match(/\{/g) || []).length;
        }
        if (inLoop && /\/(.*)\/[gim]*/.test(line)) {
          return true;
        }
        if (inLoop) {
          loopDepth -= (line.match(/\}/g) || []).length;
          if (loopDepth <= 0) inLoop = false;
        }
      }
      return false;
    },
    recommendation: 'Move regex compilation outside of loops.',
  },
];

// ============================================================================
// Compliance Rules
// ============================================================================

/**
 * Compliance and regulatory validation rules
 */
export const COMPLIANCE_RULES: ValidationRule[] = [
  // License compliance
  {
    id: 'no-gpl-code',
    name: 'No GPL code',
    description: 'Detect GPL license code (conflicts with MIT)',
    severity: 'medium',
    check: (content) => /\bGPL\b|\bGeneral Public License\b/i.test(content),
    recommendation:
      'Replace GPL-licensed code with MIT-compatible alternatives.',
  },
  {
    id: 'no-copyleft-code',
    name: 'No copyleft code',
    description: 'Detect copyleft license code',
    severity: 'low',
    check: (content) => /\bAGPL\b|\bLGPL\b|\bMPL\b/i.test(content),
    recommendation: 'Copyleft licenses may conflict with distribution terms.',
  },

  // Data privacy
  {
    id: 'no-localStorage-sensitive',
    name: 'No sensitive data in localStorage',
    description: 'Detect sensitive data being stored in localStorage',
    severity: 'high',
    check: (content) =>
      /localStorage\.setItem\s*\(\s*['"](?:password|secret|key|token|auth)['"]/.test(
        content,
      ),
    recommendation: 'Use the secure OpenAidy Storage API for sensitive data.',
  },
  {
    id: 'no-sessionStorage-sensitive',
    name: 'No sensitive data in sessionStorage',
    description: 'Detect sensitive data being stored in sessionStorage',
    severity: 'high',
    check: (content) =>
      /sessionStorage\.setItem\s*\(\s*['"](?:password|secret|key|token|auth)['"]/.test(
        content,
      ),
    recommendation: 'Use the secure OpenAidy Storage API for sensitive data.',
  },
  {
    id: 'no-cookie-sensitive',
    name: 'No sensitive data in cookies',
    description: 'Detect sensitive data being set in cookies',
    severity: 'medium',
    check: (content) =>
      /document\.cookie\s*=\s*[^;]*?(password|secret|token|auth)/i.test(
        content,
      ),
    recommendation:
      'Use HttpOnly and Secure flags for cookies containing sensitive data.',
  },

  // Accessibility
  {
    id: 'no-onclick-inline',
    name: 'No inline onclick',
    description: 'Inline event handlers reduce accessibility',
    severity: 'low',
    check: (content) => /\bonclick\s*=/.test(content),
    recommendation:
      'Use addEventListener or framework event binding instead of inline onclick.',
  },
];

// ============================================================================
// All Rules Combined
// ============================================================================

/**
 * Get all validation rules
 */
export function getAllRules(): ValidationRule[] {
  return [...SECURITY_RULES, ...CODE_QUALITY_RULES, ...COMPLIANCE_RULES];
}

/**
 * Get rules by severity level
 */
export function getRulesBySeverity(
  severity: 'critical' | 'high' | 'medium' | 'low',
): ValidationRule[] {
  return getAllRules().filter((rule) => rule.severity === severity);
}

/**
 * Get rules by category
 */
export function getRulesByCategory(
  category: 'security' | 'quality' | 'compliance',
): ValidationRule[] {
  switch (category) {
    case 'security':
      return SECURITY_RULES;
    case 'quality':
      return CODE_QUALITY_RULES;
    case 'compliance':
      return COMPLIANCE_RULES;
  }
}

// ============================================================================
// Default export
// ============================================================================

export default {
  security: SECURITY_RULES,
  codeQuality: CODE_QUALITY_RULES,
  compliance: COMPLIANCE_RULES,
  getAll: getAllRules,
  bySeverity: getRulesBySeverity,
  byCategory: getRulesByCategory,
};
