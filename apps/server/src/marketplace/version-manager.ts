/**
 * Version Manager Service
 *
 * Comprehensive version management for addons including semantic versioning,
 * compatibility checking, and update management.
 */

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _VersionMatch = any;

export interface VersionInfo {
  version: string;
  semantic: SemanticVersion;
  changelog: string;
  releaseDate: Date;
  minOpenaidyVersion: string;
  maxOpenaidyVersion: string;
  breaking: boolean;
  dependencies: DependencyRequirement[];
}

export interface DependencyRequirement {
  addonId: string;
  versionRange: string;
  optional: boolean;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: string[];
  errors: string[];
  suggestions: string[];
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  breaking: boolean;
  changelog: string;
  automatic: boolean;
}

/**
 * Parse semantic version string
 */
export function parseVersion(version: string): SemanticVersion | null {
  const match = version.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:\+([a-zA-Z0-9.]+))?$/,
  );
  if (!match) return null;

  const majorStr = match[1];
  const minorStr = match[2];
  const patchStr = match[3];

  if (!majorStr || !minorStr || !patchStr) return null;

  const result: SemanticVersion = {
    major: parseInt(majorStr, 10),
    minor: parseInt(minorStr, 10),
    patch: parseInt(patchStr, 10),
  };

  const prerelease = match[4];
  const build = match[5];
  if (prerelease) result.prerelease = prerelease;
  if (build) result.build = build;

  return result;
}

/**
 * Compare two semantic versions
 * Returns: negative if a < b, 0 if a == b, positive if a > b
 */
export function compareVersions(a: string, b: string): number {
  const semA = parseVersion(a);
  const semB = parseVersion(b);

  if (!semA || !semB) {
    // Fall back to string comparison
    return a.localeCompare(b);
  }

  // Compare major
  if (semA.major !== semB.major) return semA.major - semB.major;
  // Compare minor
  if (semA.minor !== semB.minor) return semA.minor - semB.minor;
  // Compare patch
  if (semA.patch !== semB.patch) return semA.patch - semB.patch;

  // Pre-release version has lower precedence
  if (semA.prerelease && !semB.prerelease) return -1;
  if (!semA.prerelease && semB.prerelease) return 1;
  if (semA.prerelease && semB.prerelease) {
    return semA.prerelease.localeCompare(semB.prerelease);
  }

  return 0;
}

/**
 * Check if version satisfies a range
 */
export function satisfiesVersion(version: string, range: string): boolean {
  // Handle common range formats
  if (range === '*' || range === 'x') return true;

  // Handle caret (^) - compatible with major version
  if (range.startsWith('^')) {
    const minVersion = range.slice(1);
    const semMin = parseVersion(minVersion);
    if (!semMin) return false;
    const semVer = parseVersion(version);
    if (!semVer) return false;
    return (
      semVer.major === semMin.major && compareVersions(version, minVersion) >= 0
    );
  }

  // Handle tilde (~) - compatible with minor version
  if (range.startsWith('~')) {
    const minVersion = range.slice(1);
    const semMin = parseVersion(minVersion);
    if (!semMin) return false;
    const semVer = parseVersion(version);
    if (!semVer) return false;
    if (semVer.major !== semMin.major) return false;
    if (semVer.minor !== semMin.minor) return false;
    return compareVersions(version, minVersion) >= 0;
  }

  // Handle exact version
  if (!range.includes(' ') && !range.includes('||')) {
    return compareVersions(version, range) === 0;
  }

  // Handle ranges with AND
  const parts = range.split(' ').filter((p) => p !== '||');
  for (const part of parts) {
    if (part.startsWith('>=')) {
      if (compareVersions(version, part.slice(2)) < 0) return false;
    } else if (part.startsWith('<=')) {
      if (compareVersions(version, part.slice(2)) > 0) return false;
    } else if (part.startsWith('>')) {
      if (compareVersions(version, part.slice(1)) <= 0) return false;
    } else if (part.startsWith('<')) {
      if (compareVersions(version, part.slice(1)) >= 0) return false;
    } else if (part.startsWith('=')) {
      if (compareVersions(version, part.slice(1)) !== 0) return false;
    }
  }

  return true;
}

/**
 * Check compatibility with OpenAidy version
 */
export function checkOpenaidyCompatibility(
  addonMinVersion: string,
  addonMaxVersion: string,
  openAidyVersion: string,
): CompatibilityResult {
  const result: CompatibilityResult = {
    compatible: true,
    warnings: [],
    errors: [],
    suggestions: [],
  };

  // Parse versions
  const addonMin = parseVersion(addonMinVersion);
  const addonMax = parseVersion(addonMaxVersion);
  const openAidy = parseVersion(openAidyVersion);

  if (!addonMin || !addonMax || !openAidy) {
    result.errors.push('Invalid version format');
    result.compatible = false;
    return result;
  }

  // Check minimum version
  if (compareVersions(openAidyVersion, addonMinVersion) < 0) {
    result.compatible = false;
    result.errors.push(
      `OpenAidy ${openAidyVersion} is below minimum required version ${addonMinVersion}`,
    );
    result.suggestions.push(
      `Please update OpenAidy to version ${addonMinVersion} or higher`,
    );
  }

  // Check maximum version
  if (compareVersions(openAidyVersion, addonMaxVersion) > 0) {
    result.compatible = false;
    result.errors.push(
      `OpenAidy ${openAidyVersion} exceeds maximum supported version ${addonMaxVersion}`,
    );
    result.suggestions.push(
      `This addon may not be compatible with newer OpenAidy versions`,
    );
  }

  // Warnings for close to boundaries
  const minorDiff = addonMax.major - openAidy.major;
  if (minorDiff === 0 && addonMax.minor - openAidy.minor <= 1) {
    result.warnings.push(
      `Addon is close to reaching maximum OpenAidy version support`,
    );
  }

  return result;
}

/**
 * Detect if version update is breaking
 */
export function isBreakingChange(
  currentVersion: string,
  newVersion: string,
): boolean {
  const semCurrent = parseVersion(currentVersion);
  const semNew = parseVersion(newVersion);

  if (!semCurrent || !semNew) return false;

  // Breaking changes only occur when major version changes
  return semNew.major > semCurrent.major;
}

/**
 * Get update type description
 */
export function getUpdateType(
  from: string,
  to: string,
): 'major' | 'minor' | 'patch' {
  const semFrom = parseVersion(from);
  const semTo = parseVersion(to);

  if (!semFrom || !semTo) return 'patch';

  if (semTo.major > semFrom.major) return 'major';
  if (semTo.minor > semFrom.minor) return 'minor';
  return 'patch';
}

/**
 * Version Manager class
 */
export class VersionManager {
  private versions: Map<string, VersionInfo[]> = new Map();

  /**
   * Register a new version for an addon
   */
  registerVersion(addonId: string, versionInfo: VersionInfo): void {
    const versions = this.versions.get(addonId) || [];
    versions.push(versionInfo);
    versions.sort((a, b) => compareVersions(b.version, a.version));
    this.versions.set(addonId, versions);
  }

  /**
   * Get all versions for an addon
   */
  getVersions(addonId: string): VersionInfo[] {
    return this.versions.get(addonId) || [];
  }

  /**
   * Get latest version for an addon
   */
  getLatestVersion(addonId: string): VersionInfo | null {
    const versions = this.versions.get(addonId);
    return versions?.[0] || null;
  }

  /**
   * Get specific version
   */
  getVersion(addonId: string, version: string): VersionInfo | null {
    const versions = this.versions.get(addonId);
    return versions?.find((v) => v.version === version) || null;
  }

  /**
   * Check for updates
   */
  checkForUpdate(addonId: string, currentVersion: string): UpdateInfo | null {
    const latest = this.getLatestVersion(addonId);
    if (!latest) return null;

    const hasUpdate = compareVersions(latest.version, currentVersion) > 0;

    return {
      currentVersion,
      latestVersion: latest.version,
      updateAvailable: hasUpdate,
      breaking: isBreakingChange(currentVersion, latest.version),
      changelog: latest.changelog,
      automatic: !isBreakingChange(currentVersion, latest.version),
    };
  }

  /**
   * Get version history
   */
  getVersionHistory(addonId: string): Array<{
    version: string;
    date: Date;
    breaking: boolean;
    changes: string;
  }> {
    const versions = this.versions.get(addonId) || [];
    return versions.map((v) => ({
      version: v.version,
      date: v.releaseDate,
      breaking: v.breaking,
      changes: v.changelog,
    }));
  }

  /**
   * Validate version format
   */
  validateVersionFormat(version: string): boolean {
    return parseVersion(version) !== null;
  }
}

/**
 * Create version manager instance
 */
export function createVersionManager(): VersionManager {
  return new VersionManager();
}
