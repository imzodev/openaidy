/**
 * OpenAidy CLI
 * 
 * Local administration tool for OpenAidy.
 */

import { commands, listCommands } from './commands/index';
import type { CommandResult } from './types';
import { defaultCLIConfig, ExitCodes } from './types';

/**
 * Print help message
 */
function printHelp(): void {
  const commandList = listCommands()
    .map((cmd) => `  ${cmd}`)
    .join('\n');

  console.log(`
${defaultCLIConfig.name} - ${defaultCLIConfig.description}

Usage:
  ${defaultCLIConfig.name} <command> [args]

Commands:
${commandList || '  (no commands registered yet)'}

Options:
  -h, --help          Show this help message
  -v, --version       Show version

Examples:
  pnpm ${defaultCLIConfig.name} admin token show
`);
}

/**
 * Print version
 */
function printVersion(): void {
  console.log(`${defaultCLIConfig.name} v${defaultCLIConfig.version}`);
}

/**
 * Run the CLI with given arguments
 */
export async function runCli(argv: string[]): Promise<number> {
  // No args or help flag
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    return ExitCodes.SUCCESS;
  }

  // Version flag
  if (argv[0] === '-v' || argv[0] === '--version') {
    printVersion();
    return ExitCodes.SUCCESS;
  }

  // Try to match the longest command first
  const commandKeys = Object.keys(commands).sort(
    (a, b) => b.split(' ').length - a.split(' ').length,
  );

  for (const key of commandKeys) {
    const parts = key.split(' ');
    const matches = parts.every((part, i) => argv[i] === part);

    if (matches) {
      const args = argv.slice(parts.length);
      const handler = commands[key];
      const result: CommandResult = await handler(args);

      if (result.output) {
        console.log(result.output);
      }
      if (result.error) {
        console.error(result.error);
      }

      return result.exitCode;
    }
  }

  // Unknown command
  console.error(`Unknown command: ${argv.join(' ')}`);
  console.error('Run "openaidy --help" for usage information.');
  return ExitCodes.ERROR;
}

// Re-export types
export { type CommandResult, type CommandHandler, ExitCodes } from './types';
export { commands, listCommands } from './commands/index';
