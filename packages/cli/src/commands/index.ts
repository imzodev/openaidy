/**
 * Command Registry
 *
 * Central registration point for all CLI commands.
 * Supports hierarchical command groups with help output.
 */

import type {
  CommandHandler,
  CommandRegistry,
  CommandMeta,
  CommandGroup,
} from '../types.js';

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
  description:
    'Administrative commands for bootstrap-admin and system management',
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
  name: 'tokens',
  description: 'Manage access tokens for UI login and API access',
  commands: {
    'tokens list': {
      description: 'List all access tokens',
      usage: 'openaidy tokens list',
      examples: ['pnpm openaidy tokens list'],
    },
    'tokens create': {
      description: 'Create a new access token',
      usage: 'openaidy tokens create --name <name> --scopes <scopes>',
      examples: [
        'pnpm openaidy tokens create --name "CI Pipeline" --scopes "sessions.read,sessions.stream"',
        'pnpm openaidy tokens create --name "Admin Key" --scopes "*"',
      ],
    },
    'tokens revoke': {
      description: 'Revoke an access token by ID',
      usage: 'openaidy tokens revoke <id>',
      examples: ['pnpm openaidy tokens revoke abc123'],
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
    const { createAdminWorkflow, formatTokenInspection } =
      await import('../lib/admin-workflow.js');
    const { workflow } = createAdminWorkflow();
    const result = await workflow.inspectToken();
    const output = formatTokenInspection(result);
    const isValid = result.success && result.data?.status === 'valid';
    return { exitCode: isValid ? 0 : 1, output };
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
    const { createAdminWorkflow } = await import('../lib/admin-workflow.js');
    const { workflow } = createAdminWorkflow();
    const result = await workflow.inspectToken();
    if (!result.success) {
      return {
        exitCode: 1,
        error: `Error: ${result.error?.message ?? 'Unknown error'}`,
      };
    }
    const status = result.data?.status;
    const isValid = status === 'valid';
    return {
      exitCode: isValid ? 0 : 1,
      output: isValid ? `✓ Token is valid` : `✗ Token is ${status}`,
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
    const { resolveCLIConfig } = await import('../lib/config.js');
    return { exitCode: 0, output: resolveCLIConfig().tokenPath };
  },
  {
    description: 'Show the path to the bootstrap-admin token file',
    usage: 'openaidy admin token path',
  },
);

// Tokens commands
registerCommand(
  'tokens list',
  async (args: string[]) => {
    const { tokensListHandler } = await import('./tokens/list.js');
    return tokensListHandler(args);
  },
  {
    description: 'List all access tokens',
    usage: 'openaidy tokens list',
    examples: ['pnpm openaidy tokens list'],
  },
);

registerCommand(
  'tokens create',
  async (args: string[]) => {
    const { tokensCreateHandler } = await import('./tokens/create.js');
    return tokensCreateHandler(args);
  },
  {
    description: 'Create a new access token',
    usage:
      'openaidy tokens create --name <name> --scopes <scopes> [--expires <date>]',
    examples: [
      'pnpm openaidy tokens create --name "CI Pipeline" --scopes "sessions.read,sessions.stream"',
      'pnpm openaidy tokens create --name "Admin Key" --scopes "*"',
    ],
  },
);

registerCommand(
  'tokens revoke',
  async (args: string[]) => {
    const { tokensRevokeHandler } = await import('./tokens/revoke.js');
    return tokensRevokeHandler(args);
  },
  {
    description: 'Revoke an access token by ID',
    usage: 'openaidy tokens revoke <id>',
    examples: ['pnpm openaidy tokens revoke abc123'],
  },
);

// ============================================================================
// Addon Command Group
// ============================================================================

registerGroup({
  name: 'addon',
  description: 'Addon development tools (create, build, test, publish)',
  commands: {
    'addon install': {
      description: 'Register a built addon with the local OpenAidy server',
      usage: 'openaidy addon install [--server-url <url>] [--token <token>]',
      examples: [
        'pnpm openaidy addon install',
        'pnpm openaidy addon install --server-url http://localhost:3001',
      ],
    },
    'addon create': {
      description: 'Create a new addon project from a template',
      usage: 'openaidy addon create <name> [--template <template>]',
      examples: [
        'pnpm openaidy addon create my-addon',
        'pnpm openaidy addon create my-addon --template agent',
      ],
    },
    'addon init': {
      description: 'Initialize an existing project as an addon',
      usage: 'openaidy addon init [--force]',
      examples: ['pnpm openaidy addon init'],
    },
    'addon build': {
      description: 'Build addon for production',
      usage: 'openaidy addon build [--watch] [--minify] [--sourcemap]',
      examples: [
        'pnpm openaidy addon build',
        'pnpm openaidy addon build --minify',
      ],
    },
    'addon test': {
      description: 'Run addon tests',
      usage: 'openaidy addon test [--watch] [--coverage]',
      examples: [
        'pnpm openaidy addon test',
        'pnpm openaidy addon test --coverage',
      ],
    },
    'addon validate': {
      description: 'Validate addon package and manifest',
      usage: 'openaidy addon validate [--verbose] [--strict]',
      examples: [
        'pnpm openaidy addon validate',
        'pnpm openaidy addon validate --verbose',
      ],
    },
    'addon dev': {
      description: 'Start development server with hot-reloading',
      usage: 'openaidy addon dev [--port <port>] [--openaidy-url <url>]',
      examples: [
        'pnpm openaidy addon dev',
        'pnpm openaidy addon dev --port 3001',
      ],
    },
    'addon publish': {
      description: 'Publish addon to the registry',
      usage: 'openaidy addon publish [--tag <tag>] [--registry <url>]',
      examples: [
        'pnpm openaidy addon publish',
        'pnpm openaidy addon publish --tag beta',
      ],
    },
    'addon templates': {
      description: 'List available addon templates',
      usage: 'openaidy addon templates',
      examples: ['pnpm openaidy addon templates'],
    },
  },
});

registerCommand(
  'addon install',
  async (args: string[]) => {
    const { installAddon } = await import('./addons/install.js');
    const options: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--server-url') options.serverUrl = args[++i];
      else if (args[i] === '--token') options.token = args[++i];
    }
    const result = await installAddon(process.cwd(), options);
    return result.success
      ? { exitCode: 0, output: `✓ ${result.message}` }
      : { exitCode: 1, error: `✗ ${result.message}` };
  },
  {
    description: 'Register a built addon with the local OpenAidy server',
    usage: 'openaidy addon install [--server-url <url>] [--token <token>]',
  },
);

registerCommand(
  'addon create',
  async (args: string[]) => {
    const { createAddon } = await import('./addons/create.js');
    const name = args[0];
    if (!name || name.startsWith('-')) {
      return {
        exitCode: 1,
        error:
          'Error: Addon name is required\nUsage: openaidy addon create <name>',
      };
    }
    const options: Record<string, string | boolean> = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '-d' || args[i] === '--directory')
        options.directory = args[++i];
      else if (args[i] === '-t' || args[i] === '--template')
        options.template = args[++i];
      else if (args[i] === '--no-git') options.noGit = true;
      else if (args[i] === '--no-install') options.noInstall = true;
    }
    const result = await createAddon(name, options);
    return result.success
      ? {
          exitCode: 0,
          output: `✓ ${result.message}${result.projectPath ? `\n  Project created at: ${result.projectPath}` : ''}`,
        }
      : { exitCode: 1, error: `✗ ${result.message}` };
  },
  {
    description: 'Create a new addon project from a template',
    usage: 'openaidy addon create <name> [--template <template>]',
  },
);

registerCommand(
  'addon init',
  async (args: string[]) => {
    const { initAddon } = await import('./addons/init.js');
    const options: Record<string, boolean> = {};
    if (args.includes('--force')) options.force = true;
    const result = await initAddon(process.cwd(), options);
    return result.success
      ? { exitCode: 0, output: `✓ ${result.message}` }
      : { exitCode: 1, error: `✗ ${result.message}` };
  },
  {
    description: 'Initialize an existing project as an addon',
    usage: 'openaidy addon init [--force]',
  },
);

registerCommand(
  'addon build',
  async (args: string[]) => {
    const { buildAddon } = await import('./addons/build.js');
    const options: Record<string, boolean> = {};
    for (const arg of args) {
      if (arg === '-w' || arg === '--watch') options.watch = true;
      else if (arg === '-m' || arg === '--minify') options.minify = true;
      else if (arg === '-s' || arg === '--sourcemap') options.sourcemap = true;
    }
    const result = await buildAddon(process.cwd(), options);
    return result.success
      ? {
          exitCode: 0,
          output: `✓ ${result.message}${result.outputPath ? `\n  Output: ${result.outputPath}` : ''}`,
        }
      : { exitCode: 1, error: `✗ ${result.message}` };
  },
  {
    description: 'Build addon for production',
    usage: 'openaidy addon build [--watch] [--minify] [--sourcemap]',
  },
);

registerCommand(
  'addon test',
  async (args: string[]) => {
    const { runTests } = await import('./addons/test.js');
    const options: Record<string, string | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--watch') options.watch = true;
      else if (args[i] === '--coverage') options.coverage = true;
      else if (args[i] === '--ui') options.ui = true;
      else if (args[i] === '--filter') options.filter = args[++i];
    }
    const result = await runTests(process.cwd(), options);
    return result.success
      ? {
          exitCode: 0,
          output: `✓ ${result.message}${result.testFiles !== undefined ? `\n  Test files: ${result.testFiles}` : ''}`,
        }
      : { exitCode: 1, error: `✗ ${result.message}` };
  },
  {
    description: 'Run addon tests',
    usage: 'openaidy addon test [--watch] [--coverage]',
  },
);

registerCommand(
  'addon validate',
  async (args: string[]) => {
    const { validateAddon } = await import('./addons/validate.js');
    const options: Record<string, boolean> = {};
    for (const arg of args) {
      if (arg === '-p' || arg === '--package') options.package = true;
      else if (arg === '-v' || arg === '--verbose') options.verbose = true;
      else if (arg === '--strict') options.strict = true;
    }
    const result = await validateAddon(process.cwd(), options);
    if (result.valid) {
      return { exitCode: 0, output: `✓ ${result.message}` };
    }
    const errors = result.errors.map((e: string) => `  - ${e}`).join('\n');
    const warnings = result.warnings.map((w: string) => `  - ${w}`).join('\n');
    return {
      exitCode: 1,
      error: `✗ ${result.message}${errors ? `\nErrors:\n${errors}` : ''}${warnings ? `\nWarnings:\n${warnings}` : ''}`,
    };
  },
  {
    description: 'Validate addon package and manifest',
    usage: 'openaidy addon validate [--verbose] [--strict]',
  },
);

registerCommand(
  'addon dev',
  async (args: string[]) => {
    const { startDevServer } = await import('./addons/dev.js');
    const options: Record<string, string | number> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--port') options.port = parseInt(args[++i], 10);
      else if (args[i] === '--host') options.host = args[++i];
      else if (args[i] === '--openaidy-url') options.openaidyUrl = args[++i];
    }
    const result = await startDevServer(process.cwd(), options);
    return result.success
      ? {
          exitCode: 0,
          output: `✓ ${result.message}\n  Server running at http://${result.host}:${result.port}\nPress Ctrl+C to stop`,
        }
      : { exitCode: 1, error: `✗ ${result.message}` };
  },
  {
    description: 'Start development server with hot-reloading',
    usage: 'openaidy addon dev [--port <port>]',
  },
);

registerCommand(
  'addon publish',
  async (args: string[]) => {
    const { publishAddon } = await import('./addons/publish.js');
    const options: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--registry') options.registry = args[++i];
      else if (args[i] === '--access') options.access = args[++i];
      else if (args[i] === '--tag') options.tag = args[++i];
    }
    const result = await publishAddon(process.cwd(), options);
    return result.success
      ? {
          exitCode: 0,
          output: `✓ ${result.message}${result.registryUrl ? `\n  Registry: ${result.registryUrl}` : ''}`,
        }
      : { exitCode: 1, error: `✗ ${result.message}` };
  },
  {
    description: 'Publish addon to the registry',
    usage: 'openaidy addon publish [--tag <tag>] [--registry <url>]',
  },
);

registerCommand(
  'addon templates',
  async (_args: string[]) => {
    const { listTemplates } = await import('../utils/template-generator.js');
    const templates = listTemplates();
    const output = templates
      .map(
        (t: { name: string; description: string }) =>
          `  ${t.name.padEnd(12)} ${t.description}`,
      )
      .join('\n');
    return { exitCode: 0, output: `\nAvailable Templates:\n\n${output}\n` };
  },
  {
    description: 'List available addon templates',
    usage: 'openaidy addon templates',
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
    // Import the handler dynamically to avoid circular dependencies
    const { devicesApproveHandler } = await import('./devices/approve.js');
    return devicesApproveHandler(args);
  },
  {
    description: 'Approve a pending device pairing request',
    usage: 'openaidy devices approve <request-id> [--scopes <scopes>]',
    examples: [
      'pnpm openaidy devices approve abc123',
      'pnpm openaidy devices approve abc123 --scopes chat,files',
    ],
  },
);

registerCommand(
  'devices deny',
  async (args: string[]) => {
    // Import the handler dynamically to avoid circular dependencies
    const { devicesDenyHandler } = await import('./devices/deny.js');
    return devicesDenyHandler(args);
  },
  {
    description: 'Deny a pending device pairing request',
    usage: 'openaidy devices deny <request-id>',
    examples: ['pnpm openaidy devices deny abc123'],
  },
);
