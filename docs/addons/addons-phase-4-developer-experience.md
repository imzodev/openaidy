# Phase 4: Developer Experience - Addons Implementation

## Overview

Phase 4 focuses on creating an excellent developer experience for addon creators. This phase provides comprehensive tooling, templates, validation, and documentation that make it easy for developers to create, test, and publish addons for the OpenAidy ecosystem.

## Objectives

- Create addon development CLI tool with scaffolding and validation
- Implement addon testing framework and utilities
- Build addon templates and boilerplate generators
- Create comprehensive developer documentation
- Implement addon publishing and deployment system
- Add local development environment with hot reloading

## Implementation Tasks

### 1. Addon CLI Tool

#### 1.1 Create CLI Package Structure

**File: `packages/cli/package.json`**

```json
{
  "name": "@openaidy/cli",
  "version": "1.0.0",
  "description": "OpenAidy Addon Development CLI",
  "main": "dist/index.js",
  "bin": {
    "openaidy": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "inquirer": "^9.2.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.0",
    "fs-extra": "^11.1.0",
    "tar": "^6.1.0",
    "glob": "^10.3.0",
    "semver": "^7.5.0",
    "zod": "^3.22.0",
    "@openaidy/shared-types": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/inquirer": "^9.0.0",
    "@types/fs-extra": "^11.0.0",
    "typescript": "^5.0.0",
    "vitest": "^0.34.0"
  },
  "types": "dist/index.d.ts"
}
```

#### 1.2 Create CLI Commands

**File: `packages/cli/src/cli.ts`**

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createCommand } from './commands/create';
import { buildCommand } from './commands/build';
import { testCommand } from './commands/test';
import { validateCommand } from './commands/validate';
import { publishCommand } from './commands/publish';
import { devCommand } from './commands/dev';
import { initCommand } from './commands/init';

const program = new Command();

program
  .name('openaidy')
  .description('OpenAidy Addon Development CLI')
  .version('1.0.0');

// ASCII Art Banner
console.log(
  chalk.blue(`
  ____  _ _     _____           _                 
 |  _ \\(_) |_  |_   _|__   ___ | | ___   _ _ ___ 
 | |_) | | __|   | |/ _ \\ / _ \\| |/ / | | | / __|
 |  __/| | |_    | | (_) | (_) |   <| |_| \\__ \\
 |_|   |_|\\__|   |_|\\___/ \\___/|_|\\_\\__,_|___/
                                                   
Addon Development CLI
`),
);

// Register commands
program.addCommand(createCommand);
program.addCommand(initCommand);
program.addCommand(buildCommand);
program.addCommand(testCommand);
program.addCommand(validateCommand);
program.addCommand(devCommand);
program.addCommand(publishCommand);

// Error handling
program.exitOverride((err) => {
  if (err.code === 'commander.help') {
    process.exit(0);
  }
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});

// Parse arguments
program.parse();
```

#### 1.3 Create Command: New Addon

**File: `packages/cli/src/commands/create.ts`**

```typescript
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'node:path';
import { validateAddonId, validateAddonName } from '../utils/validation';
import { createAddonTemplate } from '../utils/template-generator';

export const createCommand = new Command('create')
  .description('Create a new addon')
  .argument('<name>', 'Addon name')
  .option('-d, --directory <dir>', 'Output directory', process.cwd())
  .option('-t, --template <template>', 'Template to use', 'basic')
  .option('--no-git', 'Skip git initialization')
  .option('--no-install', 'Skip npm install')
  .action(async (name, options) => {
    try {
      // Validate addon name
      if (!validateAddonName(name)) {
        console.error(
          chalk.red(
            'Invalid addon name. Use letters, numbers, spaces, and hyphens only.',
          ),
        );
        process.exit(1);
      }

      // Generate addon ID from name
      const addonId = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');

      if (!validateAddonId(addonId)) {
        console.error(
          chalk.red(
            'Generated addon ID is invalid. Please choose a different name.',
          ),
        );
        process.exit(1);
      }

      // Prompt for additional information
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'description',
          message: 'Addon description:',
          validate: (input) =>
            input.length >= 10 || 'Description must be at least 10 characters',
        },
        {
          type: 'input',
          name: 'author',
          message: 'Author name:',
          default: () => {
            try {
              return require('os').userInfo().username;
            } catch {
              return 'Developer';
            }
          },
        },
        {
          type: 'input',
          name: 'email',
          message: 'Author email (optional):',
        },
        {
          type: 'list',
          name: 'template',
          message: 'Choose a template:',
          choices: [
            { name: 'Basic - Simple addon with one page', value: 'basic' },
            {
              name: 'Agent Integration - Addon that uses agents',
              value: 'agent',
            },
            {
              name: 'Multi-Page - Addon with multiple pages',
              value: 'multi-page',
            },
            {
              name: 'Configuration - Addon with user configuration',
              value: 'config',
            },
          ],
          default: options.template,
        },
        {
          type: 'confirm',
          name: 'typescript',
          message: 'Use TypeScript?',
          default: true,
        },
      ]);

      const addonDir = path.join(options.directory, addonId);

      // Check if directory already exists
      if (await fs.pathExists(addonDir)) {
        const { overwrite } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: `Directory ${addonId} already exists. Overwrite?`,
            default: false,
          },
        ]);

        if (!overwrite) {
          console.log(chalk.yellow('Operation cancelled.'));
          return;
        }

        await fs.remove(addonDir);
      }

      // Create addon
      const spinner = ora('Creating addon...').start();

      try {
        await createAddonTemplate(addonDir, {
          id: addonId,
          name,
          description: answers.description,
          author: {
            name: answers.author,
            email: answers.email || undefined,
          },
          template: answers.template,
          typescript: answers.typescript,
        });

        spinner.succeed('Addon created successfully!');

        // Initialize git if requested
        if (options.git) {
          const gitSpinner = ora('Initializing git repository...').start();
          try {
            const { execSync } = require('child_process');
            execSync('git init', { cwd: addonDir, stdio: 'ignore' });
            execSync('git add .', { cwd: addonDir, stdio: 'ignore' });
            execSync('git commit -m "Initial commit"', {
              cwd: addonDir,
              stdio: 'ignore',
            });
            gitSpinner.succeed('Git repository initialized');
          } catch (error) {
            gitSpinner.fail('Failed to initialize git repository');
          }
        }

        // Install dependencies if requested
        if (options.install) {
          const installSpinner = ora('Installing dependencies...').start();
          try {
            const { execSync } = require('child_process');
            execSync('npm install', { cwd: addonDir, stdio: 'ignore' });
            installSpinner.succeed('Dependencies installed');
          } catch (error) {
            installSpinner.fail('Failed to install dependencies');
            console.log(chalk.yellow('Please run "npm install" manually.'));
          }
        }

        // Show next steps
        console.log(chalk.green('\n✅ Addon created successfully!\n'));
        console.log(chalk.blue('Next steps:'));
        console.log(`  cd ${addonId}`);
        if (!options.install) {
          console.log('  npm install');
        }
        console.log('  npm run dev');
        console.log('\nCommands:');
        console.log('  npm run build     - Build the addon');
        console.log('  npm run test      - Run tests');
        console.log('  npm run validate  - Validate addon manifest');
        console.log('  npm run publish   - Publish addon');
      } catch (error) {
        spinner.fail('Failed to create addon');
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error'),
        );
        process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error'),
      );
      process.exit(1);
    }
  });
```

#### 1.4 Create Command: Validate Addon

**File: `packages/cli/src/commands/validate.ts`**

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'node:path';
import { validateManifest, validatePackage } from '../utils/validator';
import { findAddonRoot } from '../utils/project';

export const validateCommand = new Command('validate')
  .description('Validate addon manifest and package')
  .option('-p, --package', 'Validate full package (requires build first)')
  .option('-v, --verbose', 'Show detailed validation results')
  .action(async (options) => {
    try {
      const addonRoot = await findAddonRoot(process.cwd());
      if (!addonRoot) {
        console.error(
          chalk.red('Not in an addon project. Run "openaidy init" first.'),
        );
        process.exit(1);
      }

      const manifestPath = path.join(addonRoot, 'addon.json');

      if (!(await fs.pathExists(manifestPath))) {
        console.error(chalk.red('addon.json not found.'));
        process.exit(1);
      }

      console.log(chalk.blue('🔍 Validating addon...\n'));

      // Validate manifest
      const manifestSpinner = ora('Validating manifest...').start();
      try {
        const manifestContent = await fs.readJson(manifestPath);
        const manifestResult = await validateManifest(manifestContent);

        if (manifestResult.valid) {
          manifestSpinner.succeed('Manifest is valid');
        } else {
          manifestSpinner.fail('Manifest validation failed');
          console.error(chalk.red('Manifest errors:'));
          manifestResult.errors.forEach((error) => {
            console.error(`  ❌ ${error}`);
          });
        }

        if (manifestResult.warnings.length > 0) {
          console.log(chalk.yellow('\n⚠️  Manifest warnings:'));
          manifestResult.warnings.forEach((warning) => {
            console.log(`  ⚠️  ${warning}`);
          });
        }

        if (!manifestResult.valid && !options.package) {
          process.exit(1);
        }
      } catch (error) {
        manifestSpinner.fail('Failed to read manifest');
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error'),
        );
        process.exit(1);
      }

      // Validate package if requested
      if (options.package) {
        const packagePath = path.join(addonRoot, 'dist', 'package.tar.gz');

        if (!(await fs.pathExists(packagePath))) {
          console.error(
            chalk.red('Package not found. Run "npm run build" first.'),
          );
          process.exit(1);
        }

        const packageSpinner = ora('Validating package...').start();
        try {
          const packageBuffer = await fs.readFile(packagePath);
          const packageResult = await validatePackage(packageBuffer);

          if (packageResult.valid) {
            packageSpinner.succeed('Package is valid');
          } else {
            packageSpinner.fail('Package validation failed');
            console.error(chalk.red('\nPackage errors:'));
            packageResult.errors.forEach((error) => {
              console.error(`  ❌ ${error}`);
            });
          }

          if (packageResult.warnings.length > 0) {
            console.log(chalk.yellow('\n⚠️  Package warnings:'));
            packageResult.warnings.forEach((warning) => {
              console.log(`  ⚠️  ${warning}`);
            });
          }

          // Show security issues
          if (packageResult.securityIssues.length > 0) {
            console.log(chalk.orange('\n🔒 Security issues:'));

            const groupedIssues = packageResult.securityIssues.reduce(
              (groups, issue) => {
                if (!groups[issue.severity]) {
                  groups[issue.severity] = [];
                }
                groups[issue.severity].push(issue);
                return groups;
              },
              {} as Record<string, any[]>,
            );

            const severityOrder = ['critical', 'high', 'medium', 'low'];
            for (const severity of severityOrder) {
              const issues = groupedIssues[severity];
              if (issues && issues.length > 0) {
                const color =
                  severity === 'critical'
                    ? 'red'
                    : severity === 'high'
                      ? 'orange'
                      : severity === 'medium'
                        ? 'yellow'
                        : 'blue';

                console.log(chalk[color](`\n${severity.toUpperCase()}:`));
                issues.forEach((issue: any) => {
                  const location = issue.file
                    ? issue.line
                      ? `${issue.file}:${issue.line}`
                      : issue.file
                    : 'unknown';
                  console.log(chalk[color](`  • ${issue.type} (${location})`));
                  if (options.verbose) {
                    console.log(chalk.gray(`    ${issue.description}`));
                    console.log(
                      chalk.gray(`    Recommendation: ${issue.recommendation}`),
                    );
                  }
                });
              }
            }
          }

          if (!packageResult.valid) {
            process.exit(1);
          }
        } catch (error) {
          packageSpinner.fail('Failed to validate package');
          console.error(
            chalk.red(error instanceof Error ? error.message : 'Unknown error'),
          );
          process.exit(1);
        }
      }

      console.log(chalk.green('\n✅ Validation completed successfully!'));
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error'),
      );
      process.exit(1);
    }
  });
```

#### 1.5 Create Command: Development Server

**File: `packages/cli/src/commands/dev.ts`**

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findAddonRoot } from '../utils/project';
import { watch } from 'chokidar';
import { buildAddon } from '../utils/builder';

export const devCommand = new Command('dev')
  .description('Start development server with hot reloading')
  .option('-p, --port <port>', 'Port for development server', '3001')
  .option('--host <host>', 'Host for development server', 'localhost')
  .option(
    '--openaidy-url <url>',
    'OpenAidy server URL',
    'http://localhost:3000',
  )
  .action(async (options) => {
    try {
      const addonRoot = await findAddonRoot(process.cwd());
      if (!addonRoot) {
        console.error(
          chalk.red('Not in an addon project. Run "openaidy init" first.'),
        );
        process.exit(1);
      }

      console.log(chalk.blue('🚀 Starting addon development server...\n'));

      // Read addon manifest
      const manifestPath = path.join(addonRoot, 'addon.json');
      const manifest = await fs.readJson(manifestPath);

      // Initial build
      const buildSpinner = ora('Building addon...').start();
      try {
        await buildAddon(addonRoot);
        buildSpinner.succeed('Initial build completed');
      } catch (error) {
        buildSpinner.fail('Initial build failed');
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error'),
        );
        process.exit(1);
      }

      // Start development server
      const serverSpinner = ora('Starting development server...').start();

      const serverProcess = spawn(
        'node',
        [
          path.join(__dirname, '../dev-server.js'),
          '--addon-dir',
          addonRoot,
          '--port',
          options.port,
          '--host',
          options.host,
          '--openaidy-url',
          options.openaidyUrl,
        ],
        {
          stdio: 'pipe',
          cwd: addonRoot,
        },
      );

      serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Server started')) {
          serverSpinner.succeed('Development server started');
          console.log(
            chalk.green(
              `\n🌐 Addon available at: http://${options.host}:${options.port}`,
            ),
          );
          console.log(chalk.blue(`🔗 OpenAidy server: ${options.openaidyUrl}`));
          console.log(chalk.gray('\nWatching for changes...'));
        } else {
          process.stdout.write(output);
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        process.stderr.write(chalk.red(data.toString()));
      });

      serverProcess.on('error', (error) => {
        serverSpinner.fail('Failed to start development server');
        console.error(chalk.red(error.message));
        process.exit(1);
      });

      // Watch for file changes
      const watcher = watch(
        [
          path.join(addonRoot, 'src/**/*'),
          path.join(addonRoot, 'addon.json'),
          path.join(addonRoot, 'package.json'),
        ],
        {
          ignored: /node_modules|dist/,
          persistent: true,
        },
      );

      let rebuildTimeout: NodeJS.Timeout;

      watcher.on('change', async (filePath) => {
        console.log(
          chalk.gray(
            `\n📝 File changed: ${path.relative(addonRoot, filePath)}`,
          ),
        );

        // Debounce rebuilds
        if (rebuildTimeout) {
          clearTimeout(rebuildTimeout);
        }

        rebuildTimeout = setTimeout(async () => {
          const rebuildSpinner = ora('Rebuilding addon...').start();
          try {
            await buildAddon(addonRoot);
            rebuildSpinner.succeed('Rebuild completed');

            // Notify server to reload
            if (serverProcess.pid && !serverProcess.killed) {
              serverProcess.kill('SIGUSR2');
            }
          } catch (error) {
            rebuildSpinner.fail('Rebuild failed');
            console.error(
              chalk.red(
                error instanceof Error ? error.message : 'Unknown error',
              ),
            );
          }
        }, 300);
      });

      // Handle cleanup
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\n🛑 Shutting down development server...'));
        watcher.close();
        serverProcess.kill('SIGTERM');
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        watcher.close();
        serverProcess.kill('SIGTERM');
        process.exit(0);
      });
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error'),
      );
      process.exit(1);
    }
  });
```

### 2. Template Generator

#### 2.1 Create Template System

**File: `packages/cli/src/utils/template-generator.ts`**

```typescript
import fs from 'fs-extra';
import path from 'node:path';
import { AddonManifest } from '@openaidy/shared-types';

export interface CreateAddonOptions {
  id: string;
  name: string;
  description: string;
  author: {
    name: string;
    email?: string;
  };
  template: 'basic' | 'agent' | 'multi-page' | 'config';
  typescript: boolean;
}

export async function createAddonTemplate(
  outputDir: string,
  options: CreateAddonOptions,
): Promise<void> {
  // Create directory structure
  await fs.ensureDir(outputDir);
  await fs.ensureDir(path.join(outputDir, 'src'));
  await fs.ensureDir(path.join(outputDir, 'src/components'));
  await fs.ensureDir(path.join(outputDir, 'public'));

  // Generate manifest
  const manifest = generateManifest(options);
  await fs.writeJson(path.join(outputDir, 'addon.json'), manifest, {
    spaces: 2,
  });

  // Generate package.json
  const packageJson = generatePackageJson(options);
  await fs.writeJson(path.join(outputDir, 'package.json'), packageJson, {
    spaces: 2,
  });

  // Generate source files based on template
  switch (options.template) {
    case 'basic':
      await generateBasicTemplate(outputDir, options);
      break;
    case 'agent':
      await generateAgentTemplate(outputDir, options);
      break;
    case 'multi-page':
      await generateMultiPageTemplate(outputDir, options);
      break;
    case 'config':
      await generateConfigTemplate(outputDir, options);
      break;
  }

  // Generate common files
  await generateCommonFiles(outputDir, options);
}

function generateManifest(options: CreateAddonOptions): AddonManifest {
  const baseManifest: AddonManifest = {
    $schema: 'https://openaidy.dev/schemas/addon-manifest-v1.json',
    id: options.id,
    name: options.name,
    version: '1.0.0',
    description: options.description,
    author: options.author,
    openaidy: {
      minVersion: '1.0.0',
    },
    entry: './dist/index.js',
    permissions: getTemplatePermissions(options.template),
    ui: {
      sidebar: {
        icon: getTemplateIcon(options.template),
        label: options.name,
        order: 100,
      },
      routes: getTemplateRoutes(options.template),
    },
    agents: getTemplateAgents(options.template),
  };

  // Add config schema for config template
  if (options.template === 'config') {
    baseManifest.config = {
      schema: './config-schema.json',
      defaults: {
        refreshInterval: 300,
        theme: 'light',
      },
    };
  }

  return baseManifest;
}

function generatePackageJson(options: CreateAddonOptions): any {
  const dependencies = {
    'solid-js': '^1.8.0',
    '@solidjs/router': '^0.8.0',
    'lucide-solid': '^0.284.0',
  };

  const devDependencies = {
    '@types/node': '^20.0.0',
    typescript: '^5.0.0',
    vite: '^4.4.0',
    'vite-plugin-solid': '^2.7.0',
    '@openaidy/cli': '^1.0.0',
    vitest: '^0.34.0',
    jsdom: '^22.1.0',
  };

  if (!options.typescript) {
    delete devDependencies.typescript;
    delete devDependencies['@types/node'];
  }

  return {
    name: `openaidy-addon-${options.id}`,
    version: '1.0.0',
    description: options.description,
    type: 'module',
    scripts: {
      dev: 'openaidy dev',
      build: 'openaidy build',
      test: 'openaidy test',
      validate: 'openaidy validate',
      'validate:package': 'openaidy validate --package',
      publish: 'openaidy publish',
    },
    dependencies,
    devDependencies,
  };
}

async function generateBasicTemplate(
  outputDir: string,
  options: CreateAddonOptions,
): Promise<void> {
  const ext = options.typescript ? 'ts' : 'js';

  // Main component
  const mainComponent = options.typescript
    ? `
import { createSignal, onMount } from 'solid-js';
import type { AddonRuntime } from '@openaidy/addon-runtime';

export default function ${options.name.replace(/[^a-zA-Z0-9]/g, '')}Page() {
  const [message, setMessage] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  let runtime: AddonRuntime;

  onMount(() => {
    // Get addon runtime
    runtime = (window as any).__ADDON_RUNTIME__;
    if (!runtime) {
      console.error('Addon runtime not available');
      return;
    }

    // Show welcome message
    runtime.showNotification('Addon loaded successfully!', 'success');
  });

  const handleAction = async () => {
    setLoading(true);
    try {
      // Example: Call an agent
      const result = await runtime.invokeAgent('example-agent', {
        message: 'Hello from addon!'
      });
      
      setMessage(JSON.stringify(result, null, 2));
    } catch (error) {
      setMessage(\`Error: \${error instanceof Error ? error.message : 'Unknown error'}\`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-4">${options.name}</h1>
      <p class="text-gray-600 mb-6">${options.description}</p>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">Example Action</h2>
        
        <button
          onClick={handleAction}
          disabled={loading()}
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading() ? 'Loading...' : 'Test Agent Call'}
        </button>
        
        {message() && (
          <div class="mt-4 p-4 bg-gray-100 dark:bg-gray-700 rounded">
            <h3 class="font-semibold mb-2">Result:</h3>
            <pre class="text-sm overflow-x-auto">{message()}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
`
    : `
import { createSignal, onMount } from 'solid-js';

export default function ${options.name.replace(/[^a-zA-Z0-9]/g, '')}Page() {
  const [message, setMessage] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  let runtime;

  onMount(() => {
    // Get addon runtime
    runtime = window.__ADDON_RUNTIME__;
    if (!runtime) {
      console.error('Addon runtime not available');
      return;
    }

    // Show welcome message
    runtime.showNotification('Addon loaded successfully!', 'success');
  });

  const handleAction = async () => {
    setLoading(true);
    try {
      // Example: Call an agent
      const result = await runtime.invokeAgent('example-agent', {
        message: 'Hello from addon!'
      });
      
      setMessage(JSON.stringify(result, null, 2));
    } catch (error) {
      setMessage(\`Error: \${error instanceof Error ? error.message : 'Unknown error'}\`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-4">${options.name}</h1>
      <p class="text-gray-600 mb-6">${options.description}</p>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">Example Action</h2>
        
        <button
          onClick={handleAction}
          disabled={loading()}
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading() ? 'Loading...' : 'Test Agent Call'}
        </button>
        
        {message() && (
          <div class="mt-4 p-4 bg-gray-100 dark:bg-gray-700 rounded">
            <h3 class="font-semibold mb-2">Result:</h3>
            <pre class="text-sm overflow-x-auto">{message()}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
`;

  await fs.writeFile(
    path.join(outputDir, 'src', `index.${ext}`),
    mainComponent,
  );
}

async function generateAgentTemplate(
  outputDir: string,
  options: CreateAddonOptions,
): Promise<void> {
  const ext = options.typescript ? 'ts' : 'js';

  // Agent integration component
  const agentComponent = options.typescript
    ? `
import { createSignal, onMount } from 'solid-js';
import type { AddonRuntime } from '@openaidy/addon-runtime';

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function ${options.name.replace(/[^a-zA-Z0-9]/g, '')}Page() {
  const [messages, setMessages] = createSignal<AgentMessage[]>([]);
  const [input, setInput] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [selectedAgent, setSelectedAgent] = createSignal('default-agent');
  let runtime: AddonRuntime;

  onMount(() => {
    runtime = (window as any).__ADDON_RUNTIME__;
  });

  const sendMessage = async () => {
    const message = input().trim();
    if (!message || loading()) return;

    setLoading(true);
    
    // Add user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    }]);

    try {
      const result = await runtime.invokeAgent(selectedAgent(), {
        message,
        history: messages()
      });

      // Add assistant response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.result || result.response || 'No response',
        timestamp: new Date().toISOString()
      }]);

      setInput('');
    } catch (error) {
      runtime.showNotification(\`Failed to send message: \${error instanceof Error ? error.message : 'Unknown error'}\`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex flex-col h-full">
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <For each={messages()}>
          {(msg) => (
            <div class={\`flex \${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }\`}>
              <div class={\`max-w-md px-4 py-2 rounded-lg \${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              }\`}>
                <p class="text-sm">{msg.content}</p>
                <p class="text-xs opacity-70 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="border-t border-gray-200 dark:border-gray-700 p-4">
        <div class="flex gap-2 mb-2">
          <select
            value={selectedAgent()}
            onChange={(e) => setSelectedAgent(e.currentTarget.value)}
            class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm"
          >
            <option value="default-agent">Default Agent</option>
            <option value="analysis-agent">Analysis Agent</option>
            <option value="creative-agent">Creative Agent</option>
          </select>
        </div>
        
        <div class="flex gap-2">
          <input
            type="text"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type your message..."
            disabled={loading()}
            class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm"
          />
          <button
            onClick={sendMessage}
            disabled={loading() || !input().trim()}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {loading() ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
`
    : `
import { createSignal, onMount } from 'solid-js';

export default function ${options.name.replace(/[^a-zA-Z0-9]/g, '')}Page() {
  const [messages, setMessages] = createSignal([]);
  const [input, setInput] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [selectedAgent, setSelectedAgent] = createSignal('default-agent');
  let runtime;

  onMount(() => {
    runtime = window.__ADDON_RUNTIME__;
  });

  const sendMessage = async () => {
    const message = input().trim();
    if (!message || loading()) return;

    setLoading(true);
    
    // Add user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    }]);

    try {
      const result = await runtime.invokeAgent(selectedAgent(), {
        message,
        history: messages()
      });

      // Add assistant response
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.result || result.response || 'No response',
        timestamp: new Date().toISOString()
      }]);

      setInput('');
    } catch (error) {
      runtime.showNotification(\`Failed to send message: \${error instanceof Error ? error.message : 'Unknown error'}\`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex flex-col h-full">
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <For each={messages()}>
          {(msg) => (
            <div class={\`flex \${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }\`}>
              <div class={\`max-w-md px-4 py-2 rounded-lg \${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              }\`}>
                <p class="text-sm">{msg.content}</p>
                <p class="text-xs opacity-70 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="border-t border-gray-200 dark:border-gray-700 p-4">
        <div class="flex gap-2 mb-2">
          <select
            value={selectedAgent()}
            onChange={(e) => setSelectedAgent(e.currentTarget.value)}
            class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm"
          >
            <option value="default-agent">Default Agent</option>
            <option value="analysis-agent">Analysis Agent</option>
            <option value="creative-agent">Creative Agent</option>
          </select>
        </div>
        
        <div class="flex gap-2">
          <input
            type="text"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type your message..."
            disabled={loading()}
            class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-sm"
          />
          <button
            onClick={sendMessage}
            disabled={loading() || !input().trim()}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {loading() ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
`;

  await fs.writeFile(
    path.join(outputDir, 'src', `index.${ext}`),
    agentComponent,
  );
}

async function generateMultiPageTemplate(
  outputDir: string,
  options: CreateAddonOptions,
): Promise<void> {
  const ext = options.typescript ? 'ts' : 'js';

  // Main page with navigation
  const mainPage = options.typescript
    ? `
import { A } from '@solidjs/router';

export default function MainPage() {
  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">${options.name}</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <A href="/addons/${options.id}/dashboard" class="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow">
          <h2 class="text-lg font-semibold mb-2">Dashboard</h2>
          <p class="text-gray-600 dark:text-gray-400">View overview and statistics</p>
        </A>
        
        <A href="/addons/${options.id}/analytics" class="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow">
          <h2 class="text-lg font-semibold mb-2">Analytics</h2>
          <p class="text-gray-600 dark:text-gray-400">Analyze data and trends</p>
        </A>
        
        <A href="/addons/${options.id}/settings" class="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow">
          <h2 class="text-lg font-semibold mb-2">Settings</h2>
          <p class="text-gray-600 dark:text-gray-400">Configure addon settings</p>
        </A>
      </div>
    </div>
  );
}
`
    : `
import { A } from '@solidjs/router';

export default function MainPage() {
  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">${options.name}</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <A href="/addons/${options.id}/dashboard" class="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow">
          <h2 class="text-lg font-semibold mb-2">Dashboard</h2>
          <p class="text-gray-600 dark:text-gray-400">View overview and statistics</p>
        </A>
        
        <A href="/addons/${options.id}/analytics" class="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow">
          <h2 class="text-lg font-semibold mb-2">Analytics</h2>
          <p class="text-gray-600 dark:text-gray-400">Analyze data and trends</p>
        </A>
        
        <A href="/addons/${options.id}/settings" class="block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow">
          <h2 class="text-lg font-semibold mb-2">Settings</h2>
          <p class="text-gray-600 dark:text-gray-400">Configure addon settings</p>
        </A>
      </div>
    </div>
  );
}
`;

  // Dashboard page
  const dashboardPage = `
export default function DashboardPage() {
  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Dashboard</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Total Users</h3>
          <p class="text-2xl font-bold text-gray-900 dark:text-gray-100">1,234</p>
        </div>
        
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Active Sessions</h3>
          <p class="text-2xl font-bold text-gray-900 dark:text-gray-100">56</p>
        </div>
        
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">API Calls</h3>
          <p class="text-2xl font-bold text-gray-900 dark:text-gray-100">8,901</p>
        </div>
        
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h3 class="text-sm font-medium text-gray-500 dark:text-gray-400">Success Rate</h3>
          <p class="text-2xl font-bold text-green-600">98.5%</p>
        </div>
      </div>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">Recent Activity</h2>
        <div class="space-y-3">
          <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
            <span class="text-sm">User authentication</span>
            <span class="text-xs text-gray-500">2 minutes ago</span>
          </div>
          <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
            <span class="text-sm">Data export completed</span>
            <span class="text-xs text-gray-500">15 minutes ago</span>
          </div>
          <div class="flex items-center justify-between py-2">
            <span class="text-sm">Configuration updated</span>
            <span class="text-xs text-gray-500">1 hour ago</span>
          </div>
        </div>
      </div>
    </div>
  );
}
`;

  // Analytics page
  const analyticsPage = `
export default function AnalyticsPage() {
  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Analytics</h1>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">Usage Statistics</h2>
        <div class="h-64 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center">
          <p class="text-gray-500">Chart placeholder</p>
        </div>
      </div>
    </div>
  );
}
`;

  // Settings page
  const settingsPage = `
export default function SettingsPage() {
  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Settings</h1>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">Addon Configuration</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value="${options.name}"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
              readonly
            />
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value="${options.description}"
              rows={3}
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
              readonly
            />
          </div>
        </div>
      </div>
    </div>
  );
}
`;

  await fs.writeFile(path.join(outputDir, 'src', `index.${ext}`), mainPage);
  await fs.writeFile(
    path.join(outputDir, 'src', `Dashboard.${ext}`),
    dashboardPage,
  );
  await fs.writeFile(
    path.join(outputDir, 'src', `Analytics.${ext}`),
    analyticsPage,
  );
  await fs.writeFile(
    path.join(outputDir, 'src', `Settings.${ext}`),
    settingsPage,
  );
}

async function generateConfigTemplate(
  outputDir: string,
  options: CreateAddonOptions,
): Promise<void> {
  const ext = options.typescript ? 'ts' : 'js';

  // Config-aware component
  const configComponent = options.typescript
    ? `
import { createSignal, onMount } from 'solid-js';
import type { AddonRuntime } from '@openaidy/addon-runtime';

interface AddonConfig {
  refreshInterval: number;
  theme: 'light' | 'dark' | 'auto';
  notifications: boolean;
}

export default function ${options.name.replace(/[^a-zA-Z0-9]/g, '')}Page() {
  const [config, setConfig] = createSignal<AddonConfig>({
    refreshInterval: 300,
    theme: 'light',
    notifications: true,
  });
  const [loading, setLoading] = createSignal(false);
  let runtime: AddonRuntime;

  onMount(async () => {
    runtime = (window as any).__ADDON_RUNTIME__;
    
    // Load configuration
    try {
      const savedConfig = await runtime.getConfig();
      if (savedConfig) {
        setConfig(savedConfig);
      }
    } catch (error) {
      console.error('Failed to load configuration:', error);
    }
  });

  const saveConfig = async () => {
    setLoading(true);
    try {
      await runtime.setConfig('addon', config());
      runtime.showNotification('Configuration saved successfully!', 'success');
    } catch (error) {
      runtime.showNotification('Failed to save configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (key: keyof AddonConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">${options.name}</h1>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">Configuration</h2>
        
        <div class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Refresh Interval (seconds)
            </label>
            <input
              type="number"
              min="10"
              max="3600"
              value={config().refreshInterval}
              onInput={(e) => updateConfig('refreshInterval', parseInt(e.currentTarget.value))}
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
            />
            <p class="text-xs text-gray-500 mt-1">
              How often to refresh data (10-3600 seconds)
            </p>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Theme
            </label>
            <select
              value={config().theme}
              onChange={(e) => updateConfig('theme', e.currentTarget.value)}
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          
          <div>
            <label class="flex items-center">
              <input
                type="checkbox"
                checked={config().notifications}
                onChange={(e) => updateConfig('notifications', e.currentTarget.checked)}
                class="mr-2"
              />
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enable notifications
              </span>
            </label>
            <p class="text-xs text-gray-500 mt-1">
              Show notifications for important events
            </p>
          </div>
        </div>
        
        <div class="mt-6 flex justify-end">
          <button
            onClick={saveConfig}
            disabled={loading()}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading() ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
      
      <div class="mt-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-4">
        <h3 class="text-sm font-semibold mb-2">Current Configuration</h3>
        <pre class="text-xs overflow-x-auto">
          {JSON.stringify(config(), null, 2)}
        </pre>
      </div>
    </div>
  );
}
`
    : `
import { createSignal, onMount } from 'solid-js';

export default function ${options.name.replace(/[^a-zA-Z0-9]/g, '')}Page() {
  const [config, setConfig] = createSignal({
    refreshInterval: 300,
    theme: 'light',
    notifications: true,
  });
  const [loading, setLoading] = createSignal(false);
  let runtime;

  onMount(async () => {
    runtime = window.__ADDON_RUNTIME__;
    
    // Load configuration
    try {
      const savedConfig = await runtime.getConfig();
      if (savedConfig) {
        setConfig(savedConfig);
      }
    } catch (error) {
      console.error('Failed to load configuration:', error);
    }
  });

  const saveConfig = async () => {
    setLoading(true);
    try {
      await runtime.setConfig('addon', config());
      runtime.showNotification('Configuration saved successfully!', 'success');
    } catch (error) {
      runtime.showNotification('Failed to save configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">${options.name}</h1>
      
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-4">Configuration</h2>
        
        <div class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Refresh Interval (seconds)
            </label>
            <input
              type="number"
              min="10"
              max="3600"
              value={config().refreshInterval}
              onInput={(e) => updateConfig('refreshInterval', parseInt(e.currentTarget.value))}
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
            />
            <p class="text-xs text-gray-500 mt-1">
              How often to refresh data (10-3600 seconds)
            </p>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Theme
            </label>
            <select
              value={config().theme}
              onChange={(e) => updateConfig('theme', e.currentTarget.value)}
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          
          <div>
            <label class="flex items-center">
              <input
                type="checkbox"
                checked={config().notifications}
                onChange={(e) => updateConfig('notifications', e.currentTarget.checked)}
                class="mr-2"
              />
              <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                Enable notifications
              </span>
            </label>
            <p class="text-xs text-gray-500 mt-1">
              Show notifications for important events
            </p>
          </div>
        </div>
        
        <div class="mt-6 flex justify-end">
          <button
            onClick={saveConfig}
            disabled={loading()}
            class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading() ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
      
      <div class="mt-6 bg-gray-100 dark:bg-gray-700 rounded-lg p-4">
        <h3 class="text-sm font-semibold mb-2">Current Configuration</h3>
        <pre class="text-xs overflow-x-auto">
          {JSON.stringify(config(), null, 2)}
        </pre>
      </div>
    </div>
  );
}
`;

  await fs.writeFile(
    path.join(outputDir, 'src', `index.${ext}`),
    configComponent,
  );

  // Create config schema
  const configSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      refreshInterval: {
        type: 'number',
        minimum: 10,
        maximum: 3600,
        description: 'How often to refresh data (seconds)',
      },
      theme: {
        type: 'string',
        enum: ['light', 'dark', 'auto'],
        description: 'UI theme preference',
      },
      notifications: {
        type: 'boolean',
        description: 'Enable notifications',
      },
    },
    required: ['refreshInterval', 'theme', 'notifications'],
  };

  await fs.writeJSON(path.join(outputDir, 'config-schema.json'), configSchema, {
    spaces: 2,
  });
}

async function generateCommonFiles(
  outputDir: string,
  options: CreateAddonOptions,
): Promise<void> {
  // Create README
  const readme = `# ${options.name}

${options.description}

## Installation

This addon is part of the OpenAidy ecosystem. To install:

1. Build the addon: \`npm run build\`
2. Upload the generated \`dist/package.tar.gz\` to your OpenAidy instance

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Validate addon
npm run validate

# Run tests
npm run test
\`\`\`

### Project Structure

\`\`\`
${options.id}/
├── src/                    # Source code
│   ├── index.${options.typescript ? 'ts' : 'js'}    # Main component
│   └── components/          # Additional components
├── public/                  # Static assets
├── addon.json              # Addon manifest
├── package.json            # Dependencies
└── README.md               # This file
\`\`\`

## Configuration

${
  options.template === 'config'
    ? `This addon supports the following configuration options:

- **refreshInterval**: How often to refresh data (10-3600 seconds)
- **theme**: UI theme preference (light, dark, auto)
- **notifications**: Enable notifications

Configuration can be managed through the addon settings page.`
    : 'This addon does not require additional configuration.'
}

## Permissions

This addon requests the following permissions:

${getTemplatePermissions(options.template)
  .map((p) => `- \`${p}\``)
  .join('\n')}

## Support

For issues and support:
- Create an issue in the addon repository
- Contact the maintainer: ${options.author.email || options.author.name}

## License

This addon is released under the MIT License.
`;

  await fs.writeFile(path.join(outputDir, 'README.md'), readme);

  // Create .gitignore
  const gitignore = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
logs
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# next.js build output
.next

# nuxt.js build output
.nuxt

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless

# FuseBox cache
.fusebox/

# DynamoDB Local files
.dynamodb/
`;

  await fs.writeFile(path.join(outputDir, '.gitignore'), gitignore);

  // Create TypeScript config if needed
  if (options.typescript) {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'preserve',
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
        types: ['vite/client'],
      },
      include: ['src'],
      references: [{ path: './tsconfig.node.json' }],
    };

    const tsconfigNode = {
      compilerOptions: {
        composite: true,
        skipLibCheck: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowSyntheticDefaultImports: true,
      },
      include: ['vite.config.ts'],
    };

    await fs.writeJSON(path.join(outputDir, 'tsconfig.json'), tsconfig, {
      spaces: 2,
    });
    await fs.writeJSON(
      path.join(outputDir, 'tsconfig.node.json'),
      tsconfigNode,
      { spaces: 2 },
    );
  }

  // Create Vite config
  const viteConfig = options.typescript
    ? `
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3001,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        'index': './src/index.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
`
    : `
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3001,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        'index': './src/index.js',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
`;

  await fs.writeFile(path.join(outputDir, 'vite.config.ts'), viteConfig);
}

// Helper functions
function getTemplatePermissions(template: string): string[] {
  switch (template) {
    case 'basic':
      return ['agents.invoke:example-agent'];
    case 'agent':
      return [
        'agents.invoke:default-agent',
        'agents.invoke:analysis-agent',
        'agents.invoke:creative-agent',
      ];
    case 'multi-page':
      return ['sessions.read', 'config.read'];
    case 'config':
      return ['config.read:addon', 'config.write:addon'];
    default:
      return [];
  }
}

function getTemplateIcon(template: string): string {
  switch (template) {
    case 'basic':
      return 'puzzle';
    case 'agent':
      return 'bot';
    case 'multi-page':
      return 'layout';
    case 'config':
      return 'settings';
    default:
      return 'puzzle';
  }
}

function getTemplateRoutes(
  template: string,
): Array<{ path: string; component: string }> {
  switch (template) {
    case 'basic':
    case 'agent':
    case 'config':
      return [{ path: `/addons/${template}`, component: 'MainPage' }];
    case 'multi-page':
      return [
        { path: `/addons/${template}`, component: 'MainPage' },
        { path: `/addons/${template}/dashboard`, component: 'DashboardPage' },
        { path: `/addons/${template}/analytics`, component: 'AnalyticsPage' },
        { path: `/addons/${template}/settings`, component: 'SettingsPage' },
      ];
    default:
      return [{ path: `/addons/${template}`, component: 'MainPage' }];
  }
}

function getTemplateAgents(
  template: string,
): Array<{ id: string; required: boolean; description: string }> {
  switch (template) {
    case 'basic':
      return [
        {
          id: 'example-agent',
          required: true,
          description: 'Example agent for testing',
        },
      ];
    case 'agent':
      return [
        {
          id: 'default-agent',
          required: true,
          description: 'Default conversational agent',
        },
        {
          id: 'analysis-agent',
          required: false,
          description: 'Data analysis agent',
        },
        {
          id: 'creative-agent',
          required: false,
          description: 'Creative writing agent',
        },
      ];
    case 'multi-page':
    case 'config':
      return [];
    default:
      return [];
  }
}
```

### 3. Testing Framework

#### 3.1 Create Addon Testing Utilities

**File: `packages/cli/src/utils/testing.ts`**

```typescript
import { vitest } from 'vitest';
import { JSDOM } from 'jsdom';

export interface AddonTestEnvironment {
  dom: JSDOM;
  window: Window;
  document: Document;
  mockRuntime: MockAddonRuntime;
}

export interface MockAddonRuntime {
  invokeAgent: (agentId: string, input: any) => Promise<any>;
  createSession: (config: any) => Promise<any>;
  getSession: (id: string) => Promise<any>;
  listSessions: () => Promise<any[]>;
  getConfig: (namespace?: string) => Promise<any>;
  setConfig: (namespace: string, config: any) => Promise<void>;
  navigate: (path: string) => void;
  showNotification: (
    message: string,
    type: 'info' | 'success' | 'error',
  ) => void;
  getAddonInfo: () => any;
  getStorage: (key: string) => Promise<string | null>;
  setStorage: (key: string, value: string) => Promise<void>;
  removeStorage: (key: string) => Promise<void>;
}

export function createTestEnvironment(): AddonTestEnvironment {
  // Create DOM environment
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost:3000',
    pretendToBeVisual: true,
    resources: 'usable',
  });

  const { window, document } = dom;

  // Create mock runtime
  const mockRuntime: MockAddonRuntime = {
    invokeAgent: vitest.fn().mockResolvedValue({ result: 'Mock response' }),
    createSession: vitest.fn().mockResolvedValue({ id: 'session-123' }),
    getSession: vitest
      .fn()
      .mockResolvedValue({ id: 'session-123', status: 'active' }),
    listSessions: vitest.fn().mockResolvedValue([]),
    getConfig: vitest.fn().mockResolvedValue({}),
    setConfig: vitest.fn().mockResolvedValue(),
    navigate: vitest.fn(),
    showNotification: vitest.fn(),
    getAddonInfo: vitest.fn().mockReturnValue({
      id: 'test-addon',
      name: 'Test Addon',
      version: '1.0.0',
      permissions: [],
      config: {},
    }),
    getStorage: vitest.fn().mockResolvedValue(null),
    setStorage: vitest.fn().mockResolvedValue(),
    removeStorage: vitest.fn().mockResolvedValue(),
  };

  // Make runtime available globally
  (window as any).__ADDON_RUNTIME__ = mockRuntime;

  // Mock router
  (window as any).__OPENAIDY_ROUTER__ = {
    navigate: vitest.fn(),
  };

  // Mock notifications
  (window as any).__OPENAIDY_NOTIFICATIONS__ = {
    show: vitest.fn(),
  };

  return {
    dom,
    window,
    document,
    mockRuntime,
  };
}

export function cleanupTestEnvironment(env: AddonTestEnvironment): void {
  env.dom.window.close();
}

export function render(component: any): {
  container: HTMLElement;
  unmount: () => void;
} {
  // This is a simplified render function
  // In a real implementation, you'd use Solid's testing utilities
  const container = document.createElement('div');
  document.body.appendChild(container);

  // Mock rendering - in reality, this would use Solid's render function
  const unmount = () => {
    container.remove();
  };

  return { container, unmount };
}

export function waitFor(callback: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (callback()) {
        resolve();
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

export function fireEvent(
  element: HTMLElement,
  eventType: string,
  eventData?: any,
) {
  const event = new Event(eventType, { bubbles: true, ...eventData });
  element.dispatchEvent(event);
}

export function userEvent() {
  return {
    click: async (element: HTMLElement) => {
      fireEvent(element, 'click');
    },
    type: async (element: HTMLInputElement, value: string) => {
      element.value = value;
      fireEvent(element, 'input');
    },
    select: async (element: HTMLSelectElement, value: string) => {
      element.value = value;
      fireEvent(element, 'change');
    },
  };
}
```

#### 3.2 Create Test Command

**File: `packages/cli/src/commands/test.ts`**

```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { findAddonRoot } from '../utils/project';

export const testCommand = new Command('test')
  .description('Run addon tests')
  .option('--watch', 'Watch mode for continuous testing')
  .option('--coverage', 'Generate coverage report')
  .option('--ui', 'Run tests with UI interface')
  .action(async (options) => {
    try {
      const addonRoot = await findAddonRoot(process.cwd());
      if (!addonRoot) {
        console.error(
          chalk.red('Not in an addon project. Run "openaidy init" first.'),
        );
        process.exit(1);
      }

      console.log(chalk.blue('🧪 Running addon tests...\n'));

      const vitestArgs = ['run'];

      if (options.watch) {
        vitestArgs[0] = 'dev';
      }

      if (options.coverage) {
        vitestArgs.push('--coverage');
      }

      if (options.ui) {
        vitestArgs.push('--ui');
      }

      const testProcess = spawn('npx', ['vitest', ...vitestArgs], {
        stdio: 'inherit',
        cwd: addonRoot,
        env: {
          ...process.env,
          NODE_ENV: 'test',
        },
      });

      testProcess.on('error', (error) => {
        console.error(chalk.red('Failed to run tests:'), error.message);
        process.exit(1);
      });

      testProcess.on('exit', (code) => {
        if (code !== 0) {
          process.exit(code);
        }
      });
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : 'Unknown error'),
      );
      process.exit(1);
    }
  });
```

### 4. Documentation Generator

#### 4.1 Create Documentation Generator

**File: `packages/cli/src/utils/docs-generator.ts`**

```typescript
import fs from 'fs-extra';
import path from 'node:path';
import type { AddonManifest } from '@openaidy/shared-types';

export interface DocumentationOptions {
  outputDir: string;
  manifest: AddonManifest;
  includeApiDocs?: boolean;
  includeExamples?: boolean;
}

export async function generateDocumentation(
  options: DocumentationOptions,
): Promise<void> {
  const { outputDir, manifest } = options;

  await fs.ensureDir(outputDir);

  // Generate main README
  await generateMainReadme(outputDir, manifest);

  // Generate API documentation
  if (options.includeApiDocs) {
    await generateApiDocs(outputDir, manifest);
  }

  // Generate examples
  if (options.includeExamples) {
    await generateExamples(outputDir, manifest);
  }

  // Generate configuration guide
  if (manifest.config) {
    await generateConfigGuide(outputDir, manifest);
  }
}

async function generateMainReadme(
  outputDir: string,
  manifest: AddonManifest,
): Promise<void> {
  const readme = `# ${manifest.name}

${manifest.description}

## Overview

This addon extends OpenAidy with additional functionality. It integrates seamlessly with the OpenAidy ecosystem and provides enhanced capabilities for specific use cases.

## Features

- ${generateFeatureList(manifest)}

## Installation

### Prerequisites

- OpenAidy instance (version ${manifest.openaidy.minVersion} or higher)
- Admin access to OpenAidy

### Installation Steps

1. Download the addon package
2. Navigate to **Addons** in your OpenAidy instance
3. Click **Install Addon** and upload the package
4. Review and approve the requested permissions
5. Enable the addon

## Usage

### Getting Started

After installation, the addon will appear in the OpenAidy sidebar under the name "${manifest.ui.sidebar.label}". Click on it to access the addon's interface.

### Main Features

${generateUsageSection(manifest)}

## Configuration

${
  manifest.config
    ? `
This addon supports configuration through the OpenAidy interface. Navigate to the addon settings to customize:

- ${Object.keys(manifest.config.defaults).join('\n- ')}
`
    : 'This addon does not require additional configuration.'
}

## Permissions

This addon requests the following permissions to function properly:

${generatePermissionsList(manifest)}

## Security

This addon has been validated and follows OpenAidy's security guidelines:

- ✅ Code scanned for security vulnerabilities
- ✅ Permissions limited to required functionality
- ✅ No access to system resources
- ✅ Sandboxed execution environment

## Troubleshooting

### Common Issues

**Addon not appearing in sidebar**
- Ensure the addon is enabled in the Addons management page
- Check that you have the necessary permissions
- Refresh your browser cache

**Permission denied errors**
- Verify that all requested permissions have been approved
- Check the addon logs in the OpenAidy admin panel

**Configuration not saving**
- Ensure you have admin permissions
- Check that the configuration values are valid
- Review the addon logs for any error messages

### Support

For support and issues:
- ${manifest.author.email ? `Email: ${manifest.author.email}` : ''}
- ${manifest.homepage ? `Documentation: ${manifest.homepage}` : ''}
- ${manifest.repository ? `Source Code: ${manifest.repository}` : ''}

## Development

### Local Development

To contribute to this addon:

\`\`\`bash
# Clone the repository
git clone ${manifest.repository || 'addon-repo-url'}
cd ${manifest.id}

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm run test

# Build for production
npm run build
\`\`\`

### Project Structure

\`\`\`
${manifest.id}/
├── src/                    # Source code
├── public/                  # Static assets
├── docs/                    # Documentation
├── tests/                   # Test files
├── addon.json              # Addon manifest
├── package.json            # Dependencies
└── README.md               # This file
\`\`\`

## Changelog

### Version ${manifest.version}

- Initial release
- ${manifest.description}

## License

${manifest.license || 'MIT License'}

---

*This documentation is automatically generated. Last updated: ${new Date().toISOString().split('T')[0]}*
`;

  await fs.writeFile(path.join(outputDir, 'README.md'), readme);
}

async function generateApiDocs(
  outputDir: string,
  manifest: AddonManifest,
): Promise<void> {
  const apiDocs = `# API Documentation

This addon provides access to the following APIs and functionality.

## Addon Runtime API

The addon runtime provides a secure API for interacting with OpenAidy services.

### Agent Communication

#### \`invokeAgent(agentId, input)\`

Invokes an agent with the provided input.

**Parameters:**
- \`agentId\` (string): ID of the agent to invoke
- \`input\` (any): Input data for the agent

**Returns:**
- \`Promise<any>\`: Agent response

**Example:**
\`\`\`javascript
const result = await runtime.invokeAgent('analysis-agent', {
  text: 'Analyze this text',
  options: { sentiment: true }
});
\`\`\`

### Session Management

#### \`createSession(config)\`

Creates a new session.

**Parameters:**
- \`config\` (object): Session configuration

**Returns:**
- \`Promise<Session>\`: Created session

#### \`getSession(id)\`

Retrieves a session by ID.

**Parameters:**
- \`id\` (string): Session ID

**Returns:**
- \`Promise<Session>\`: Session data

#### \`listSessions()\`

Lists all accessible sessions.

**Returns:**
- \`Promise<Session[]>\`: Array of sessions

### Configuration

#### \`getConfig(namespace?)\`

Retrieves configuration data.

**Parameters:**
- \`namespace\` (string, optional): Configuration namespace

**Returns:**
- \`Promise<any>\`: Configuration data

#### \`setConfig(namespace, config)\`

Sets configuration data.

**Parameters:**
- \`namespace\` (string): Configuration namespace
- \`config\` (any): Configuration data

**Returns:**
- \`Promise<void>\`

### UI Utilities

#### \`navigate(path)\`

Navigates to a specific path.

**Parameters:**
- \`path\` (string): Navigation path

#### \`showNotification(message, type)\`

Shows a notification to the user.

**Parameters:**
- \`message\` (string): Notification message
- \`type\` ('info' | 'success' | 'error'): Notification type

### Storage

#### \`getStorage(key)\`

Retrieves a value from addon-scoped storage.

**Parameters:**
- \`key\` (string): Storage key

**Returns:**
- \`Promise<string | null>\`: Stored value

#### \`setStorage(key, value)\`

Sets a value in addon-scoped storage.

**Parameters:**
- \`key\` (string): Storage key
- \`value\` (string): Value to store

**Returns:**
- \`Promise<void>\`

#### \`removeStorage(key)\`

Removes a value from addon-scoped storage.

**Parameters:**
- \`key\` (string): Storage key

**Returns:**
- \`Promise<void>\`

## Available Agents

${generateAgentDocs(manifest)}

## Error Handling

All API methods may throw errors. Always wrap calls in try-catch blocks:

\`\`\`javascript
try {
  const result = await runtime.invokeAgent('agent-id', input);
  console.log('Success:', result);
} catch (error) {
  console.error('Error:', error.message);
  runtime.showNotification('Operation failed', 'error');
}
\`\`\`

## Best Practices

1. **Always handle errors** - Wrap API calls in try-catch blocks
2. **Check permissions** - Ensure your addon has the required permissions
3. **Use storage wisely** - Storage is limited and addon-scoped
4. **Provide feedback** - Use notifications to inform users of actions
5. **Validate inputs** - Validate user inputs before API calls
`;

  await fs.writeFile(path.join(outputDir, 'API.md'), apiDocs);
}

async function generateExamples(
  outputDir: string,
  manifest: AddonManifest,
): Promise<void> {
  const examplesDir = path.join(outputDir, 'examples');
  await fs.ensureDir(examplesDir);

  // Basic usage example
  const basicExample = `// Basic addon usage example
import { createSignal, onMount } from 'solid-js';

export default function ExampleComponent() {
  const [result, setResult] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  let runtime;

  onMount(() => {
    runtime = window.__ADDON_RUNTIME__;
  });

  const handleExampleAction = async () => {
    setLoading(true);
    try {
      // Example: Invoke an agent
      const response = await runtime.invokeAgent('example-agent', {
        message: 'Hello from addon!'
      });
      
      setResult(response);
      runtime.showNotification('Action completed successfully!', 'success');
    } catch (error) {
      runtime.showNotification(\`Error: \${error.message}\`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="p-6">
      <h2>Example Usage</h2>
      <button onClick={handleExampleAction} disabled={loading()}>
        {loading() ? 'Loading...' : 'Run Example'}
      </button>
      
      {result() && (
        <div class="mt-4 p-4 bg-gray-100 rounded">
          <h3>Result:</h3>
          <pre>{JSON.stringify(result(), null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
`;

  await fs.writeFile(path.join(examplesDir, 'basic-usage.js'), basicExample);

  // Configuration example
  if (manifest.config) {
    const configExample = `// Configuration management example
import { createSignal, onMount } from 'solid-js';

export default function ConfigExample() {
  const [config, setConfig] = createSignal({});
  const [loading, setLoading] = createSignal(false);
  let runtime;

  onMount(async () => {
    runtime = window.__ADDON_RUNTIME__;
    
    // Load existing configuration
    try {
      const savedConfig = await runtime.getConfig('addon');
      if (savedConfig) {
        setConfig(savedConfig);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  });

  const saveConfig = async () => {
    setLoading(true);
    try {
      await runtime.setConfig('addon', config());
      runtime.showNotification('Configuration saved!', 'success');
    } catch (error) {
      runtime.showNotification('Failed to save config', 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div class="p-6">
      <h2>Configuration Example</h2>
      
      ${Object.entries(manifest.config.defaults)
        .map(
          ([key, defaultValue]) => `
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">${key}</label>
        <input
          type="${typeof defaultValue === 'number' ? 'number' : 'text'}"
          value={config()[key] ?? ${JSON.stringify(defaultValue)}}
          onInput={(e) => updateConfig('${key}', e.currentTarget.value)}
          class="w-full px-3 py-2 border rounded"
        />
      </div>
      `,
        )
        .join('')}
      
      <button onClick={saveConfig} disabled={loading()}>
        {loading() ? 'Saving...' : 'Save Configuration'}
      </button>
      
      <div class="mt-4">
        <h3>Current Config:</h3>
        <pre>{JSON.stringify(config(), null, 2)}</pre>
      </div>
    </div>
  );
}
`;

    await fs.writeFile(
      path.join(examplesDir, 'config-management.js'),
      configExample,
    );
  }
}

async function generateConfigGuide(
  outputDir: string,
  manifest: AddonManifest,
): Promise<void> {
  if (!manifest.config) return;

  const configGuide = `# Configuration Guide

This addon supports configuration through the OpenAidy interface. This guide explains all available configuration options.

## Configuration Options

${Object.entries(manifest.config.defaults)
  .map(
    ([key, defaultValue]) => `
### ${key}

**Type:** ${typeof defaultValue}
**Default:** ${JSON.stringify(defaultValue)}

${generateConfigDescription(key, defaultValue)}
`,
  )
  .join('')}

## Configuration Schema

The addon configuration follows this JSON schema:

\`\`\`json
${JSON.stringify(manifest.config, null, 2)}
\`\`\`

## Accessing Configuration in Code

You can access the addon configuration in your code using the runtime API:

\`\`\`javascript
// Get all configuration
const config = await runtime.getConfig();

// Get specific namespace configuration
const addonConfig = await runtime.getConfig('addon');

// Update configuration
await runtime.setConfig('addon', {
  ${Object.keys(manifest.config.defaults)
    .map((key) => `${key}: 'new-value'`)
    .join(',\n  ')}
});
\`\`\`

## Configuration Best Practices

1. **Validate inputs** - Always validate configuration values before using them
2. **Provide defaults** - Ensure your addon works with default values
3. **Handle errors** - Wrap configuration access in try-catch blocks
4. **Document changes** - Update documentation when adding new options
5. **Use appropriate types** - Use the correct data types for configuration values

## Example Configuration

Here's an example of a complete configuration:

\`\`\`json
{
${Object.entries(manifest.config.defaults)
  .map(([key, value]) => `  "${key}": ${JSON.stringify(value)}`)
  .join(',\n')}
}
\`\`\`

## Troubleshooting

### Configuration Not Saving

- Check that you have admin permissions
- Verify the configuration values are valid
- Review the addon logs for error messages

### Invalid Configuration Values

- Ensure values match the expected types
- Check the configuration schema for constraints
- Use the OpenAidy configuration interface for validation

### Configuration Not Loading

- Verify the addon has \`config.read\` permission
- Check the addon logs for loading errors
- Ensure the configuration namespace is correct
`;

  await fs.writeFile(path.join(outputDir, 'CONFIGURATION.md'), configGuide);
}

// Helper functions
function generateFeatureList(manifest: AddonManifest): string {
  const features = [];

  if (manifest.agents.length > 0) {
    features.push(
      `Integration with ${manifest.agents.length} agent${manifest.agents.length > 1 ? 's' : ''}`,
    );
  }

  if (manifest.ui.routes.length > 1) {
    features.push(`${manifest.ui.routes.length} different pages/interfaces`);
  }

  if (manifest.config) {
    features.push('Customizable configuration options');
  }

  features.push('Seamless OpenAidy integration');
  features.push('Real-time updates and notifications');

  return features.join('\n- ');
}

function generateUsageSection(manifest: AddonManifest): string {
  const sections = [];

  if (manifest.agents.length > 0) {
    sections.push(`
#### Agent Integration

The addon integrates with the following agents:
${manifest.agents.map((agent) => `- **${agent.id}**: ${agent.description}`).join('\n')}

Use these agents through the addon interface to perform specific tasks.
`);
  }

  if (manifest.ui.routes.length > 1) {
    sections.push(`
#### Multiple Interfaces

This addon provides ${manifest.ui.routes.length} different interfaces:
${manifest.ui.routes.map((route) => `- **${route.path}**: ${route.component}`).join('\n')}
`);
  }

  return sections.join('\n');
}

function generatePermissionsList(manifest: AddonManifest): string {
  return manifest.permissions
    .map((perm) => {
      let description = '';
      switch (perm.type) {
        case 'agent':
          description = `Can invoke the ${perm.target} agent`;
          break;
        case 'session':
          description = `Can ${perm.action} sessions${perm.target ? ` (${perm.target})` : ''}`;
          break;
        case 'config':
          description = `Can ${perm.action} configuration${perm.target ? ` (${perm.target})` : ''}`;
          break;
        case 'system':
          description = `System-level access: ${perm.action}`;
          break;
      }
      return `- \`${perm.type}.${perm.action}${perm.target ? ':' + perm.target : ''}\` - ${description}`;
    })
    .join('\n');
}

function generateAgentDocs(manifest: AddonManifest): string {
  if (manifest.agents.length === 0) {
    return 'This addon does not use any specific agents.';
  }

  return manifest.agents
    .map(
      (agent) => `
### ${agent.id}

**Required:** ${agent.required ? 'Yes' : 'No'}
**Description:** ${agent.description}

\`\`\`javascript
const result = await runtime.invokeAgent('${agent.id}', {
  // Agent-specific input
});
\`\`\`
`,
    )
    .join('\n');
}

function generateConfigDescription(key: string, defaultValue: any): string {
  const descriptions: Record<string, string> = {
    refreshInterval: 'How often the addon should refresh data (in seconds).',
    theme: 'UI theme preference for the addon interface.',
    notifications: 'Whether to show notifications for addon events.',
    apiKey: 'API key for external service integration.',
    endpoint: 'Custom endpoint URL for external services.',
    timeout: 'Request timeout in milliseconds.',
    retries: 'Number of retry attempts for failed requests.',
    debug: 'Enable debug mode for additional logging.',
  };

  return descriptions[key] || 'Configuration option for the addon.';
}
```

## Success Criteria

Phase 4 is complete when:

1. ✅ **CLI Tool**: Complete CLI with create, build, test, validate, and publish commands
2. ✅ **Template System**: Multiple addon templates for different use cases
3. ✅ **Development Server**: Hot reloading and local development environment
4. ✅ **Testing Framework**: Comprehensive testing utilities and examples
5. ✅ **Documentation**: Auto-generated documentation and API references
6. ✅ **Validation Tools**: Package validation and security scanning
7. ✅ **Developer Experience**: Intuitive workflows and helpful error messages

## Next Steps

After Phase 4 completion:

- Begin Phase 5: Advanced features and marketplace
- Create addon developer certification program
- Build community contribution guidelines
- Add performance profiling tools

This phase provides a comprehensive developer experience that makes it easy and enjoyable to create high-quality addons for the OpenAidy ecosystem.
