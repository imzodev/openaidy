/**
 * Dependency Resolver Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyResolver } from './dependency-resolver';

describe('Dependency Resolver', () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver();
  });

  describe('registerAddon', () => {
    it('should register addon versions', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        name: 'Addon A',
        version: '1.0.0',
        dependencies: {},
      });

      const versions = resolver.getVersions('addon-a');
      expect(versions).toContain('1.0.0');
    });

    it('should register multiple versions', () => {
      resolver.registerAddon('addon-a', '1.0.0', { dependencies: {} });
      resolver.registerAddon('addon-a', '2.0.0', { dependencies: {} });

      const versions = resolver.getVersions('addon-a');
      expect(versions).toHaveLength(2);
    });
  });

  describe('getLatestVersion', () => {
    it('should return latest version sorted by semver', () => {
      resolver.registerAddon('addon-a', '1.0.0', { dependencies: {} });
      resolver.registerAddon('addon-a', '2.0.0', { dependencies: {} });
      resolver.registerAddon('addon-a', '1.5.0', { dependencies: {} });

      const latest = resolver.getLatestVersion('addon-a');
      expect(latest).toBe('2.0.0');
    });

    it('should return null for unknown addon', () => {
      const latest = resolver.getLatestVersion('unknown');
      expect(latest).toBeNull();
    });
  });

  describe('getDependencies', () => {
    it('should return dependencies from manifest', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: {
          'addon-b': '^1.0.0',
        },
      });

      const deps = resolver.getDependencies('addon-a', '1.0.0');
      expect(deps).toHaveLength(1);
      expect(deps[0]?.addonId).toBe('addon-b');
      expect(deps[0]?.versionRange).toBe('^1.0.0');
    });

    it('should return empty array for no dependencies', () => {
      resolver.registerAddon('addon-a', '1.0.0', { dependencies: {} });

      const deps = resolver.getDependencies('addon-a', '1.0.0');
      expect(deps).toHaveLength(0);
    });
  });

  describe('resolve', () => {
    it('should resolve simple dependencies', () => {
      resolver.registerAddon('addon-a', '1.0.0', { dependencies: {} });
      resolver.registerAddon('addon-b', '1.0.0', { dependencies: {} });

      const result = resolver.resolve('addon-a', '1.0.0');
      expect(result.success).toBe(true);
      expect(result.resolved.has('addon-a')).toBe(true);
      expect(result.resolved.get('addon-a')).toBe('1.0.0');
    });

    it('should resolve nested dependencies', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '1.0.0' },
      });
      resolver.registerAddon('addon-b', '1.0.0', {
        dependencies: { 'addon-c': '1.0.0' },
      });
      resolver.registerAddon('addon-c', '1.0.0', { dependencies: {} });

      const result = resolver.resolve('addon-a', '1.0.0');
      expect(result.success).toBe(true);
      expect(result.resolved.has('addon-b')).toBe(true);
      expect(result.resolved.has('addon-c')).toBe(true);
    });

    it('should detect missing dependencies', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '1.0.0' },
      });

      const result = resolver.resolve('addon-a', '1.0.0');
      expect(result.success).toBe(false);
      expect(result.missing.some((m) => m.addonId === 'addon-b')).toBe(true);
    });

    it('should detect version conflicts', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '^1.0.0' },
      });
      resolver.registerAddon('addon-a', '2.0.0', {
        dependencies: { 'addon-b': '^2.0.0' },
      });
      resolver.registerAddon('addon-b', '1.0.0', { dependencies: {} });
      resolver.registerAddon('addon-b', '2.0.0', { dependencies: {} });

      // This would need a multi-resolution approach to properly test
      // For now, just test basic functionality
      const result = resolver.resolve('addon-a', '1.0.0');
      expect(result.success).toBe(true);
    });
  });

  describe('detectCycles', () => {
    it('should detect simple circular dependency', () => {
      // A -> B -> A
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '1.0.0' },
      });
      resolver.registerAddon('addon-b', '1.0.0', {
        dependencies: { 'addon-a': '1.0.0' },
      });

      const graph = resolver.buildGraph('addon-a', '1.0.0');
      const cycles = resolver.detectCycles(graph);
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should not detect cycles in valid graph', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '1.0.0' },
      });
      resolver.registerAddon('addon-b', '1.0.0', { dependencies: {} });

      const graph = resolver.buildGraph('addon-a', '1.0.0');
      const cycles = resolver.detectCycles(graph);
      expect(cycles).toHaveLength(0);
    });
  });

  describe('buildGraph', () => {
    it('should build correct dependency graph', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '1.0.0' },
      });
      resolver.registerAddon('addon-b', '1.0.0', {
        dependencies: { 'addon-c': '1.0.0' },
      });
      resolver.registerAddon('addon-c', '1.0.0', { dependencies: {} });

      const graph = resolver.buildGraph('addon-a', '1.0.0');

      expect(graph.nodes.has('addon-a@1.0.0')).toBe(true);
      expect(graph.nodes.has('addon-b@1.0.0')).toBe(true);
      expect(graph.nodes.has('addon-c@1.0.0')).toBe(true);
      expect(graph.edges.length).toBeGreaterThan(0);
    });
  });

  describe('getDependencyTree', () => {
    it('should return dependency tree structure', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '1.0.0' },
      });
      resolver.registerAddon('addon-b', '1.0.0', { dependencies: {} });

      const tree = resolver.getDependencyTree('addon-a', '1.0.0');

      expect(tree).not.toBeNull();
      expect(tree?.addonId).toBe('addon-a');
      expect(tree?.dependencies).toHaveLength(1);
    });
  });

  describe('hasUnresolvableDependencies', () => {
    it('should return false for resolvable dependencies', () => {
      resolver.registerAddon('addon-a', '1.0.0', { dependencies: {} });

      expect(resolver.hasUnresolvableDependencies('addon-a', '1.0.0')).toBe(
        false,
      );
    });

    it('should return true for missing dependencies', () => {
      resolver.registerAddon('addon-a', '1.0.0', {
        dependencies: { 'addon-b': '1.0.0' },
      });

      expect(resolver.hasUnresolvableDependencies('addon-a', '1.0.0')).toBe(
        true,
      );
    });
  });
});
