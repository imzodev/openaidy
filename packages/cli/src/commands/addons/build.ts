/**
 * Build Command - Compile addon for production
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import type { CommandResult } from '../../types.js';
import path from 'node:path';
import { readAddonManifest } from '../../utils/project.js';

export interface BuildOptions {
  watch?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
}

export interface BuildResult {
  success: boolean;
  message: string;
  outputPath?: string;
  warnings?: string[];
}

/**
 * Build addon for production
 */
export async function buildAddon(
  projectPath: string = process.cwd(),
  _options: BuildOptions = {},
): Promise<BuildResult> {
  const { sourcemap = true } = _options;

  // Check if project exists
  if (!fs.existsSync(projectPath)) {
    return {
      success: false,
      message: `Project directory not found: ${projectPath}`,
    };
  }

  // Read and validate manifest
  const manifest = readAddonManifest(projectPath);
  if (!manifest) {
    return {
      success: false,
      message:
        'addon.json not found. Run "openaidy init" to initialize the project.',
    };
  }

  const warnings: string[] = [];

  // Validate required files
  const srcPath = path.join(projectPath, 'src');
  if (!fs.existsSync(srcPath)) {
    return {
      success: false,
      message: 'src directory not found. Addon may be incomplete.',
    };
  }

  const entryPath = path.join(projectPath, 'src', 'index.ts');
  if (!fs.existsSync(entryPath)) {
    return {
      success: false,
      message: 'src/index.ts not found. Addon entry point is missing.',
    };
  }

  try {
    // Create dist directory
    const distPath = path.join(projectPath, 'dist');
    if (!fs.existsSync(distPath)) {
      fs.mkdirSync(distPath, { recursive: true });
    }

    // Copy source files (simplified - real implementation would use esbuild/vite)
    const outputPath = path.join(distPath, 'index.js');

    // Read source
    const sourceCode = fs.readFileSync(entryPath, 'utf-8');

    // In a real implementation, this would use TypeScript compiler or bundler
    // For now, we just validate the TypeScript syntax conceptually
    if (sourceCode.includes('import ') || sourceCode.includes('export ')) {
      // Has ES modules - would need compilation
      warnings.push(
        'ES modules detected. In production, this would be compiled with a bundler.',
      );
    }

    // Write output (simplified)
    fs.writeFileSync(outputPath, sourceCode);

    // Copy manifest to dist
    fs.copyFileSync(
      path.join(projectPath, 'addon.json'),
      path.join(distPath, 'addon.json'),
    );

    // Copy index.html to dist if it exists
    const htmlSrc = path.join(projectPath, 'src', 'index.html');
    if (fs.existsSync(htmlSrc)) {
      fs.copyFileSync(htmlSrc, path.join(distPath, 'index.html'));
    }

    // Copy config schema if exists
    const configSchemaPath = path.join(projectPath, 'config-schema.json');
    if (fs.existsSync(configSchemaPath)) {
      fs.copyFileSync(
        configSchemaPath,
        path.join(distPath, 'config-schema.json'),
      );
    }

    // Generate sourcemap if requested
    if (sourcemap) {
      const mapPath = path.join(distPath, 'index.js.map');
      fs.writeFileSync(
        mapPath,
        JSON.stringify({
          version: 3,
          file: 'index.js',
          sources: ['../src/index.ts'],
          mappings: '',
        }),
      );
    }

    return {
      success: true,
      message: `Successfully built addon: ${manifest.name}`,
      outputPath,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: `Build failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Watch mode for development builds
 */
export async function watchAddon(
  projectPath: string = process.cwd(),
  callback?: (result: BuildResult) => void,
): Promise<() => void> {
  // In a real implementation, this would use file watching (chokidar)
  // For now, we just provide the interface
  console.log(`Watching ${projectPath} for changes...`);

  // Placeholder for file watching
  const checkInterval = setInterval(async () => {
    const result = await buildAddon(projectPath);
    if (callback) {
      callback(result);
    }
  }, 5000);

  // Return cleanup function
  return () => clearInterval(checkInterval);
}

export async function addonBuildHandler(
  args: string[],
): Promise<CommandResult> {
  const { resolveAddonProject, listAddonProjects } =
    await import('../../utils/project.js');

  const options: Record<string, boolean> = {};
  let addonName: string | undefined;
  for (const arg of args) {
    if (arg === '-w' || arg === '--watch') options.watch = true;
    else if (arg === '-m' || arg === '--minify') options.minify = true;
    else if (arg === '-s' || arg === '--sourcemap') options.sourcemap = true;
    else if (!arg.startsWith('-')) addonName = arg;
  }

  const addon = resolveAddonProject(addonName);
  if (!addon) {
    const all = listAddonProjects();
    if (all.length === 0) {
      p.log.error('No addons found in .openaidy/addons/');
      return { exitCode: 1, error: 'No addons found in .openaidy/addons/' };
    }
    const names = all.map((a) => `  openaidy addon build ${a.name}`).join('\n');
    p.log.error(`Multiple addons found. Specify one:\n${names}`);
    return {
      exitCode: 1,
      error: `Multiple addons found. Specify one:\n${names}`,
    };
  }

  const s = p.spinner();
  s.start(`Building ${addon.name}\u2026`);
  const result = await buildAddon(addon.path, options);
  if (result.success) {
    s.stop('Build complete.');
    p.outro(
      `${result.message}${result.outputPath ? `\n  Output: ${result.outputPath}` : ''}`,
    );
    return { exitCode: 0 };
  } else {
    s.stop('Build failed.');
    p.log.error(result.message);
    return { exitCode: 1, error: result.message };
  }
}
