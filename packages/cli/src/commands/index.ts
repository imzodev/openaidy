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
      usage: 'aidy admin token show',
      examples: ['pnpm aidy admin token show'],
    },
    'admin token validate': {
      description: 'Validate the bootstrap-admin token',
      usage: 'aidy admin token validate',
      examples: ['pnpm aidy admin token validate'],
    },
    'admin token path': {
      description: 'Show the path to the bootstrap-admin token file',
      usage: 'aidy admin token path',
      examples: ['pnpm aidy admin token path'],
    },
  },
});

registerGroup({
  name: 'tokens',
  description: 'Manage access tokens for UI login and API access',
  commands: {
    'tokens list': {
      description: 'List all access tokens',
      usage: 'aidy tokens list',
      examples: ['pnpm aidy tokens list'],
    },
    'tokens create': {
      description: 'Create a new access token',
      usage: 'aidy tokens create --name <name> --scopes <scopes>',
      examples: [
        'pnpm aidy tokens create --name "CI Pipeline" --scopes "sessions.list,sessions.stream"',
        'pnpm aidy tokens create --name "Admin Key" --scopes "*"',
      ],
    },
    'tokens revoke': {
      description: 'Revoke an access token by ID',
      usage: 'aidy tokens revoke <id>',
      examples: ['pnpm aidy tokens revoke abc123'],
    },
  },
});

registerGroup({
  name: 'devices',
  description: 'Device pairing and management commands',
  commands: {
    'devices list': {
      description: 'List pending device pairing requests',
      usage: 'aidy devices list',
      examples: ['pnpm aidy devices list'],
    },
    'devices approve': {
      description: 'Approve a pending device pairing request',
      usage: 'aidy devices approve <request-id>',
      examples: ['pnpm aidy devices approve abc123'],
    },
    'devices deny': {
      description: 'Deny a pending device pairing request',
      usage: 'aidy devices deny <request-id>',
      examples: ['pnpm aidy devices deny abc123'],
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
Usage: aidy admin token show

Show the current bootstrap-admin token information.

This command displays:
  - Token status (valid, expired, missing, malformed, invalid, disabled)
  - Token file path
  - Token value (only for valid/expired tokens)
  - Metadata (client ID, created, expires, scopes)

Examples:
  pnpm aidy admin token show

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
    usage: 'aidy admin token show',
    examples: ['pnpm aidy admin token show'],
  },
);

registerCommand(
  'admin token validate',
  async (args: string[]) => {
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: aidy admin token validate

Validate the bootstrap-admin token.

This command checks:
  - Token file exists
  - Token is valid JSON
  - Token signature is valid
  - Token is not expired

Examples:
  pnpm aidy admin token validate

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
    usage: 'aidy admin token validate',
  },
);

registerCommand(
  'admin token path',
  async (args: string[]) => {
    if (args.includes('-h') || args.includes('--help')) {
      return {
        exitCode: 0,
        output: `
Usage: aidy admin token path

Show the path to the bootstrap-admin token file.

Examples:
  pnpm aidy admin token path
`,
      };
    }
    const { resolveCLIConfig } = await import('../lib/config.js');
    return { exitCode: 0, output: resolveCLIConfig().tokenPath };
  },
  {
    description: 'Show the path to the bootstrap-admin token file',
    usage: 'aidy admin token path',
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
    usage: 'aidy tokens list',
    examples: ['pnpm aidy tokens list'],
  },
);

// ============================================================================
// Init Command (PR1)
// ============================================================================

registerCommand(
  'init',
  async (args: string[]) => {
    const { initHandler } = await import('./init.js');
    return initHandler(args);
  },
  {
    description: 'Generate or refresh the bootstrap-admin token',
    usage: 'aidy init',
    examples: [
      'WS_TOKEN_SECRET=$(openssl rand -hex 32) aidy init',
      'aidy init',
    ],
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
      'aidy tokens create --name <name> --scopes <scopes> [--expires <date>]',
    examples: [
      'pnpm aidy tokens create --name "CI Pipeline" --scopes "sessions.list,sessions.stream"',
      'pnpm aidy tokens create --name "Admin Key" --scopes "*"',
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
    usage: 'aidy tokens revoke <id>',
    examples: ['pnpm aidy tokens revoke abc123'],
  },
);

// ============================================================================
// Server Lifecycle Commands (PR2)
// ============================================================================

registerCommand(
  'start',
  async (args: string[]) => {
    const { startHandler } = await import('./start.js');
    return startHandler(args);
  },
  {
    description: 'Start the Aidy server as a background process',
    usage: 'aidy start [--port <N>] [--foreground]',
    examples: ['aidy start', 'aidy start --foreground'],
  },
);

registerCommand(
  'stop',
  async (args: string[]) => {
    const { stopHandler } = await import('./stop.js');
    return stopHandler(args);
  },
  {
    description: 'Stop the Aidy server',
    usage: 'aidy stop',
    examples: ['aidy stop'],
  },
);

registerCommand(
  'restart',
  async (args: string[]) => {
    const { restartHandler } = await import('./restart.js');
    return restartHandler(args);
  },
  {
    description: 'Restart the Aidy server (stop + start, port preserved)',
    usage: 'aidy restart [--port <N>] [--server-only] [--integrated]',
    examples: [
      'aidy restart',
      'aidy restart --port 3001',
      'aidy restart --integrated',
    ],
  },
);

registerCommand(
  'status',
  async (args: string[]) => {
    const { statusHandler } = await import('./status.js');
    return statusHandler(args);
  },
  {
    description: 'Show the current server status',
    usage: 'aidy status',
    examples: ['aidy status'],
  },
);

// ============================================================================
// Service Command Group (systemd supervision)
// ============================================================================

registerGroup({
  name: 'service',
  description: 'Run Aidy under systemd so it restarts automatically',
  commands: {
    'service install': {
      description:
        'Install + start the systemd service (auto-restart, starts at boot)',
      usage: 'aidy service install [--port <N>]',
      examples: ['aidy service install'],
    },
    'service uninstall': {
      description: 'Stop and remove the systemd service',
      usage: 'aidy service uninstall',
      examples: ['aidy service uninstall'],
    },
    'service status': {
      description: 'Show the systemd service status',
      usage: 'aidy service status',
      examples: ['aidy service status'],
    },
  },
});

registerCommand(
  'service install',
  async (args: string[]) => {
    const { serviceInstallHandler } = await import('./service.js');
    return serviceInstallHandler(args);
  },
  {
    description:
      'Install + start the systemd service (auto-restart, starts at boot)',
    usage: 'aidy service install [--port <N>]',
    examples: ['aidy service install'],
  },
);

registerCommand(
  'service uninstall',
  async (args: string[]) => {
    const { serviceUninstallHandler } = await import('./service.js');
    return serviceUninstallHandler(args);
  },
  {
    description: 'Stop and remove the systemd service',
    usage: 'aidy service uninstall',
    examples: ['aidy service uninstall'],
  },
);

registerCommand(
  'service status',
  async (args: string[]) => {
    const { serviceStatusHandler } = await import('./service.js');
    return serviceStatusHandler(args);
  },
  {
    description: 'Show the systemd service status',
    usage: 'aidy service status',
    examples: ['aidy service status'],
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
      description: 'Register a built addon with the local Aidy server',
      usage: 'aidy addon install [--server-url <url>] [--token <token>]',
      examples: [
        'pnpm aidy addon install',
        'pnpm aidy addon install --server-url http://localhost:3001',
      ],
    },
    'addon create': {
      description: 'Create a new addon project from a template',
      usage: 'aidy addon create <name> [--template <template>]',
      examples: [
        'pnpm aidy addon create my-addon',
        'pnpm aidy addon create my-addon --template agent',
      ],
    },
    'addon init': {
      description: 'Initialize an existing project as an addon',
      usage: 'aidy addon init [--force]',
      examples: ['pnpm aidy addon init'],
    },
    'addon build': {
      description: 'Build addon for production',
      usage: 'aidy addon build [--watch] [--minify] [--sourcemap]',
      examples: ['pnpm aidy addon build', 'pnpm aidy addon build --minify'],
    },
    'addon validate': {
      description: 'Validate addon package and manifest',
      usage: 'aidy addon validate [--verbose] [--strict]',
      examples: [
        'pnpm aidy addon validate',
        'pnpm aidy addon validate --verbose',
      ],
    },
    'addon dev': {
      description: 'Start development server with hot-reloading',
      usage: 'aidy addon dev [--port <port>] [--aidy-url <url>]',
      examples: ['pnpm aidy addon dev', 'pnpm aidy addon dev --port 3001'],
    },
    'addon publish': {
      description: 'Publish addon to the registry',
      usage: 'aidy addon publish [--tag <tag>] [--registry <url>]',
      examples: [
        'pnpm aidy addon publish',
        'pnpm aidy addon publish --tag beta',
      ],
    },
    'addon templates': {
      description: 'List available addon templates',
      usage: 'aidy addon templates',
      examples: ['pnpm aidy addon templates'],
    },
  },
});

registerCommand(
  'addon install',
  async (args) => {
    const { addonInstallHandler } = await import('./addons/install.js');
    return addonInstallHandler(args);
  },
  {
    description: 'Register a built addon with the local Aidy server',
    usage:
      'aidy addon install [<addon-name>] [--server-url <url>] [--token <token>]',
  },
);

registerCommand(
  'addon create',
  async (args) => {
    const { addonCreateHandler } = await import('./addons/create.js');
    return addonCreateHandler(args);
  },
  {
    description: 'Create a new addon project from a template',
    usage: 'aidy addon create <name> [--template <template>]',
  },
);

registerCommand(
  'addon validate',
  async (args) => {
    const { addonValidateHandler } = await import('./addons/validate.js');
    return addonValidateHandler(args);
  },
  {
    description: 'Validate addon package and manifest',
    usage: 'aidy addon validate [--verbose] [--strict]',
  },
);

registerCommand(
  'addon templates',
  async (args) => {
    const { addonTemplatesHandler } = await import('./addons/templates.js');
    return addonTemplatesHandler(args);
  },
  {
    description: 'List available addon templates',
    usage: 'aidy addon templates',
  },
);

// ============================================================================
// Agents Commands
// ============================================================================

registerGroup({
  name: 'agents',
  description: 'Manage agents and their workspaces',
  commands: {
    'agents list': {
      description: 'List all configured agents',
      usage: 'aidy agents list',
      examples: ['pnpm aidy agents list'],
    },
    'agents create': {
      description: 'Create a new agent with its own workspace',
      usage: 'aidy agents create [<name>] [--id <id>] [--description <desc>]',
      examples: [
        'pnpm aidy agents create',
        'pnpm aidy agents create "Research Assistant"',
      ],
    },
    'agents delete': {
      description: 'Delete an agent (requires typing the agent ID to confirm)',
      usage: 'aidy agents delete [<id>]',
      examples: ['pnpm aidy agents delete', 'pnpm aidy agents delete my-agent'],
    },
  },
});

registerCommand(
  'agents list',
  async (args: string[]) => {
    const { agentsListHandler } = await import('./agents/list.js');
    return agentsListHandler(args);
  },
  {
    description: 'List all configured agents',
    usage: 'aidy agents list',
    examples: ['pnpm aidy agents list'],
  },
);

registerCommand(
  'agents create',
  async (args: string[]) => {
    const { agentsCreateHandler } = await import('./agents/create.js');
    return agentsCreateHandler(args);
  },
  {
    description: 'Create a new agent with its own workspace',
    usage: 'aidy agents create [<name>] [--id <id>] [--description <desc>]',
    examples: [
      'pnpm aidy agents create',
      'pnpm aidy agents create "Research Assistant"',
    ],
  },
);

registerCommand(
  'agents delete',
  async (args: string[]) => {
    const { agentsDeleteHandler } = await import('./agents/delete.js');
    return agentsDeleteHandler(args);
  },
  {
    description: 'Delete an agent (requires typing the agent ID to confirm)',
    usage: 'aidy agents delete [<id>]',
    examples: ['pnpm aidy agents delete', 'pnpm aidy agents delete my-agent'],
  },
);

// ============================================================================
// Tasks Command Group
// ============================================================================

registerGroup({
  name: 'tasks',
  description: 'Manage tasks and subtasks via the CLI',
  commands: {
    'tasks list': {
      description: 'List all tasks, optionally filtered by status',
      usage: 'aidy tasks list [--status <status>] [--limit <n>]',
      examples: [
        'pnpm aidy tasks list',
        'pnpm aidy tasks list --status in_progress',
        'pnpm aidy tasks list --limit 10',
      ],
    },
    'tasks get': {
      description: 'Get full details for a specific task',
      usage: 'aidy tasks get <id>',
      examples: ['pnpm aidy tasks get abc123'],
    },
    'tasks create': {
      description: 'Create a new task',
      usage:
        'aidy tasks create [title] [--description <desc>] [--priority <p>] [--planning]',
      examples: [
        'pnpm aidy tasks create "Fix login bug" --priority high',
        'pnpm aidy tasks create --description "Implement the new API"',
      ],
    },
    'tasks update': {
      description: 'Update a task (title, description, priority, status)',
      usage:
        'aidy tasks update <id> [--title <t>] [--description <d>] [--priority <p>] [--status <s>]',
      examples: [
        'pnpm aidy tasks update abc123 --priority high',
        'pnpm aidy tasks update abc123 --status done',
      ],
    },
    'tasks delete': {
      description: 'Delete a task permanently',
      usage: 'aidy tasks delete <id>',
      examples: ['pnpm aidy tasks delete abc123'],
    },
    'tasks kanban': {
      description: 'Display tasks grouped by status in Kanban board layout',
      usage: 'aidy tasks kanban',
      examples: ['pnpm aidy tasks kanban'],
    },
    'subtasks list': {
      description: 'List all subtasks for a specific task',
      usage: 'aidy subtasks list <taskId>',
      examples: ['pnpm aidy subtasks list abc123'],
    },
    'subtasks complete': {
      description: 'Mark a subtask as completed',
      usage: 'aidy subtasks complete <subtaskId> [--result <result>]',
      examples: [
        'pnpm aidy subtasks complete abc123',
        'pnpm aidy subtasks complete abc123 --result "Done"',
      ],
    },
    'subtasks fail': {
      description: 'Mark a subtask as failed',
      usage: 'aidy subtasks fail <subtaskId> [--reason <reason>]',
      examples: [
        'pnpm aidy subtasks fail abc123',
        'pnpm aidy subtasks fail abc123 --reason "Rate limited"',
      ],
    },
  },
});

// Tasks list
registerCommand(
  'tasks list',
  async (args: string[]) => {
    const { tasksListHandler } = await import('./tasks/list.js');
    return tasksListHandler(args);
  },
  {
    description: 'List all tasks, optionally filtered by status',
    usage: 'aidy tasks list [--status <status>] [--limit <n>]',
  },
);

// Tasks get
registerCommand(
  'tasks get',
  async (args: string[]) => {
    const { tasksGetHandler } = await import('./tasks/get.js');
    return tasksGetHandler(args);
  },
  {
    description: 'Get full details for a specific task',
    usage: 'aidy tasks get <id>',
  },
);

// Tasks create
registerCommand(
  'tasks create',
  async (args: string[]) => {
    const { tasksCreateHandler } = await import('./tasks/create.js');
    return tasksCreateHandler(args);
  },
  {
    description: 'Create a new task',
    usage:
      'aidy tasks create [title] [--description <desc>] [--priority <p>] [--planning]',
  },
);

// Tasks update
registerCommand(
  'tasks update',
  async (args: string[]) => {
    const { tasksUpdateHandler } = await import('./tasks/update.js');
    return tasksUpdateHandler(args);
  },
  {
    description: 'Update a task (title, description, priority, status)',
    usage:
      'aidy tasks update <id> [--title <t>] [--description <d>] [--priority <p>] [--status <s>]',
  },
);

// Tasks delete
registerCommand(
  'tasks delete',
  async (args: string[]) => {
    const { tasksDeleteHandler } = await import('./tasks/delete.js');
    return tasksDeleteHandler(args);
  },
  {
    description: 'Delete a task permanently',
    usage: 'aidy tasks delete <id>',
  },
);

// Tasks kanban
registerCommand(
  'tasks kanban',
  async (args: string[]) => {
    const { tasksKanbanHandler } = await import('./tasks/kanban.js');
    return tasksKanbanHandler(args);
  },
  {
    description: 'Display tasks grouped by status in Kanban board layout',
    usage: 'aidy tasks kanban',
  },
);

// Subtasks list
registerCommand(
  'subtasks list',
  async (args: string[]) => {
    const { subtasksListHandler } = await import('./tasks/subtasks/list.js');
    return subtasksListHandler(args);
  },
  {
    description: 'List all subtasks for a specific task',
    usage: 'aidy subtasks list <taskId>',
  },
);

// Subtasks complete
registerCommand(
  'subtasks complete',
  async (args: string[]) => {
    const { subtasksCompleteHandler } =
      await import('./tasks/subtasks/complete.js');
    return subtasksCompleteHandler(args);
  },
  {
    description: 'Mark a subtask as completed',
    usage: 'aidy subtasks complete <subtaskId> [--result <result>]',
  },
);

// Subtasks fail
registerCommand(
  'subtasks fail',
  async (args: string[]) => {
    const { subtasksFailHandler } = await import('./tasks/subtasks/fail.js');
    return subtasksFailHandler(args);
  },
  {
    description: 'Mark a subtask as failed',
    usage: 'aidy subtasks fail <subtaskId> [--reason <reason>]',
  },
);

// ============================================================================
// Sessions Command Group
// ============================================================================

registerGroup({
  name: 'sessions',
  description: 'Manage chat sessions',
  commands: {
    'sessions list': {
      description: 'List all sessions',
      usage: 'aidy sessions list [--limit <n>]',
      examples: [
        'pnpm aidy sessions list',
        'pnpm aidy sessions list --limit 20',
      ],
    },
    'sessions create': {
      description: 'Create a new session',
      usage: 'aidy sessions create [title]',
      examples: [
        'pnpm aidy sessions create',
        'pnpm aidy sessions create "My Chat"',
      ],
    },
    'sessions get': {
      description: 'Get session details by ID',
      usage: 'aidy sessions get <sessionId>',
      examples: ['pnpm aidy sessions get sess_abc123'],
    },
    'sessions messages': {
      description: 'List all messages in a session',
      usage: 'aidy sessions messages <sessionId>',
      examples: ['pnpm aidy sessions messages sess_abc123'],
    },
    'sessions runs': {
      description: 'List all runs for a session',
      usage: 'aidy sessions runs <sessionId>',
      examples: ['pnpm aidy sessions runs sess_abc123'],
    },
  },
});

registerCommand(
  'sessions list',
  async (args: string[]) => {
    const { sessionsListHandler } = await import('./sessions/list.js');
    return sessionsListHandler(args);
  },
  {
    description: 'List all sessions',
    usage: 'aidy sessions list [--limit <n>]',
    examples: ['pnpm aidy sessions list', 'pnpm aidy sessions list --limit 20'],
  },
);

registerCommand(
  'sessions create',
  async (args: string[]) => {
    const { sessionsCreateHandler } = await import('./sessions/create.js');
    return sessionsCreateHandler(args);
  },
  {
    description: 'Create a new session',
    usage: 'aidy sessions create [title]',
    examples: [
      'pnpm aidy sessions create',
      'pnpm aidy sessions create "My Chat"',
    ],
  },
);

registerCommand(
  'sessions get',
  async (args: string[]) => {
    const { sessionsGetHandler } = await import('./sessions/get.js');
    return sessionsGetHandler(args);
  },
  {
    description: 'Get session details by ID',
    usage: 'aidy sessions get <sessionId>',
    examples: ['pnpm aidy sessions get sess_abc123'],
  },
);

registerCommand(
  'sessions messages',
  async (args: string[]) => {
    const { sessionsMessagesHandler } = await import('./sessions/messages.js');
    return sessionsMessagesHandler(args);
  },
  {
    description: 'List all messages in a session',
    usage: 'aidy sessions messages <sessionId>',
    examples: ['pnpm aidy sessions messages sess_abc123'],
  },
);

registerCommand(
  'sessions runs',
  async (args: string[]) => {
    const { sessionsRunsHandler } = await import('./sessions/runs.js');
    return sessionsRunsHandler(args);
  },
  {
    description: 'List all runs for a session',
    usage: 'aidy sessions runs <sessionId>',
    examples: ['pnpm aidy sessions runs sess_abc123'],
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
    usage: 'aidy devices list [--status <status>] [--limit <n>]',
    examples: [
      'pnpm aidy devices list',
      'pnpm aidy devices list --status all',
      'pnpm aidy devices list --status approved --limit 10',
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
    usage: 'aidy devices approve <request-id> [--scopes <scopes>]',
    examples: [
      'pnpm aidy devices approve abc123',
      'pnpm aidy devices approve abc123 --scopes chat,files',
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
    usage: 'aidy devices deny <request-id>',
    examples: ['pnpm aidy devices deny abc123'],
  },
);

// Provider commands
registerCommand(
  'providers list',
  async (args: string[]) => {
    const { providersListHandler } = await import('./providers/list.js');
    return providersListHandler(args);
  },
  {
    description: 'List all available providers',
    usage: 'aidy providers list',
    examples: ['pnpm aidy providers list'],
  },
);

registerCommand(
  'providers connect',
  async (args: string[]) => {
    const { providersConnectHandler } = await import('./providers/connect.js');
    return providersConnectHandler(args);
  },
  {
    description: 'Connect to a provider',
    usage: 'aidy providers connect <provider-id> [--api-key <key>]',
    examples: ['pnpm aidy providers connect openai --api-key sk-...'],
  },
);

registerCommand(
  'providers disconnect',
  async (args: string[]) => {
    const { providersDisconnectHandler } =
      await import('./providers/disconnect.js');
    return providersDisconnectHandler(args);
  },
  {
    description: 'Disconnect from a provider',
    usage: 'aidy providers disconnect <provider-id>',
    examples: ['pnpm aidy providers disconnect openai'],
  },
);

// MCP commands
registerGroup({
  name: 'mcp',
  description: 'Manage Model Context Protocol servers',
  commands: {
    'mcp import': {
      description: 'Import MCP servers from a standard config file or stdin',
      usage: 'aidy mcp import [file]',
      examples: [
        'aidy mcp import ./mcp.json',
        'cat ~/.config/mcp.json | aidy mcp import',
      ],
    },
  },
});

registerCommand(
  'mcp import',
  async (args: string[]) => {
    const { mcpImportHandler } = await import('./mcp/import.js');
    return mcpImportHandler(args);
  },
  {
    description: 'Import MCP servers from a standard config file or stdin',
    usage: 'aidy mcp import [file]',
    examples: ['aidy mcp import ./mcp.json'],
  },
);

registerCommand(
  'mcp migrate-secrets',
  async (args: string[]) => {
    const { mcpMigrateSecretsHandler } =
      await import('./mcp/migrate-secrets.js');
    return mcpMigrateSecretsHandler(args);
  },
  {
    description: 'Encrypt plaintext MCP inline secrets at rest (issue #401)',
    usage: 'aidy mcp migrate-secrets [--dry-run]',
    examples: [
      'aidy mcp migrate-secrets --dry-run',
      'aidy mcp migrate-secrets',
    ],
  },
);
