/**
 * OpenAidy CLI
 *
 * Local administration tool for OpenAidy.
 */

import {
  commands,
  commandMeta,
  commandGroups,
  listGroups,
  getGroup,
  getGroupCommands,
} from './commands/index.js';
import type { CommandResult, CommandMeta } from './types.js';
import { defaultCLIConfig, ExitCodes } from './types.js';

// ============================================================================
// Banner
// ============================================================================

const BANNER = `
  ___                          _     _     _       
 / _ \\ _ __   ___ _ __   / \\ (_) __| |_   _
| | | | '_ \\ / _ \\ '_ \\ / _ \\| |/ _\` | | | |
| |_| | |_) |  __/ | | / ___ \\ | (_| | |_| |
 \\___/| .__/ \\___|_| |_/_/   \\_\\_|\\__,_|\\__, |
      |_|                                |___/ 
`;

// ============================================================================
// Help Output Functions
// ============================================================================

/**
 * Print root help message with all command groups
 */
function printRootHelp(): void {
  console.log(BANNER);
  console.log(`
${defaultCLIConfig.name} - ${defaultCLIConfig.description}

Usage:
  ${defaultCLIConfig.name} <command> [args]
  ${defaultCLIConfig.name} <group> <command> [args]

Command Groups:
${formatGroups()}

Options:
  -h, --help          Show this help message
  -v, --version       Show version

Examples:
  pnpm ${defaultCLIConfig.name} admin token show
  pnpm ${defaultCLIConfig.name} devices list
  pnpm ${defaultCLIConfig.name} admin --help
`);
}

/**
 * Format command groups for help output
 */
function formatGroups(): string {
  return listGroups()
    .map((group) => `  ${group.name.padEnd(12)} ${group.description}`)
    .join('\n');
}

/**
 * Print help for a specific command group
 */
function printGroupHelp(groupName: string): boolean {
  const group = getGroup(groupName);
  if (!group) {
    return false;
  }

  const groupCommands = getGroupCommands(groupName);

  console.log(`
${group.name} - ${group.description}

Usage:
  ${defaultCLIConfig.name} ${groupName} <command> [args]

Commands:
${formatGroupCommands(group)}

Options:
  -h, --help          Show this help message

Examples:
${formatGroupExamples(groupName, groupCommands)}
`);
  return true;
}

/**
 * Format commands within a group for help output
 */
function formatGroupCommands(group: (typeof commandGroups)[0]): string {
  return Object.entries(group.commands as Record<string, CommandMeta>)
    .map(([name, meta]) => {
      const shortName = name.replace(`${group.name} `, '');
      return `  ${shortName.padEnd(16)} ${meta.description}`;
    })
    .join('\n');
}

/**
 * Format examples for a command group
 */
function formatGroupExamples(groupName: string, cmds: string[]): string {
  const examples: string[] = [];

  // Show examples from command metadata
  for (const cmd of cmds.slice(0, 2)) {
    const meta = commandMeta[cmd];
    if (meta?.examples) {
      examples.push(...meta.examples);
    } else {
      examples.push(`  pnpm ${defaultCLIConfig.name} ${cmd}`);
    }
  }

  examples.push(
    `  pnpm ${defaultCLIConfig.name} ${groupName} <command> --help`,
  );

  return examples.join('\n');
}

/**
 * Print help for a specific command
 */
function printCommandHelp(command: string): boolean {
  const meta = commandMeta[command];
  if (!meta) {
    return false;
  }

  const usage = meta.usage || `${defaultCLIConfig.name} ${command}`;

  console.log(`
Usage: ${usage}

${meta.description}
${meta.examples ? `\nExamples:\n${meta.examples.map((e: string) => `  ${e}`).join('\n')}` : ''}
`);
  return true;
}

/**
 * Print version
 */
function printVersion(): void {
  console.log(BANNER);
  console.log(`${defaultCLIConfig.name} v${defaultCLIConfig.version}`);
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Create a standardized error result
 */
function createError(
  message: string,
  exitCode: number = ExitCodes.ERROR,
): CommandResult {
  return {
    exitCode,
    error: message,
  };
}

/**
 * Handle unknown command error
 */
function handleUnknownCommand(argv: string[]): CommandResult {
  const command = argv[0];

  // Check if it's a valid group name
  const group = getGroup(command);
  if (group) {
    // User typed just the group name - show group help
    return {
      exitCode: ExitCodes.SUCCESS,
      output: '', // Will be handled by printGroupHelp
    };
  }

  return createError(
    `Unknown command: ${argv.join(' ')}\n\nRun "${defaultCLIConfig.name} --help" for usage information.`,
    ExitCodes.NOT_FOUND,
  );
}

// ============================================================================
// Main CLI Entry Point
// ============================================================================

/**
 * Run the CLI with given arguments
 *
 * @param argv - Command line arguments (without node and script name)
 * @returns Exit code
 */
export async function runCli(argv: string[]): Promise<number> {
  // No args or help flag - show root help
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printRootHelp();
    return ExitCodes.SUCCESS;
  }

  // Version flag
  if (argv[0] === '-v' || argv[0] === '--version') {
    printVersion();
    return ExitCodes.SUCCESS;
  }

  // Check for group-level help: `openaidy admin --help`
  if (argv.length === 2 && (argv[1] === '-h' || argv[1] === '--help')) {
    const groupName = argv[0];
    if (printGroupHelp(groupName)) {
      return ExitCodes.SUCCESS;
    }
    // Not a valid group - fall through to command matching
  }

  // Try to match the longest command first (e.g., "admin token show" before "admin token")
  const commandKeys = Object.keys(commands).sort(
    (a, b) => b.split(' ').length - a.split(' ').length,
  );

  for (const key of commandKeys) {
    const parts = key.split(' ');
    const matches = parts.every((part, i) => argv[i] === part);

    if (matches) {
      const args = argv.slice(parts.length);
      const handler = commands[key];

      // Check for command-level help
      if (args.includes('-h') || args.includes('--help')) {
        if (printCommandHelp(key)) {
          return ExitCodes.SUCCESS;
        }
      }

      try {
        const result: CommandResult = await handler(args);

        if (result.output) {
          console.log(result.output);
        }
        if (result.error) {
          console.error(result.error);
        }

        return result.exitCode;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        return ExitCodes.ERROR;
      }
    }
  }

  // Check if first arg is a valid group but command is missing
  const firstArg = argv[0];
  const group = getGroup(firstArg);
  if (group && argv.length === 1) {
    // User typed just the group name
    printGroupHelp(firstArg);
    return ExitCodes.SUCCESS;
  }

  // Handle partial matches for groups
  if (group) {
    const subCommand = argv.slice(1).join(' ');
    return createError(
      `Unknown ${firstArg} command: ${subCommand}\n\nRun "${defaultCLIConfig.name} ${firstArg} --help" for available commands.`,
      ExitCodes.NOT_FOUND,
    ).exitCode;
  }

  // Unknown command
  const errorResult = handleUnknownCommand(argv);
  console.error(errorResult.error);
  return errorResult.exitCode;
}

// Re-export for external use
export { type CommandResult, type CommandHandler, ExitCodes } from './types.js';
export {
  commands,
  commandMeta,
  commandGroups,
  listGroups,
  registerCommand,
  getGroup,
} from './commands/index.js';
