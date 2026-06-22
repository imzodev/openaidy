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
        'pnpm openaidy tokens create --name "CI Pipeline" --scopes "sessions.list,sessions.stream"',
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
    usage: 'openaidy init',
    examples: [
      'WS_TOKEN_SECRET=$(openssl rand -hex 32) openaidy init',
      'openaidy init',
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
      'openaidy tokens create --name <name> --scopes <scopes> [--expires <date>]',
    examples: [
      'pnpm openaidy tokens create --name "CI Pipeline" --scopes "sessions.list,sessions.stream"',
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
// Server Lifecycle Commands (PR2)
// ============================================================================

registerCommand(
  'start',
  async (args: string[]) => {
    const { startHandler } = await import('./start.js');
    return startHandler(args);
  },
  {
    description: 'Start the OpenAidy server as a background process',
    usage: 'openaidy start',
    examples: ['openaidy start'],
  },
);

registerCommand(
  'stop',
  async (args: string[]) => {
    const { stopHandler } = await import('./stop.js');
    return stopHandler(args);
  },
  {
    description: 'Stop the OpenAidy server',
    usage: 'openaidy stop',
    examples: ['openaidy stop'],
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
    usage: 'openaidy status',
    examples: ['openaidy status'],
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
  async (args) => {
    const { addonInstallHandler } = await import('./addons/install.js');
    return addonInstallHandler(args);
  },
  {
    description: 'Register a built addon with the local OpenAidy server',
    usage:
      'openaidy addon install [<addon-name>] [--server-url <url>] [--token <token>]',
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
    usage: 'openaidy addon create <name> [--template <template>]',
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
    usage: 'openaidy addon validate [--verbose] [--strict]',
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
    usage: 'openaidy addon templates',
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
      usage: 'openaidy agents list',
      examples: ['pnpm openaidy agents list'],
    },
    'agents create': {
      description: 'Create a new agent with its own workspace',
      usage:
        'openaidy agents create [<name>] [--id <id>] [--description <desc>]',
      examples: [
        'pnpm openaidy agents create',
        'pnpm openaidy agents create "Research Assistant"',
      ],
    },
    'agents delete': {
      description: 'Delete an agent (requires typing the agent ID to confirm)',
      usage: 'openaidy agents delete [<id>]',
      examples: [
        'pnpm openaidy agents delete',
        'pnpm openaidy agents delete my-agent',
      ],
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
    usage: 'openaidy agents list',
    examples: ['pnpm openaidy agents list'],
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
    usage: 'openaidy agents create [<name>] [--id <id>] [--description <desc>]',
    examples: [
      'pnpm openaidy agents create',
      'pnpm openaidy agents create "Research Assistant"',
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
    usage: 'openaidy agents delete [<id>]',
    examples: [
      'pnpm openaidy agents delete',
      'pnpm openaidy agents delete my-agent',
    ],
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
      usage: 'openaidy tasks list [--status <status>] [--limit <n>]',
      examples: [
        'pnpm openaidy tasks list',
        'pnpm openaidy tasks list --status in_progress',
        'pnpm openaidy tasks list --limit 10',
      ],
    },
    'tasks get': {
      description: 'Get full details for a specific task',
      usage: 'openaidy tasks get <id>',
      examples: ['pnpm openaidy tasks get abc123'],
    },
    'tasks create': {
      description: 'Create a new task',
      usage:
        'openaidy tasks create [title] [--description <desc>] [--priority <p>] [--planning]',
      examples: [
        'pnpm openaidy tasks create "Fix login bug" --priority high',
        'pnpm openaidy tasks create --description "Implement the new API"',
      ],
    },
    'tasks update': {
      description: 'Update a task (title, description, priority, status)',
      usage:
        'openaidy tasks update <id> [--title <t>] [--description <d>] [--priority <p>] [--status <s>]',
      examples: [
        'pnpm openaidy tasks update abc123 --priority high',
        'pnpm openaidy tasks update abc123 --status done',
      ],
    },
    'tasks delete': {
      description: 'Delete a task permanently',
      usage: 'openaidy tasks delete <id>',
      examples: ['pnpm openaidy tasks delete abc123'],
    },
    'tasks kanban': {
      description: 'Display tasks grouped by status in Kanban board layout',
      usage: 'openaidy tasks kanban',
      examples: ['pnpm openaidy tasks kanban'],
    },
    'subtasks list': {
      description: 'List all subtasks for a specific task',
      usage: 'openaidy subtasks list <taskId>',
      examples: ['pnpm openaidy subtasks list abc123'],
    },
    'subtasks complete': {
      description: 'Mark a subtask as completed',
      usage: 'openaidy subtasks complete <subtaskId> [--result <result>]',
      examples: [
        'pnpm openaidy subtasks complete abc123',
        'pnpm openaidy subtasks complete abc123 --result "Done"',
      ],
    },
    'subtasks fail': {
      description: 'Mark a subtask as failed',
      usage: 'openaidy subtasks fail <subtaskId> [--reason <reason>]',
      examples: [
        'pnpm openaidy subtasks fail abc123',
        'pnpm openaidy subtasks fail abc123 --reason "Rate limited"',
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
    usage: 'openaidy tasks list [--status <status>] [--limit <n>]',
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
    usage: 'openaidy tasks get <id>',
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
      'openaidy tasks create [title] [--description <desc>] [--priority <p>] [--planning]',
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
      'openaidy tasks update <id> [--title <t>] [--description <d>] [--priority <p>] [--status <s>]',
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
    usage: 'openaidy tasks delete <id>',
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
    usage: 'openaidy tasks kanban',
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
    usage: 'openaidy subtasks list <taskId>',
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
    usage: 'openaidy subtasks complete <subtaskId> [--result <result>]',
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
    usage: 'openaidy subtasks fail <subtaskId> [--reason <reason>]',
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
      usage: 'openaidy sessions list [--limit <n>]',
      examples: [
        'pnpm openaidy sessions list',
        'pnpm openaidy sessions list --limit 20',
      ],
    },
    'sessions create': {
      description: 'Create a new session',
      usage: 'openaidy sessions create [title]',
      examples: [
        'pnpm openaidy sessions create',
        'pnpm openaidy sessions create "My Chat"',
      ],
    },
    'sessions get': {
      description: 'Get session details by ID',
      usage: 'openaidy sessions get <sessionId>',
      examples: ['pnpm openaidy sessions get sess_abc123'],
    },
    'sessions messages': {
      description: 'List all messages in a session',
      usage: 'openaidy sessions messages <sessionId>',
      examples: ['pnpm openaidy sessions messages sess_abc123'],
    },
    'sessions runs': {
      description: 'List all runs for a session',
      usage: 'openaidy sessions runs <sessionId>',
      examples: ['pnpm openaidy sessions runs sess_abc123'],
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
    usage: 'openaidy sessions list [--limit <n>]',
    examples: [
      'pnpm openaidy sessions list',
      'pnpm openaidy sessions list --limit 20',
    ],
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
    usage: 'openaidy sessions create [title]',
    examples: [
      'pnpm openaidy sessions create',
      'pnpm openaidy sessions create "My Chat"',
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
    usage: 'openaidy sessions get <sessionId>',
    examples: ['pnpm openaidy sessions get sess_abc123'],
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
    usage: 'openaidy sessions messages <sessionId>',
    examples: ['pnpm openaidy sessions messages sess_abc123'],
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
    usage: 'openaidy sessions runs <sessionId>',
    examples: ['pnpm openaidy sessions runs sess_abc123'],
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

// Provider commands
registerCommand(
  'providers list',
  async (args: string[]) => {
    const { providersListHandler } = await import('./providers/list.js');
    return providersListHandler(args);
  },
  {
    description: 'List all available providers',
    usage: 'openaidy providers list',
    examples: ['pnpm openaidy providers list'],
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
    usage: 'openaidy providers connect <provider-id> [--api-key <key>]',
    examples: ['pnpm openaidy providers connect openai --api-key sk-...'],
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
    usage: 'openaidy providers disconnect <provider-id>',
    examples: ['pnpm openaidy providers disconnect openai'],
  },
);
