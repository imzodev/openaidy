/**
 * Plugin System for CLI Extensibility
 */

import fs from 'node:fs';
import path from 'node:path';

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  dependencies?: Record<string, string>;
}

export interface PluginLoadResult {
  success: boolean;
  plugin?: Plugin;
  error?: string;
}

export interface PluginHooks {
  beforeCommand?: (command: string, args: string[]) => void | Promise<void>;
  afterCommand?: (
    command: string,
    args: string[],
    result: unknown,
  ) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export class PluginSystem {
  private plugins: Map<string, Plugin> = new Map();
  private hooks: Map<string, PluginHooks> = new Map();
  private pluginDir: string;

  constructor(pluginDir?: string) {
    this.pluginDir = pluginDir || path.join(process.cwd(), '.openaidy-plugins');
  }

  /**
   * Discover available plugins
   */
  async discoverPlugins(): Promise<Plugin[]> {
    const discovered: Plugin[] = [];

    if (!fs.existsSync(this.pluginDir)) {
      return discovered;
    }

    const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(
          this.pluginDir,
          entry.name,
          'plugin.json',
        );
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(
              fs.readFileSync(manifestPath, 'utf-8'),
            ) as PluginManifest;
            discovered.push({
              id: manifest.id,
              name: manifest.name,
              version: manifest.version,
              description: manifest.description,
              author: manifest.author,
              enabled: false,
              config: {},
            });
          } catch {
            // Skip invalid plugins
          }
        }
      }
    }

    return discovered;
  }

  /**
   * Load a plugin by ID
   */
  async loadPlugin(pluginId: string): Promise<PluginLoadResult> {
    const pluginPath = path.join(this.pluginDir, pluginId, 'plugin.json');

    if (!fs.existsSync(pluginPath)) {
      return { success: false, error: `Plugin not found: ${pluginId}` };
    }

    try {
      const manifest = JSON.parse(
        fs.readFileSync(pluginPath, 'utf-8'),
      ) as PluginManifest;
      const plugin: Plugin = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        enabled: true,
        config: {},
      };

      this.plugins.set(pluginId, plugin);

      // Load hooks if available
      const hooksPath = path.join(this.pluginDir, pluginId, 'hooks.js');
      if (fs.existsSync(hooksPath)) {
        const hooks = await import(`file://${hooksPath}`);
        this.hooks.set(pluginId, hooks.default || hooks);
      }

      return { success: true, plugin };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Unload a plugin
   */
  unloadPlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      this.plugins.delete(pluginId);
      this.hooks.delete(pluginId);
      return true;
    }
    return false;
  }

  /**
   * Get all loaded plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin by ID
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Enable a plugin
   */
  enablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable a plugin
   */
  disablePlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Update plugin configuration
   */
  updatePluginConfig(
    pluginId: string,
    config: Record<string, unknown>,
  ): boolean {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.config = { ...plugin.config, ...config };
      return true;
    }
    return false;
  }

  /**
   * Get hooks for a plugin
   */
  getPluginHooks(pluginId: string): PluginHooks | undefined {
    return this.hooks.get(pluginId);
  }

  /**
   * Execute before command hooks
   */
  async executeBeforeCommandHooks(
    command: string,
    args: string[],
  ): Promise<void> {
    for (const [pluginId, hooks] of this.hooks) {
      const plugin = this.plugins.get(pluginId);
      if (plugin?.enabled && hooks.beforeCommand) {
        try {
          await hooks.beforeCommand(command, args);
        } catch {
          // Ignore hook errors
        }
      }
    }
  }

  /**
   * Execute after command hooks
   */
  async executeAfterCommandHooks(
    command: string,
    args: string[],
    result: unknown,
  ): Promise<void> {
    for (const [pluginId, hooks] of this.hooks) {
      const plugin = this.plugins.get(pluginId);
      if (plugin?.enabled && hooks.afterCommand) {
        try {
          await hooks.afterCommand(command, args, result);
        } catch {
          // Ignore hook errors
        }
      }
    }
  }

  /**
   * Validate plugin security
   */
  validatePlugin(pluginId: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const pluginPath = path.join(this.pluginDir, pluginId);

    // Check plugin directory exists
    if (!fs.existsSync(pluginPath)) {
      errors.push('Plugin directory not found');
      return { valid: false, errors };
    }

    // Check manifest exists
    const manifestPath = path.join(pluginPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      errors.push('Plugin manifest not found');
    }

    // Check main file exists
    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf-8'),
      ) as PluginManifest;
      const mainPath = path.join(pluginPath, manifest.main || 'index.js');
      if (!fs.existsSync(mainPath)) {
        errors.push('Plugin main file not found');
      }
    } catch {
      errors.push('Invalid plugin manifest');
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Create a new plugin
 */
export async function createPlugin(
  pluginDir: string,
  id: string,
  name: string,
  version: string = '1.0.0',
): Promise<{ success: boolean; path?: string; error?: string }> {
  const pluginPath = path.join(pluginDir, id);

  if (fs.existsSync(pluginPath)) {
    return { success: false, error: 'Plugin already exists' };
  }

  try {
    fs.mkdirSync(pluginPath, { recursive: true });

    const manifest: PluginManifest = {
      id,
      name,
      version,
      description: `${name} plugin for OpenAidy CLI`,
      main: 'index.js',
    };

    fs.writeFileSync(
      path.join(pluginPath, 'plugin.json'),
      JSON.stringify(manifest, null, 2),
    );

    fs.writeFileSync(
      path.join(pluginPath, 'index.js'),
      `// ${name} Plugin
export default {
  id: '${id}',
  name: '${name}',
  version: '${version}',
  
  async init() {
    console.log('${name} initialized');
  },
  
  async destroy() {
    console.log('${name} destroyed');
  },
};
`,
    );

    return { success: true, path: pluginPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
