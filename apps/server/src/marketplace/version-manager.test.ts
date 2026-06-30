/**
 * Version Manager Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  compareVersions,
  satisfiesVersion,
  checkOpenaidyCompatibility,
  isBreakingChange,
  getUpdateType,
  VersionManager,
} from './version-manager';

describe('Version Manager', () => {
  describe('parseVersion', () => {
    it('should parse valid semantic versions', () => {
      expect(parseVersion('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 });
      expect(parseVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
      expect(parseVersion('10.20.30')).toEqual({
        major: 10,
        minor: 20,
        patch: 30,
      });
    });

    it('should parse versions with prerelease', () => {
      expect(parseVersion('1.0.0-alpha')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: 'alpha',
      });
      expect(parseVersion('1.0.0-beta.1')).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: 'beta.1',
      });
    });

    it('should return null for invalid versions', () => {
      expect(parseVersion('invalid')).toBeNull();
      expect(parseVersion('1.0')).toBeNull();
      expect(parseVersion('v1.0.0')).toBeNull();
    });
  });

  describe('compareVersions', () => {
    it('should compare versions correctly', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('should compare minor versions', () => {
      expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    });

    it('should compare patch versions', () => {
      expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    });

    it('should handle prerelease versions', () => {
      expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
      expect(compareVersions('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
    });
  });

  describe('satisfiesVersion', () => {
    it('should handle exact versions', () => {
      expect(satisfiesVersion('1.0.0', '1.0.0')).toBe(true);
      expect(satisfiesVersion('1.0.0', '2.0.0')).toBe(false);
    });

    it('should handle caret ranges', () => {
      expect(satisfiesVersion('1.0.0', '^1.0.0')).toBe(true);
      expect(satisfiesVersion('1.9.9', '^1.0.0')).toBe(true);
      expect(satisfiesVersion('2.0.0', '^1.0.0')).toBe(false);
    });

    it('should handle tilde ranges', () => {
      // Tilde allows patch-level changes within the locked minor version:
      // ~1.0.0 := >=1.0.0 <1.1.0. A minor bump (1.1.0) is therefore excluded;
      // matching it would make tilde identical to caret (covered above).
      expect(satisfiesVersion('1.0.0', '~1.0.0')).toBe(true);
      expect(satisfiesVersion('1.0.5', '~1.0.0')).toBe(true);
      expect(satisfiesVersion('1.1.0', '~1.0.0')).toBe(false);
      expect(satisfiesVersion('2.0.0', '~1.0.0')).toBe(false);
    });

    it('should handle wildcards', () => {
      expect(satisfiesVersion('1.0.0', '*')).toBe(true);
      expect(satisfiesVersion('999.999.999', '*')).toBe(true);
    });
  });

  describe('checkOpenaidyCompatibility', () => {
    it('should return compatible for matching versions', () => {
      const result = checkOpenaidyCompatibility('1.0.0', '2.0.0', '1.5.0');
      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect incompatible minimum version', () => {
      const result = checkOpenaidyCompatibility('2.0.0', '3.0.0', '1.5.0');
      expect(result.compatible).toBe(false);
      expect(result.errors.some((e) => e.includes('below minimum'))).toBe(true);
    });

    it('should detect incompatible maximum version', () => {
      const result = checkOpenaidyCompatibility('1.0.0', '1.5.0', '2.0.0');
      expect(result.compatible).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds maximum'))).toBe(
        true,
      );
    });
  });

  describe('isBreakingChange', () => {
    it('should detect major version changes as breaking', () => {
      expect(isBreakingChange('1.0.0', '2.0.0')).toBe(true);
      expect(isBreakingChange('2.0.0', '3.0.0')).toBe(true);
    });

    it('should not flag minor/patch as breaking', () => {
      expect(isBreakingChange('1.0.0', '1.1.0')).toBe(false);
      expect(isBreakingChange('1.0.0', '1.0.1')).toBe(false);
    });
  });

  describe('getUpdateType', () => {
    it('should return correct update type', () => {
      expect(getUpdateType('1.0.0', '2.0.0')).toBe('major');
      expect(getUpdateType('1.0.0', '1.1.0')).toBe('minor');
      expect(getUpdateType('1.0.0', '1.0.1')).toBe('patch');
    });
  });

  describe('VersionManager', () => {
    const manager = new VersionManager();

    it('should register and retrieve versions', () => {
      manager.registerVersion('test-addon', {
        version: '1.0.0',
        semantic: { major: 1, minor: 0, patch: 0 },
        changelog: 'Initial release',
        releaseDate: new Date(),
        minOpenaidyVersion: '1.0.0',
        maxOpenaidyVersion: '2.0.0',
        breaking: false,
        dependencies: [],
      });

      const versions = manager.getVersions('test-addon');
      expect(versions).toHaveLength(1);
      expect(versions[0]?.version).toBe('1.0.0');
    });

    it('should get latest version', () => {
      manager.registerVersion('test-addon', {
        version: '2.0.0',
        semantic: { major: 2, minor: 0, patch: 0 },
        changelog: 'Major update',
        releaseDate: new Date(),
        minOpenaidyVersion: '1.0.0',
        maxOpenaidyVersion: '2.0.0',
        breaking: true,
        dependencies: [],
      });

      const latest = manager.getLatestVersion('test-addon');
      expect(latest?.version).toBe('2.0.0');
    });

    it('should check for updates', () => {
      const update = manager.checkForUpdate('test-addon', '1.0.0');
      expect(update?.updateAvailable).toBe(true);
      expect(update?.latestVersion).toBe('2.0.0');
      expect(update?.breaking).toBe(true);
    });
  });
});
