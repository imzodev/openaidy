/**
 * Dev Command - Start development server with hot reloading
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import type { CommandResult } from '../../types.js';
import path from 'node:path';
import { readAddonManifest } from '../../utils/project.js';

export interface DevOptions {
  port?: number;
  host?: string;
  openaidyUrl?: string;
  proxy?: boolean;
}

export interface DevResult {
  success: boolean;
  message: string;
  port?: number;
  host?: string;
}

/**
 * Start development server
 */
export async function startDevServer(
  projectPath: string = process.cwd(),
  _options: DevOptions = {},
): Promise<DevResult> {
  const { port = 3000, host = 'localhost' } = _options;

  // Check if project exists
  if (!fs.existsSync(projectPath)) {
    return {
      success: false,
      message: `Project directory not found: ${projectPath}`,
    };
  }

  // Read manifest
  const manifest = readAddonManifest(projectPath);
  if (!manifest) {
    return {
      success: false,
      message:
        'addon.json not found. Run "openaidy init" to initialize the project.',
    };
  }

  // Check for src directory
  const srcPath = path.join(projectPath, 'src');
  if (!fs.existsSync(srcPath)) {
    return {
      success: false,
      message: 'src directory not found. Addon may be incomplete.',
    };
  }

  // In a real implementation, this would:
  // 1. Start a Vite dev server
  // 2. Set up file watching
  // 3. Configure HMR
  // 4. Set up proxy to OpenAidy backend

  return {
    success: true,
    message: `Development server started for addon: ${manifest.name}`,
    port,
    host,
  };
}

/**
 * Get Vite configuration for development
 */
export function getViteConfig(addonId: string, openaidyUrl: string) {
  return {
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
  };
}

/**
 * Watch for file changes and trigger rebuild
 */
export async function watchFiles(
  projectPath: string,
  callback: (changedFile: string) => void,
): Promise<() => void> {
  // In a real implementation, this would use chokidar
  const srcPath = path.join(projectPath, 'src');

  if (!fs.existsSync(srcPath)) {
    return () => {};
  }

  // Placeholder for file watching
  const interval = setInterval(() => {
    // Check for file changes
    callback('src/index.ts');
  }, 5000);

  return () => clearInterval(interval);
}

export async function addonDevHandler(args: string[]): Promise<CommandResult> {
  const options: Record<string, string | number> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') options.port = parseInt(args[++i]!, 10);
    else if (args[i] === '--host') options.host = args[++i]!;
    else if (args[i] === '--openaidy-url') options.openaidyUrl = args[++i]!;
  }

  const s = p.spinner();
  s.start('Starting dev server\u2026');
  const result = await startDevServer(process.cwd(), options);
  if (result.success) {
    s.stop('Dev server started.');
    p.outro(
      `${result.message}\n  Server running at http://${result.host}:${result.port}\n  Press Ctrl+C to stop`,
    );
    return { exitCode: 0 };
  } else {
    s.stop('Failed to start dev server.');
    p.log.error(result.message);
    return { exitCode: 1, error: result.message };
  }
}
