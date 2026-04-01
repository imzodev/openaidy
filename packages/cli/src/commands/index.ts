/**
 * Command Registry
 * 
 * Central registration point for all CLI commands.
 */

import type { CommandRegistry, CommandHandler } from '../types';

/**
 * All registered commands
 */
export const commands: CommandRegistry = {};

/**
 * Register a new command handler
 */
export function registerCommand(name: string, handler: CommandHandler): void {
  commands[name] = handler;
}

/**
 * Get a command handler by name
 */
export function getCommand(name: string): CommandHandler | undefined {
  return commands[name];
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

// Import and register command handlers
// Note: For issue #134, we're just setting up the foundation
// Command handlers will be registered in other issues

// Example placeholder command for testing
registerCommand('admin token show', async (args: string[]) => {
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

  // Placeholder implementation - actual logic in issue #132
  return {
    exitCode: 1,
    output: 'Bootstrap Admin Token\n========================\n\nStatus:    missing\nPath:      .openaidy/credentials/bootstrap-admin.json\nEnabled:   true\n\nError: Token file not found',
  };
});
