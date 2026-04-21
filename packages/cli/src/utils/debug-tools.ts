/**
 * Debug Tools - Advanced debugging utilities for addon development
 */

import os from 'node:os';

export interface DebugOptions {
  verbose?: boolean;
  breakpoint?: boolean;
  trace?: boolean;
}

export interface DebugResult {
  success: boolean;
  output: string;
  duration?: number;
}

export interface PerformanceProfile {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  memory?: number;
}

export interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

export class DebugTools {
  private profiles: Map<string, PerformanceProfile> = new Map();
  private snapshots: MemorySnapshot[] = [];

  /**
   * Start a performance profile
   */
  startProfile(name: string): void {
    this.profiles.set(name, {
      name,
      startTime: Date.now(),
    });
  }

  /**
   * End a performance profile
   */
  endProfile(name: string): PerformanceProfile | undefined {
    const profile = this.profiles.get(name);
    if (profile) {
      profile.endTime = Date.now();
      profile.duration = profile.endTime - profile.startTime;
      return profile;
    }
    return undefined;
  }

  /**
   * Get all profiles
   */
  getProfiles(): PerformanceProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Clear all profiles
   */
  clearProfiles(): void {
    this.profiles.clear();
  }

  /**
   * Take a memory snapshot
   */
  takeMemorySnapshot(): MemorySnapshot {
    const memUsage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Get memory snapshots
   */
  getMemorySnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Clear memory snapshots
   */
  clearMemorySnapshots(): void {
    this.snapshots = [];
  }

  /**
   * Get memory usage delta between snapshots
   */
  getMemoryDelta(): { used: number; total: number } | null {
    if (this.snapshots.length < 2) return null;
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    return {
      used: last.heapUsed - first.heapUsed,
      total: last.heapTotal - first.heapTotal,
    };
  }

  /**
   * Debug a function execution
   */
  async debugFunction<T>(
    fn: () => T | Promise<T>,
    options: DebugOptions = {},
  ): Promise<{ result: T; profile: PerformanceProfile }> {
    const name = `debug-${Date.now()}`;
    this.startProfile(name);

    if (options.trace) {
      console.log(`[DEBUG] Starting: ${fn.name || 'anonymous'}`);
    }

    let result: T;
    try {
      result = await fn();
    } finally {
      const profile = this.endProfile(name);
      if (profile && options.verbose) {
        console.log(`[DEBUG] Completed in ${profile.duration}ms`);
      }
    }

    return {
      result,
      profile: this.endProfile(name)!,
    };
  }

  /**
   * Inspect object structure
   */
  inspectObject(obj: unknown, depth: number = 3): string {
    const seen = new WeakSet();

    function format(value: unknown, currentDepth: number): string {
      if (currentDepth > depth) return '...';

      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'boolean') return String(value);
      if (typeof value === 'number') return String(value);
      if (typeof value === 'string') return `"${value}"`;
      if (typeof value === 'function')
        return `[Function: ${value.name || 'anonymous'}]`;

      if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.slice(0, 5).map((v) => format(v, currentDepth + 1));
        const more = value.length > 5 ? `, ... +${value.length - 5} more` : '';
        return `[${items.join(', ')}${more}]`;
      }

      if (typeof value === 'object') {
        if (seen.has(value as object)) return '[Circular]';
        seen.add(value as object);

        const entries = Object.entries(value as Record<string, unknown>).slice(
          0,
          10,
        );
        const props = entries.map(
          ([k, v]) => `${k}: ${format(v, currentDepth + 1)}`,
        );
        const more =
          Object.keys(value).length > 10
            ? `, ... +${Object.keys(value).length - 10} more`
            : '';
        return `{${props.join(', ')}${more}}`;
      }

      return String(value);
    }

    return format(obj, 0);
  }

  /**
   * Debug network request
   */
  async debugNetworkRequest(
    url: string,
    options: RequestInit = {},
  ): Promise<{ response: unknown; timing: number }> {
    const start = Date.now();
    const response = await fetch(url, options);
    const timing = Date.now() - start;
    const data = await response.json();
    return { response: data, timing };
  }

  /**
   * Create breakpoint helper
   */
  breakpoint(message?: string): void {
    if (message) {
      console.log(`[BREAKPOINT] ${message}`);
    }
    console.log('Press Ctrl+C to continue or type "continue" to proceed...');
    // In real implementation, this would pause execution
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Get system information
   */
  getSystemInfo(): {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpus: number;
    memory: { total: string; free: string };
  } {
    const mem = process.memoryUsage();
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      memory: {
        total: this.formatBytes(mem.heapTotal),
        free: this.formatBytes(mem.heapTotal - mem.heapUsed),
      },
    };
  }
}

/**
 * Create debug session
 */
export function createDebugSession(): {
  tools: DebugTools;
  start: () => void;
  stop: () => PerformanceProfile[];
} {
  const tools = new DebugTools();

  return {
    tools,
    start: () => {
      console.log('[DEBUG] Session started');
    },
    stop: () => {
      const profiles = tools.getProfiles();
      console.log('[DEBUG] Session ended');
      for (const profile of profiles) {
        console.log(`  - ${profile.name}: ${profile.duration}ms`);
      }
      return profiles;
    },
  };
}
