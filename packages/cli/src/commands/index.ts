/**
 * Command Registry
 * 
 * Central registration point for all CLI commands.
 * Supports hierarchical command groups with help output.
 */

import type { CommandHandler, CommandRegistry, CommandMeta, CommandGroup } from '../types';

/**
 * All registered command handlers
 */
export const commands: CommandRegistry = {};

/**
 * Command metadata for help output
 */
export const commandMeta: Record<string, CommandMeta> = {};

/**
 * Command groups for organized help output
 */
export const commandGroups: CommandGroup[] = [];

/**
 * Register a new command handler
 */
export function registerCommand(
  name: string,
  handler: CommandHandler,
  meta?: CommandMeta,
): void {
  commands[name] = handler;
  if (meta) {
    commandMeta[name] = meta;
  }
}

/**
 * Get a command handler by name
 */
export function getCommand(name: string): CommandHandler | undefined {
  return commands[name];
}

/**
 * Get command metadata
 */
export function getCommandMeta(name: string): CommandMeta | undefined {
  return commandMeta[name];
}

/**
 * Check if a command exists
 */
export function hasCommand(name: string): boolean {
  return name in commands;
}

/**
 * List all available commands
 */
export function listCommands(): string[] {
  return Object.keys(commands);
}

/**
 * Register a command group
 */
export function registerGroup(group: CommandGroup): void {
  commandGroups.push(group);
}

/**
 * Get a command group by name
 */
export function getGroup(name: string): CommandGroup | undefined {
  return commandGroups.find((g) => g.name === name);
}

/**
 * List all command groups
 */
export function listGroups(): CommandGroup[] {
  return commandGroups;
}

/**
 * Get commands for a specific group
 */
export function getGroupCommands(groupName: string): string[] {
  return Object.keys(commands).filter((cmd) => cmd.startsWith(`${groupName} `));
}

// ============================================================================
// Command Groups Definition
// ============================================================================

registerGroup({
  name: 'admin',
  description: 'Administrative commands for bootstrap-admin and system management',
  commands: {
    'admin token show': {
      description: 'Show the current bootstrap-admin token information',
      usage: 'openaidy admin token show',
      examples: ['pnpm openaidy admin token show'],
    },
    'admin token validate': {
      description: 'Validate the bootstrap-admin token',
      usage: 'openaidy admin token validate',
      examples: ['pnpm openaidy admin token validate'],
    },
    'admin token path': {
      description: 'Show the path to the bootstrap-admin token file',
      usage: 'openaidy admin token path',
      examples: ['pnpm openaidy admin token path'],
    },
  },
});

registerGroup({
  name: 'devices',
  description: 'Device pairing and management commands',
  commands: {
    'devices list': {
      description: 'List pending device pairing requests',
      usage: 'openaidy devices list',
      examples: ['pnpm openaidy devices list'],
    },
    'devices approve': {
      description: 'Approve a pending device pairing request',
      usage: 'openaidy devices approve <request-id>',
      examples: ['pnpm openaidy devices approve abc123'],
    },
    'devices deny': {
      description: 'Deny a pending device pairing request',
      usage: 'openaidy devices deny <request-id>',
      examples: ['pnpm openaidy devices deny abc123'],
    },
  },
});

// ============================================================================
// Command Handlers Registration
// ============================================================================

// Admin token commands
registerCommand(
  'admin token show',
  async (args: string[]) => {
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy admin token show

Show the current bootstrap-admin token information.

This command displays:
  - Token status (valid, expired, missing, malformed, invalid, disabled)
  - Token file path
  - Token value (only for valid/expired tokens)
  - Metadata (client ID, created, expires, scopes)

Examples:
  pnpm openaidy admin token show

Exit Codes:
  0  Token is valid
  1  Token is disabled, missing, malformed, invalid, or expired
`,
      };
    }
    // Placeholder - actual implementation in issue #132
    return {
      exitCode: 1,
      output:
        'Bootstrap Admin Token\n========================\n\nStatus:    missing\nPath:      .openaidy/credentials/bootstrap-admin.json\nEnabled:   true\n\nError: Token file not found',
    };
  },
  {
    description: 'Show the current bootstrap-admin token information',
    usage: 'openaidy admin token show',
    examples: ['pnpm openaidy admin token show'],
  },
);

registerCommand(
  'admin token validate',
  async (args: string[]) => {
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy admin token validate

Validate the bootstrap-admin token.

This command checks:
  - Token file exists
  - Token is valid JSON
  - Token signature is valid
  - Token is not expired

Examples:
  pnpm openaidy admin token validate

Exit Codes:
  0  Token is valid
  1  Token is invalid, missing, or expired
`,
      };
    }
    return {
      exitCode: 1,
      output: 'Token validation not yet implemented',
    };
  },
  {
    description: 'Validate the bootstrap-admin token',
    usage: 'openaidy admin token validate',
  },
);

registerCommand(
  'admin token path',
  async (args: string[]) => {
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy admin token path

Show the path to the bootstrap-admin token file.

Examples:
  pnpm openaidy admin token path
`,
      };
    }
    return {
      exitCode: 0,
      output: '.openaidy/credentials/bootstrap-admin.json',
    };
  },
  {
    description: 'Show the path to the bootstrap-admin token file',
    usage: 'openaidy admin token path',
  },
);

// Devices commands
registerCommand(
  'devices list',
  async (args: string[]) => {
    // Import the handler dynamically to avoid circular dependencies
    const { devicesListHandler } = await import('./devices/list.js');
    return devicesListHandler(args);
  },
  {
    description: 'List pending device pairing requests',
    usage: 'openaidy devices list [--status <status>] [--limit <n>]',
    examples: [
      'pnpm openaidy devices list',
      'pnpm openaidy devices list --status all',
      'pnpm openaidy devices list --status approved --limit 10',
    ],
  },
);

registerCommand(
  'devices approve',
  async (args: string[]) => {
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy devices approve <request-id>

Approve a pending device pairing request.

Arguments:
  request-id    The ID of the pairing request to approve

Examples:
  pnpm openaidy devices approve abc123

Exit Codes:
  0  Request approved successfully
  1  Request not found or already processed
`,
      };
    }
    if (args.length === 0) {
      return {
        exitCode: 2,
        error: 'Error: Missing required argument <request-id>\n\nUsage: openaidy devices approve <request-id>',
      };
    }
    return {
      exitCode: 1,
      output: `Device pairing approval not yet implemented. Request ID: ${args[0]}`,
    };
  },
  {
    description: 'Approve a pending device pairing request',
    usage: 'openaidy devices approve <request-id>',
  },
);

registerCommand(
  'devices deny',
  async (args: string[]) => {
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: openaidy devices deny <request-id>

Deny a pending device pairing request.

Arguments:
  request-id    The ID of the pairing request to deny

Examples:
  pnpm openaidy devices deny abc123

Exit Codes:
  0  Request denied successfully
  1  Request not found or already processed
`,
      };
    }
    if (args.length === 0) {
      return {
        exitCode: 2,
        error: 'Error: Missing required argument <request-id>\n\nUsage: openaidy devices deny <request-id>',
      };
    }
    return {
      exitCode: 1,
      output: `Device pairing denial not yet implemented. Request ID: ${args[0]}`,
    };
  },
  {
    description: 'Deny a pending device pairing request',
    usage: 'openaidy devices deny <request-id>',
  },
);
