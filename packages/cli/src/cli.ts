/**
 * OpenAidy Addon CLI - Main Entry Point
 *
 * Comprehensive CLI tool for addon development, testing, and publishing.
 */

import { createAddon } from './commands/create.js';
import { buildAddon } from './commands/build.js';
import { runTests } from './commands/test.js';
import { validateAddon } from './commands/validate.js';
import { publishAddon } from './commands/publish.js';
import { startDevServer } from './commands/dev.js';
import { initAddon } from './commands/init.js';
import { listTemplates } from './utils/template-generator.js';

// ASCII Art Banner
const BANNER = `
  ____  _ _     _____           _                 
 |  _ \\(_) |_  |_   _|__   ___ | | ___   _ _ ___ 
 | |_) | | __|   | |/ _ \\ / _ \\| |/ / | | | / __|
 |  __/| | |_    | | (_) | (_) |   <| |_| \\__ \\
 |_|   |_|\\__|   |_|\\___/ \\___/|_|\\_\\__,_|___/
                                                  
Addon Development CLI v1.0.0
`;

// Help text
const HELP = `
OpenAidy Addon Development CLI

Usage: openaidy <command> [options]

Commands:
  create <name>    Create a new addon project
  init             Initialize an existing addon project
  build            Build addon for production
  test             Run addon tests
  validate         Validate addon package
  dev              Start development server
  publish          Publish addon to registry

Options:
  -h, --help       Show this help message
  -v, --version    Show version
  --list-templates List available templates

Examples:
  openaidy create my-addon
  openaidy build
  openaidy validate --verbose
  openaidy dev --port 3000

For more information, visit: https://docs.openaidy.dev/addons
`;

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const subArgs = args.slice(1);

async function main() {
  console.log(BANNER);

  switch (command) {
    case 'create': {
      const name = subArgs[0];
      if (!name) {
        console.error('Error: Addon name is required');
        console.error('Usage: openaidy create <name>');
        process.exit(1);
      }

      const options: Record<string, string | boolean> = {};
      for (let i = 1; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === '-d' || arg === '--directory') {
          options.directory = subArgs[++i];
        } else if (arg === '-t' || arg === '--template') {
          options.template = subArgs[++i];
        } else if (arg === '--no-git') {
          options.noGit = true;
        } else if (arg === '--no-install') {
          options.noInstall = true;
        }
      }

      const result = await createAddon(name, options);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        if (result.projectPath) {
          console.log(`  Project created at: ${result.projectPath}`);
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'build': {
      const options: Record<string, boolean> = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === '-w' || arg === '--watch') {
          options.watch = true;
        } else if (arg === '-m' || arg === '--minify') {
          options.minify = true;
        } else if (arg === '-s' || arg === '--sourcemap') {
          options.sourcemap = true;
        }
      }

      const result = await buildAddon(process.cwd(), options);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        if (result.outputPath) {
          console.log(`  Output: ${result.outputPath}`);
        }
        if (result.warnings) {
          for (const warning of result.warnings) {
            console.log(`  Warning: ${warning}`);
          }
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'test': {
      const options: Record<string, string | boolean> = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === '--watch') {
          options.watch = true;
        } else if (arg === '--coverage') {
          options.coverage = true;
        } else if (arg === '--ui') {
          options.ui = true;
        } else if (arg === '--filter') {
          options.filter = subArgs[++i];
        }
      }

      const result = await runTests(process.cwd(), options);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        if (result.testFiles !== undefined) {
          console.log(`  Test files: ${result.testFiles}`);
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'validate': {
      const options: Record<string, boolean> = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === '-p' || arg === '--package') {
          options.package = true;
        } else if (arg === '-v' || arg === '--verbose') {
          options.verbose = true;
        } else if (arg === '--strict') {
          options.strict = true;
        }
      }

      const result = await validateAddon(process.cwd(), options);
      if (result.valid) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(`✗ ${result.message}`);
        if (result.errors.length > 0) {
          console.error('Errors:');
          for (const error of result.errors) {
            console.error(`  - ${error}`);
          }
        }
        if (result.warnings.length > 0) {
          console.warn('Warnings:');
          for (const warning of result.warnings) {
            console.warn(`  - ${warning}`);
          }
        }
        process.exit(1);
      }
      break;
    }

    case 'dev': {
      const options: Record<string, string | number> = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === '--port') {
          options.port = parseInt(subArgs[++i], 10);
        } else if (arg === '--host') {
          options.host = subArgs[++i];
        } else if (arg === '--openaidy-url') {
          options.openaidyUrl = subArgs[++i];
        }
      }

      const result = await startDevServer(process.cwd(), options);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        console.log(`  Server running at http://${result.host}:${result.port}`);
        console.log('Press Ctrl+C to stop');
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'init': {
      const options: Record<string, boolean> = {};
      for (let i = 0; i < subArgs.length; i++) {
        if (subArgs[i] === '--force') {
          options.force = true;
        }
      }

      const result = await initAddon(process.cwd(), options);
      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'publish': {
      const options: Record<string, string> = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === '--registry') {
          options.registry = subArgs[++i];
        } else if (arg === '--access') {
          options.access = subArgs[++i];
        } else if (arg === '--tag') {
          options.tag = subArgs[++i];
        }
      }

      const result = await publishAddon(process.cwd(), options);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        if (result.registryUrl) {
          console.log(`  Registry: ${result.registryUrl}`);
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case '--list-templates': {
      const templates = listTemplates();
      console.log('\nAvailable Templates:\n');
      for (const template of templates) {
        console.log(`  ${template.name.padEnd(12)} ${template.description}`);
      }
      console.log('');
      break;
    }

    case '-h':
    case '--help': {
      console.log(HELP);
      break;
    }

    case '-v':
    case '--version': {
      console.log('OpenAidy Addon CLI v1.0.0');
      break;
    }

    default: {
      if (command) {
        console.error(`Unknown command: ${command}`);
        console.error('Run "openaidy --help" for usage information');
        process.exit(1);
      } else {
        console.log(HELP);
      }
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
