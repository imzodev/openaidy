/**
 * Package Analyzer
 *
 * Analyzes addon package structure, dependencies, and metadata.
 */

import type { AddonManifest } from '@openaidy/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Package analysis result
 */
export interface PackageAnalysis {
  /** Package metadata */
  metadata: PackageMetadata;
  /** File analysis results */
  files: FileAnalysis[];
  /** Dependency analysis */
  dependencies: DependencyAnalysis;
  /** Structure validation */
  structure: StructureValidation;
  /** Overall health score */
  healthScore: number;
  /** Issues found */
  issues: AnalysisIssue[];
}

/**
 * Package metadata
 */
export interface PackageMetadata {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  entryPoint?: string;
  totalSize: number;
  fileCount: number;
  directoryCount: number;
  supportedExtensions: string[];
}

/**
 * File analysis result
 */
export interface FileAnalysis {
  path: string;
  name: string;
  extension: string;
  size: number;
  isExecutable: boolean;
  isSourceFile: boolean;
  isConfigFile: boolean;
  issues: string[];
}

/**
 * Dependency analysis result
 */
export interface DependencyAnalysis {
  /** Direct dependencies */
  direct: DependencyInfo[];
  /** Peer dependencies */
  peer: DependencyInfo[];
  /** Dev dependencies (flagged) */
  dev: DependencyInfo[];
  /** Circular dependency warnings */
  circularDeps: string[][];
  /** Outdated dependencies */
  outdated: DependencyInfo[];
  /** Security concerns */
  securityIssues: DependencySecurityIssue[];
}

/**
 * Dependency information
 */
export interface DependencyInfo {
  name: string;
  version: string;
  resolvedVersion?: string;
  requiredBy: string[];
}

/**
 * Dependency security issue
 */
export interface DependencySecurityIssue {
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

/**
 * Structure validation result
 */
export interface StructureValidation {
  valid: boolean;
  requiredFilesPresent: boolean;
  requiredDirectoriesPresent: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Analysis issue
 */
export interface AnalysisIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  file?: string;
}

// ============================================================================
// Package Analyzer
// ============================================================================

/**
 * Package analyzer for addon packages
 */
export class PackageAnalyzer {
  private maxFileSize: number;
  private allowedExtensions: string[];
  private requiredFiles: string[];

  constructor(options?: {
    maxFileSize?: number;
    allowedExtensions?: string[];
    requiredFiles?: string[];
  }) {
    this.maxFileSize = options?.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this.allowedExtensions = options?.allowedExtensions ?? [
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.json',
      '.css',
      '.scss',
      '.html',
      '.svg',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.md',
      '.txt',
      '.yaml',
      '.yml',
      '.toml',
    ];
    this.requiredFiles = options?.requiredFiles ?? [
      'manifest.json',
      'package.json',
    ];
  }

  /**
   * Analyze a package
   */
  async analyze(
    files: Map<
      string,
      { content: string; size: number; isExecutable?: boolean }
    >,
    manifest?: AddonManifest,
  ): Promise<PackageAnalysis> {
    const issues: AnalysisIssue[] = [];

    // Analyze metadata
    const metadata = this.analyzeMetadata(files, manifest);

    // Analyze files
    const fileAnalyses = this.analyzeFiles(files, issues);

    // Analyze dependencies
    const dependencies = this.analyzeDependencies(files, issues);

    // Validate structure
    const structure = this.validateStructure(files, issues);

    // Calculate health score
    const healthScore = this.calculateHealthScore(issues, fileAnalyses);

    return {
      metadata,
      files: fileAnalyses,
      dependencies,
      structure,
      healthScore,
      issues,
    };
  }

  /**
   * Analyze package metadata
   */
  private analyzeMetadata(
    files: Map<string, { content: string; size: number }>,
    manifest?: AddonManifest,
  ): PackageMetadata {
    let name: string | undefined;
    let version: string | undefined;
    let description: string | undefined;
    let author: string | undefined;
    let entryPoint: string | undefined;

    if (manifest) {
      name = manifest.id;
      version = manifest.version;
      description = manifest.description;
      if (manifest.author) {
        author =
          typeof manifest.author === 'string'
            ? manifest.author
            : manifest.author.name;
      }
      entryPoint = manifest.entry;
    }

    // Calculate sizes
    let totalSize = 0;
    const extensions = new Set<string>();

    for (const [, file] of files) {
      totalSize += file.size;
    }

    for (const [fileName] of files) {
      const ext = this.getExtension(fileName);
      if (ext) extensions.add(ext);
    }

    // Count directories (unique path prefixes)
    const directories = new Set<string>();
    for (const fileName of files.keys()) {
      const parts = fileName.split('/');
      for (let i = 1; i < parts.length; i++) {
        directories.add(parts.slice(0, i).join('/'));
      }
    }

    return {
      name: name ?? '',
      version: version ?? '',
      description: description ?? '',
      author: author ?? '',
      entryPoint: entryPoint ?? '',
      totalSize,
      fileCount: files.size,
      directoryCount: directories.size,
      supportedExtensions: Array.from(extensions).sort(),
    };
  }

  /**
   * Analyze individual files
   */
  private analyzeFiles(
    files: Map<
      string,
      { content: string; size: number; isExecutable?: boolean }
    >,
    issues: AnalysisIssue[],
  ): FileAnalysis[] {
    const analyses: FileAnalysis[] = [];

    for (const [path, file] of files) {
      const name = this.getFileName(path);
      const extension = this.getExtension(path);
      const issues_list: string[] = [];

      // Check file size
      if (file.size > this.maxFileSize) {
        issues_list.push(
          `File exceeds maximum size (${this.maxFileSize} bytes)`,
        );
        issues.push({
          severity: 'error',
          category: 'file-size',
          message: `File ${path} exceeds maximum size`,
          file: path,
        });
      }

      // Check extension
      if (extension && !this.isAllowedExtension(extension)) {
        issues_list.push(`Unknown file extension: ${extension}`);
        issues.push({
          severity: 'warning',
          category: 'file-type',
          message: `Unusual file extension: ${extension} in ${path}`,
          file: path,
        });
      }

      // Check if executable (Unix-style)
      const isExecutable =
        file.isExecutable ?? this.hasExecutableExtension(path);
      if (isExecutable) {
        issues_list.push('Executable files are not allowed in addons');
        issues.push({
          severity: 'error',
          category: 'executable',
          message: `Executable file detected: ${path}`,
          file: path,
        });
      }

      // Check for minified/compressed files that hide code
      if (this.isMinifiedFile(path, file.content)) {
        issues_list.push('Minified files make security scanning difficult');
        issues.push({
          severity: 'warning',
          category: 'minified',
          message: `Minified file detected: ${path}. Consider providing source maps.`,
          file: path,
        });
      }

      // Check for hidden files
      if (this.isHiddenFile(path)) {
        issues_list.push('Hidden files may contain configuration or data');
        issues.push({
          severity: 'info',
          category: 'hidden',
          message: `Hidden file detected: ${path}`,
          file: path,
        });
      }

      analyses.push({
        path,
        name,
        extension,
        size: file.size,
        isExecutable,
        isSourceFile: this.isSourceFile(extension),
        isConfigFile: this.isConfigFile(extension),
        issues: issues_list,
      });
    }

    return analyses;
  }

  /**
   * Analyze dependencies
   */
  private analyzeDependencies(
    files: Map<string, { content: string; size: number }>,
    issues: AnalysisIssue[],
  ): DependencyAnalysis {
    const direct: DependencyInfo[] = [];
    const peer: DependencyInfo[] = [];
    const dev: DependencyInfo[] = [];
    const circularDeps: string[][] = [];
    const outdated: DependencyInfo[] = [];
    const securityIssues: DependencySecurityIssue[] = [];

    // Look for package.json
    const packageJson = this.getFile(files, 'package.json');
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson.content);

        // Parse dependencies
        if (pkg.dependencies) {
          for (const [name, version] of Object.entries(pkg.dependencies)) {
            direct.push({
              name,
              version: String(version),
              requiredBy: ['package.json'],
            });
          }
        }

        // Parse peer dependencies
        if (pkg.peerDependencies) {
          for (const [name, version] of Object.entries(pkg.peerDependencies)) {
            peer.push({
              name,
              version: String(version),
              requiredBy: ['package.json'],
            });
          }
        }

        // Flag dev dependencies
        if (pkg.devDependencies) {
          issues.push({
            severity: 'warning',
            category: 'dev-dependencies',
            message:
              'Dev dependencies detected. These are not allowed in addon packages.',
          });
          for (const [name, version] of Object.entries(pkg.devDependencies)) {
            dev.push({
              name,
              version: String(version),
              requiredBy: ['package.json'],
            });
          }
        }

        // Check for known vulnerable versions
        const vulnerableVersions: Record<string, string[]> = {
          lodash: ['<4.17.21'],
          moment: ['<2.29.4'],
          axios: ['<0.21.2'],
          handlebars: ['<4.7.7'],
          vue: ['<2.6.14', '<3.0.0'],
          react: ['<17.0.2'],
          jquery: ['<3.5.0'],
        };

        for (const dep of direct) {
          const knownVulns = vulnerableVersions[dep.name.toLowerCase()];
          if (knownVulns) {
            for (const vulnVersion of knownVulns) {
              if (this.versionMatches(dep.version, vulnVersion)) {
                securityIssues.push({
                  name: dep.name,
                  severity: 'high',
                  description: `Known vulnerability in ${dep.name}@${dep.version}`,
                  recommendation: `Update ${dep.name} to a version beyond ${vulnVersion}`,
                });
                outdated.push(dep);
              }
            }
          }
        }

        // Check for circular dependencies
        const allDeps = [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.peerDependencies ?? {}),
        ];
        const circular = this.detectCircularDeps(allDeps, pkg);
        circularDeps.push(...circular);
      } catch (_e) {
        issues.push({
          severity: 'error',
          category: 'package-json',
          message: 'Failed to parse package.json',
        });
      }
    }

    // Look for require/import statements
    for (const [filePath, file] of files) {
      if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
        // Find require statements
        const requireMatches = file.content.matchAll(
          /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        );
        for (const match of requireMatches) {
          const moduleName = match[1];
          if (
            moduleName &&
            !this.isBuiltinModule(moduleName) &&
            !this.isScopedPackage(moduleName)
          ) {
            const existing = direct.find((d) => d.name === moduleName);
            if (existing) {
              if (!existing.requiredBy.includes(filePath)) {
                existing.requiredBy.push(filePath);
              }
            } else {
              // External module not in dependencies
              issues.push({
                severity: 'warning',
                category: 'missing-dependency',
                message: `Module "${moduleName}" imported in ${filePath} but not in dependencies`,
                file: filePath,
              });
            }
          }
        }

        // Find ES imports
        const importMatches = file.content.matchAll(
          /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]\s*/g,
        );
        for (const match of importMatches) {
          const moduleName = match[1];
          if (
            moduleName &&
            !this.isBuiltinModule(moduleName) &&
            !moduleName.startsWith('.')
          ) {
            const existing = direct.find((d) => d.name === moduleName);
            if (!existing) {
              issues.push({
                severity: 'warning',
                category: 'missing-dependency',
                message: `Module "${moduleName}" imported in ${filePath} but not in dependencies`,
                file: filePath,
              });
            }
          }
        }
      }
    }

    return { direct, peer, dev, circularDeps, outdated, securityIssues };
  }

  /**
   * Validate package structure
   */
  private validateStructure(
    files: Map<string, { content: string; size: number }>,
    _issues: AnalysisIssue[],
  ): StructureValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required files
    let requiredFilesPresent = true;
    for (const required of this.requiredFiles) {
      if (!files.has(required)) {
        errors.push(`Missing required file: ${required}`);
        requiredFilesPresent = false;
      }
    }

    // Check for manifest consistency
    const manifestJson = this.getFile(files, 'manifest.json');
    const packageJson = this.getFile(files, 'package.json');

    if (manifestJson && packageJson) {
      try {
        const manifest = JSON.parse(manifestJson.content);
        const pkg = JSON.parse(packageJson.content);

        if (manifest.id && pkg.name && manifest.id !== pkg.name) {
          warnings.push('manifest.json id does not match package.json name');
        }

        if (
          manifest.version &&
          pkg.version &&
          manifest.version !== pkg.version
        ) {
          warnings.push(
            'manifest.json version does not match package.json version',
          );
        }
      } catch (_e) {
        errors.push('Failed to parse manifest or package files');
      }
    }

    // Check for entry point
    const hasEntry =
      files.has('index.js') ||
      files.has('index.ts') ||
      files.has('dist/index.js') ||
      files.has('src/index.js');

    if (!hasEntry) {
      warnings.push(
        'No entry point (index.js, index.ts, dist/index.js, or src/index.js) found',
      );
    }

    // Check for documentation
    const hasReadme = files.has('README.md') || files.has('readme.md');
    if (!hasReadme) {
      warnings.push(
        'No README.md found. Users may not understand how to use the addon.',
      );
    }

    // Check for license
    const hasLicense =
      files.has('LICENSE') ||
      files.has('LICENSE.md') ||
      files.has('license.md');
    if (!hasLicense) {
      warnings.push(
        'No LICENSE file found. Consider adding one to clarify usage terms.',
      );
    }

    return {
      valid: errors.length === 0,
      requiredFilesPresent,
      requiredDirectoriesPresent: true, // Directories are auto-detected
      errors,
      warnings,
    };
  }

  /**
   * Calculate overall health score
   */
  private calculateHealthScore(
    issues: AnalysisIssue[],
    files: FileAnalysis[],
  ): number {
    if (files.length === 0) return 50; // Empty is questionable

    let score = 100;

    // Deduct for errors (severe)
    const errorCount = issues.filter((i) => i.severity === 'error').length;
    score -= errorCount * 15;

    // Deduct for warnings
    const warningCount = issues.filter((i) => i.severity === 'warning').length;
    score -= warningCount * 3;

    // Deduct for info messages
    const infoCount = issues.filter((i) => i.severity === 'info').length;
    score -= infoCount * 1;

    // Check for critical structural issues
    const hasRequiredFiles = files.some((f) => f.path === 'manifest.json');
    if (!hasRequiredFiles) {
      score -= 20;
    }

    // Check for executables
    const hasExecutables = files.some((f) => f.isExecutable);
    if (hasExecutables) {
      score -= 10;
    }

    // File health
    const filesWithIssues = files.filter((f) => f.issues.length > 0).length;
    const fileIssueRatio = filesWithIssues / files.length;
    score -= fileIssueRatio * 10;

    return Math.max(0, Math.min(100, score));
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private getFile(
    files: Map<string, { content: string; size: number }>,
    name: string,
  ): { content: string; size: number } | undefined {
    for (const [path, file] of files) {
      if (path.endsWith(name) || path === name) {
        return file;
      }
    }
    return undefined;
  }

  private getFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
  }

  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1 || lastDot === path.length - 1) return '';
    return path.slice(lastDot);
  }

  private isAllowedExtension(ext: string): boolean {
    return this.allowedExtensions.includes(ext.toLowerCase());
  }

  private isSourceFile(ext: string): boolean {
    return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(
      ext.toLowerCase(),
    );
  }

  private isConfigFile(ext: string): boolean {
    return ['.json', '.yaml', '.yml', '.toml', '.ini', '.conf'].includes(
      ext.toLowerCase(),
    );
  }

  private isHiddenFile(path: string): boolean {
    return path
      .split('/')
      .some((part) => part.startsWith('.') && part !== '.' && part !== '..');
  }

  private hasExecutableExtension(path: string): boolean {
    const execExtensions = [
      '.sh',
      '.bash',
      '.exe',
      '.bat',
      '.cmd',
      '.ps1',
      '.py',
      '.rb',
      '.pl',
    ];
    return execExtensions.some((ext) => path.toLowerCase().endsWith(ext));
  }

  private isMinifiedFile(path: string, content: string): boolean {
    if (path.endsWith('.min.js') || path.endsWith('.min.css')) return true;
    // Check for minification indicators
    if (content.length > 1000) {
      const lines = content.split('\n').length;
      if (lines < 5 && content.length > 500) return true; // Single line long content
    }
    return false;
  }

  private isBuiltinModule(name: string): boolean {
    const builtins = [
      'fs',
      'path',
      'os',
      'http',
      'https',
      'url',
      'querystring',
      'stream',
      'util',
      'events',
      'buffer',
      'crypto',
      'child_process',
      'cluster',
      'dns',
      'net',
      'tls',
      'dgram',
      'assert',
      'constants',
      'events',
    ];
    return builtins.includes(name);
  }

  private isScopedPackage(name: string): boolean {
    return name.startsWith('@') && name.includes('/');
  }

  private versionMatches(version: string, constraint: string): boolean {
    // Simplified version matching
    const cleanedVersion = version.replace(/^[\^~>=<]+/, '');
    const constraintCleaned = constraint.replace(/^[<>=]+/, '');

    const parts = cleanedVersion.split('.').map(Number);
    const constraintParts = constraintCleaned.split('.').map(Number);

    for (let i = 0; i < constraintParts.length; i++) {
      const part = parts[i] ?? 0;
      const constraintPart = constraintParts[i] ?? 0;
      if (part < constraintPart) return true;
      if (part > constraintPart) return false;
    }
    return false;
  }

  private detectCircularDeps(
    _deps: string[],
    _pkg: Record<string, unknown>,
  ): string[][] {
    const circular: string[][] = [];
    // Simple circular dependency detection
    // In a real implementation, this would use a proper algorithm
    return circular;
  }
}

// ============================================================================
// Default export
// ============================================================================

export default new PackageAnalyzer();
