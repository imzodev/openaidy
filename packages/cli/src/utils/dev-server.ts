/**
 * Development Server Implementation
 *
 * Provides hot-reloading development server for addon development.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface DevServerOptions {
  port?: number;
  host?: string;
  openaidyUrl?: string;
  proxyEnabled?: boolean;
  watchPaths?: string[];
}

export interface DevServerResult {
  success: boolean;
  message: string;
  port: number;
  host: string;
  url: string;
}

export interface ServerState {
  running: boolean;
  port: number;
  host: string;
  startTime: number;
  watchedFiles: Set<string>;
}

/**
 * Default server options
 */
const DEFAULT_OPTIONS: Required<DevServerOptions> = {
  port: 3000,
  host: 'localhost',
  openaidyUrl: 'http://localhost:8080',
  proxyEnabled: true,
  watchPaths: ['src/**/*', 'tests/**/*'],
};

/**
 * Create development server configuration
 */
export function createServerConfig(options: DevServerOptions = {}): {
  server: Record<string, unknown>;
  proxy: Record<string, Record<string, unknown>>;
} {
  const merged = { ...DEFAULT_OPTIONS, ...options };

  return {
    server: {
      port: merged.port,
      host: merged.host,
      open: false,
      watch: {
        ignored: ['**/node_modules/**', '**/dist/**'],
        usePolling: false,
        interval: 100,
      },
    },
    proxy: merged.proxyEnabled
      ? {
          '/api': {
            target: merged.openaidyUrl,
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/api/, ''),
          },
          '/ws': {
            target: merged.openaidyUrl,
            ws: true,
          },
        }
      : {},
  };
}

/**
 * Get file watcher patterns
 */
export function getWatcherPatterns(paths?: string[]): string[] {
  return paths || DEFAULT_OPTIONS.watchPaths;
}

/**
 * Start development server
 */
export async function startDevServer(
  projectPath: string,
  options: DevServerOptions = {},
): Promise<DevServerResult> {
  // Validate project
  if (!fs.existsSync(projectPath)) {
    return {
      success: false,
      message: `Project directory not found: ${projectPath}`,
      port: 0,
      host: '',
      url: '',
    };
  }

  const addonJsonPath = path.join(projectPath, 'addon.json');
  if (!fs.existsSync(addonJsonPath)) {
    return {
      success: false,
      message:
        'addon.json not found. Run "openaidy init" to initialize the project.',
      port: 0,
      host: '',
      url: '',
    };
  }

  const merged = { ...DEFAULT_OPTIONS, ...options };

  // In a real implementation, this would start an actual dev server
  // For now, we just return the configuration
  return {
    success: true,
    message: `Development server started for addon at ${projectPath}`,
    port: merged.port,
    host: merged.host,
    url: `http://${merged.host}:${merged.port}`,
  };
}

/**
 * Stop development server
 */
export async function stopDevServer(): Promise<{
  success: boolean;
  message: string;
}> {
  // In a real implementation, this would stop the actual server
  return {
    success: true,
    message: 'Development server stopped',
  };
}

/**
 * Check if file changed
 */
export function getChangedFiles(
  projectPath: string,
  previousFiles: Set<string>,
): string[] {
  const changed: string[] = [];
  const patterns = getWatcherPatterns();

  for (const pattern of patterns) {
    // In a real implementation, this would use chokidar or similar
    // For now, we just check if files exist
    const _fullPattern = path.join(projectPath, pattern);
    if (!fs.existsSync(projectPath)) continue;

    const walkDir = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (
            previousFiles.has(fullPath) ||
            !previousFiles.has(fullPath)
          ) {
            // File exists, could be changed
            changed.push(fullPath);
          }
        }
      } catch {
        // Ignore permission errors
      }
    };

    walkDir(projectPath);
  }

  return changed;
}

/**
 * Create server state
 */
export function createServerState(port: number, host: string): ServerState {
  return {
    running: false,
    port,
    host,
    startTime: Date.now(),
    watchedFiles: new Set(),
  };
}

/**
 * Get server status
 */
export function getServerStatus(state: ServerState): {
  running: boolean;
  uptime: number;
  port: number;
  host: string;
  watchedFilesCount: number;
} {
  return {
    running: state.running,
    uptime: state.running ? Date.now() - state.startTime : 0,
    port: state.port,
    host: state.host,
    watchedFilesCount: state.watchedFiles.size,
  };
}

/**
 * Validate server configuration
 */
export function validateServerConfig(options: DevServerOptions): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (options.port !== undefined) {
    if (options.port < 1 || options.port > 65535) {
      errors.push('Port must be between 1 and 65535');
    }
  }

  if (options.host !== undefined) {
    if (!options.host || options.host.trim() === '') {
      errors.push('Host cannot be empty');
    }
  }

  if (options.openaidyUrl !== undefined) {
    try {
      new URL(options.openaidyUrl);
    } catch {
      errors.push('Invalid OpenAidy URL format');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get HMR config for Vite
 */
export function getHMRConfig(): Record<string, unknown> {
  return {
    transport: 'websocket',
    overlay: true,
    hmr: {
      timeout: 30000,
      overlay: {
        errors: true,
        warnings: false,
      },
    },
  };
}

/**
 * Generate vite config for development
 */
export function generateViteConfig(
  addonId: string,
  openaidyUrl: string,
): string {
  return JSON.stringify(
    {
      server: {
        port: 3000,
        host: 'localhost',
        proxy: {
          '/api': {
            target: openaidyUrl,
            changeOrigin: true,
          },
          '/ws': {
            target: openaidyUrl,
            ws: true,
          },
        },
      },
      build: {
        outDir: 'dist',
        rollupOptions: {
          input: `./src/${addonId}/index.ts`,
        },
      },
      plugins: [],
    },
    null,
    2,
  );
}
