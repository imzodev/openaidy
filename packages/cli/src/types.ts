/**
 * CLI Types
 *
 * Shared type definitions for the OpenAidy CLI.
 */

/**
 * Output format mode
 */
export type OutputMode = 'text' | 'json';

/**
 * Result returned by command handlers
 */
export type CommandResult = {
  exitCode: number;
  output?: string;
  error?: string;
  /** Future: JSON-serializable data for --json mode */
  data?: unknown;
  /** Output format mode */
  mode?: OutputMode;
};

/**
 * Handler function type for CLI commands
 */
export type CommandHandler = (args: string[]) => Promise<CommandResult>;

/**
 * Command registration map
 */
export type CommandRegistry = Record<string, CommandHandler>;

/**
 * Command metadata for help output
 */
export type CommandMeta = {
  description: string;
  usage?: string;
  examples?: string[];
};

/**
 * Command group metadata
 */
export type CommandGroup = {
  name: string;
  description: string;
  commands: Record<string, CommandMeta>;
};

/**
 * CLI configuration
 */
export type CLIConfig = {
  name: string;
  version: string;
  description: string;
};

/**
 * Exit codes used by the CLI
 */
export const ExitCodes = {
  SUCCESS: 0,
  ERROR: 1,
  INVALID_ARGS: 2,
  NOT_FOUND: 3,
  PERMISSION_DENIED: 4,
  CONFIG_ERROR: 5,
} as const;

/**
 * Default CLI configuration
 */
export const defaultCLIConfig: CLIConfig = {
  name: 'openaidy',
  version: '0.0.1',
  description: 'OpenAidy CLI - Local administration tool',
};

// ============================================================================
// Agent / Config types
// These mirror the openaidy.json file format read/written by the CLI.
// ============================================================================

export type WorkspacePermissions = {
  read: boolean;
  write: boolean;
  delete: boolean;
  list: boolean;
};

export type AgentConfig = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  systemPrompt?: string;
  model?: string;
  tags?: string[];
  skills?: string[];
  workspace?: {
    enabled: boolean;
    defaultPermissions: WorkspacePermissions;
    workspaces: Array<{ path: string; permissions: WorkspacePermissions }>;
  };
  version?: number;
};

export type OpenAidyConfig = {
  agents?: AgentConfig[];
};

export type SkillSummary = {
  id: string;
  name: string;
};

/**
 * Parse options for common CLI flags
 */
export interface ParseOptions {
  json?: boolean;
  help?: boolean;
}

/**
 * Base options for all command handlers
 */
export interface CommandOptions {
  /** Output format mode */
  outputMode?: OutputMode;
  /** Show help flag */
  help: boolean;
}
