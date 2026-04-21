/**
 * Dependency Resolver Service
 *
 * Engine for resolving addon dependencies, detecting conflicts,
 * and constructing dependency graphs.
 */

import { satisfiesVersion, compareVersions } from './version-manager';

export interface Dependency {
  addonId: string;
  versionRange: string;
  optional: boolean;
}

export interface DependencyNode {
  addonId: string;
  version: string;
  dependencies: Dependency[];
  depth: number;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Array<{ from: string; to: string }>;
  rootAddon: string;
}

export interface ResolutionResult {
  success: boolean;
  resolved: Map<string, string>;
  conflicts: Conflict[];
  missing: MissingDependency[];
  cycles: string[][];
}

export interface Conflict {
  addonId: string;
  requested: string;
  resolved: string;
  reason: string;
}

export interface MissingDependency {
  addonId: string;
  requiredBy: string;
  versionRange: string;
}

export interface ResolutionOptions {
  preferLatest?: boolean;
  allowPrerelease?: boolean;
  timeout?: number;
}

/**
 * Dependency Resolver class
 */
export class DependencyResolver {
  private registry: Map<string, Map<string, Record<string, unknown>>> =
    new Map(); // addonId -> version -> manifest

  /**
   * Register an addon version
   */
  registerAddon(
    addonId: string,
    version: string,
    manifest: Record<string, unknown>,
  ): void {
    if (!this.registry.has(addonId)) {
      this.registry.set(addonId, new Map());
    }
    this.registry.get(addonId)!.set(version, manifest);
  }

  /**
   * Get available versions for an addon
   */
  getVersions(addonId: string): string[] {
    const versions = this.registry.get(addonId);
    if (!versions) return [];
    return Array.from(versions.keys()).sort((a, b) => compareVersions(b, a));
  }

  /**
   * Get latest version for an addon
   */
  getLatestVersion(addonId: string): string | null {
    const versions = this.getVersions(addonId);
    return versions[0] || null;
  }

  /**
   * Get dependencies for an addon version
   */
  getDependencies(addonId: string, version: string): Dependency[] {
    const manifest = this.registry.get(addonId)?.get(version);
    if (!manifest) return [];

    const deps = manifest.dependencies as Record<string, string> | undefined;
    if (!deps) return [];

    return Object.entries(deps).map(([id, versionRange]) => ({
      addonId: id,
      versionRange,
      optional: false,
    }));
  }

  /**
   * Build dependency graph
   */
  buildGraph(rootAddonId: string, rootVersion: string): DependencyGraph {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: [],
      rootAddon: rootAddonId,
    };

    const visited = new Set<string>();
    const traverse = (addonId: string, version: string, depth: number) => {
      const key = `${addonId}@${version}`;
      if (visited.has(key)) return;
      visited.add(key);

      const node: DependencyNode = {
        addonId,
        version,
        dependencies: this.getDependencies(addonId, version),
        depth,
      };
      graph.nodes.set(key, node);

      for (const dep of node.dependencies) {
        const depVersion = this.resolveVersion(dep.addonId, dep.versionRange);
        if (depVersion) {
          graph.edges.push({ from: key, to: `${dep.addonId}@${depVersion}` });
          traverse(dep.addonId, depVersion, depth + 1);
        }
      }
    };

    traverse(rootAddonId, rootVersion, 0);
    return graph;
  }

  /**
   * Resolve version for a dependency
   */
  private resolveVersion(addonId: string, versionRange: string): string | null {
    const versions = this.getVersions(addonId);
    for (const ver of versions) {
      if (satisfiesVersion(ver, versionRange)) {
        return ver;
      }
    }
    return null;
  }

  /**
   * Detect circular dependencies
   */
  detectCycles(graph: DependencyGraph): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const edges = graph.edges.filter((e) => e.from === nodeId);
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          dfs(edge.to);
        } else if (recursionStack.has(edge.to)) {
          // Found cycle
          const cycleStart = path.indexOf(edge.to);
          if (cycleStart !== -1) {
            cycles.push([...path.slice(cycleStart), edge.to]);
          }
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Resolve all dependencies for an addon
   */
  resolve(
    rootAddonId: string,
    rootVersion: string,
    _options: ResolutionOptions = {},
  ): ResolutionResult {
    const result: ResolutionResult = {
      success: true,
      resolved: new Map(),
      conflicts: [],
      missing: [],
      cycles: [],
    };

    const graph = this.buildGraph(rootAddonId, rootVersion);

    // Check for cycles
    result.cycles = this.detectCycles(graph);
    if (result.cycles.length > 0) {
      result.success = false;
      return result;
    }

    // Resolve each node
    for (const [_nodeId, node] of graph.nodes) {
      // Check if already resolved with compatible version
      const existing = result.resolved.get(node.addonId);
      if (existing) {
        // Check for conflict
        if (!satisfiesVersion(existing, node.version)) {
          result.conflicts.push({
            addonId: node.addonId,
            requested: node.version,
            resolved: existing,
            reason: `Version conflict: requested ${node.version} but ${existing} is already resolved`,
          });
        }
      } else {
        // Resolve version
        const resolvedVersion = this.resolveVersion(node.addonId, node.version);
        if (resolvedVersion) {
          result.resolved.set(node.addonId, resolvedVersion);
        } else {
          result.missing.push({
            addonId: node.addonId,
            requiredBy: rootAddonId,
            versionRange: node.version,
          });
          result.success = false;
        }
      }
    }

    return result;
  }

  /**
   * Find optimal dependency resolution
   */
  findOptimalResolution(
    rootAddonId: string,
    rootVersion: string,
    _options: ResolutionOptions = {},
  ): ResolutionResult {
    // Start with basic resolution
    const bestResult = this.resolve(rootAddonId, rootVersion, options);

    if (bestResult.success) {
      return bestResult;
    }

    // Try to resolve conflicts by upgrading versions
    const { conflicts } = bestResult;
    for (const conflict of conflicts) {
      // Try to find a common compatible version
      const conflictVersions = this.getVersions(conflict.addonId);
      for (const _ver of conflictVersions) {
        const testResult = this.resolve(rootAddonId, rootVersion, _options);
        if (testResult.success) {
          return testResult;
        }
      }
    }

    return bestResult;
  }

  /**
   * Get dependency tree for visualization
   */
  getDependencyTree(
    rootAddonId: string,
    rootVersion: string,
  ): {
    addonId: string;
    version: string;
    dependencies: Array<{
      addonId: string;
      version: string;
      optional: boolean;
      children: unknown[];
    }>;
  } | null {
    const latestVersion = this.getLatestVersion(rootAddonId);
    if (!latestVersion) return null;

    const version = rootVersion || latestVersion;
    const graph = this.buildGraph(rootAddonId, version);

    const buildTree = (
      addonId: string,
      ver: string,
      _depth: number = 0,
    ): unknown => {
      const key = `${addonId}@${ver}`;
      const node = graph.nodes.get(key);
      if (!node) return null;

      return {
        addonId: node.addonId,
        version: node.version,
        dependencies: node.dependencies.map((dep) => ({
          addonId: dep.addonId,
          versionRange: dep.versionRange,
          optional: dep.optional,
          resolved: this.resolveVersion(dep.addonId, dep.versionRange),
          children: [],
        })),
      };
    };

    return buildTree(rootAddonId, version) as {
      addonId: string;
      version: string;
      dependencies: Array<{
        addonId: string;
        version: string;
        optional: boolean;
        children: unknown[];
      }>;
    } | null;
  }

  /**
   * Check if addon has unresolvable dependencies
   */
  hasUnresolvableDependencies(addonId: string, version: string): boolean {
    const result = this.resolve(addonId, version);
    return !result.success;
  }
}

/**
 * Create dependency resolver instance
 */
export function createDependencyResolver(): DependencyResolver {
  return new DependencyResolver();
}
