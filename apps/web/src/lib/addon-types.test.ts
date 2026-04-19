/**
 * Frontend Addon Types - Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { isLoadedAddon, hasPermission, matchesPermission } from './addon-types';
import type { AddonInfo } from './addon-types';

describe('addon-types utilities', () => {
  describe('isLoadedAddon', () => {
    it('should return true for valid loaded addon', () => {
      const addon = {
        id: 'test-addon',
        manifest: {
          id: 'test-addon',
          name: 'Test Addon',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        status: 'loaded',
        loadedAt: new Date(),
        components: {},
        routes: [],
      };

      expect(isLoadedAddon(addon)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isLoadedAddon(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isLoadedAddon(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isLoadedAddon('string')).toBe(false);
      expect(isLoadedAddon(123)).toBe(false);
    });

    it('should return false for object missing required fields', () => {
      expect(isLoadedAddon({ id: 'test' })).toBe(false);
      expect(isLoadedAddon({ manifest: {} })).toBe(false);
    });

    it('should return false for invalid status', () => {
      const addon = {
        id: 'test-addon',
        manifest: {
          id: 'test-addon',
          name: 'Test',
          version: '1.0.0',
          openaidy: { minVersion: '1.0.0' },
          entry: 'dist/index.js',
          permissions: [],
        },
        status: 'invalid-status',
        loadedAt: new Date(),
        components: {},
        routes: [],
      };

      expect(isLoadedAddon(addon)).toBe(false);
    });
  });

  describe('hasPermission', () => {
    const addonInfo: AddonInfo = {
      id: 'test-addon',
      name: 'Test Addon',
      version: '1.0.0',
      permissions: ['sessions.read', 'agents.invoke'],
    };

    it('should return true for existing permission', () => {
      expect(hasPermission(addonInfo, 'sessions.read')).toBe(true);
      expect(hasPermission(addonInfo, 'agents.invoke')).toBe(true);
    });

    it('should return false for non-existing permission', () => {
      expect(hasPermission(addonInfo, 'config.write')).toBe(false);
    });
  });

  describe('matchesPermission', () => {
    it('should match exact permission', () => {
      expect(matchesPermission(['sessions.read'], 'sessions.read')).toBe(true);
      expect(matchesPermission(['config.write'], 'config.write')).toBe(true);
    });

    it('should match wildcard permission', () => {
      expect(matchesPermission(['*'], 'sessions.read')).toBe(true);
      expect(matchesPermission(['*'], 'agents.invoke')).toBe(true);
      expect(matchesPermission(['*'], 'anything.at.all')).toBe(true);
    });

    it('should match resource wildcard', () => {
      expect(matchesPermission(['sessions.*'], 'sessions.read')).toBe(true);
      expect(matchesPermission(['sessions.*'], 'sessions.write')).toBe(true);
      expect(matchesPermission(['sessions.*'], 'sessions.read.anything')).toBe(
        true,
      );
      expect(matchesPermission(['sessions.*'], 'agents.invoke')).toBe(false);
    });

    it('should match scoped permissions', () => {
      expect(
        matchesPermission(['agents.invoke:price'], 'agents.invoke:price'),
      ).toBe(true);
      expect(matchesPermission(['agents.invoke:price'], 'agents.invoke')).toBe(
        false,
      );
      expect(
        matchesPermission(['agents.invoke:price'], 'agents.invoke:other'),
      ).toBe(false);
    });

    it('should handle multiple permissions', () => {
      const granted = ['sessions.read', 'agents.*', 'config.write:pricing'];

      expect(matchesPermission(granted, 'sessions.read')).toBe(true);
      expect(matchesPermission(granted, 'agents.invoke')).toBe(true);
      expect(matchesPermission(granted, 'agents.read')).toBe(true);
      expect(matchesPermission(granted, 'config.write:pricing')).toBe(true);
      expect(matchesPermission(granted, 'config.write:other')).toBe(false);
      expect(matchesPermission(granted, 'sessions.write')).toBe(false);
    });
  });
});
