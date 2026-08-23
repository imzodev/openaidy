/**
 * MCP (Model Context Protocol) Module
 *
 * Provides client services for connecting to MCP servers and using their tools.
 */

export {
  McpClientService,
  createMcpClientService,
  type McpToolDefinition,
  type McpToolResult,
  type McpClientServiceOptions,
} from './client';

export {
  EnvPlaceholderResolver,
  MissingEnvVarsError,
  type EnvSource,
  type McpSecretsSource,
} from './placeholder-resolver';

export {
  MASKED_VALUE,
  redactSecrets,
  unmaskRecord,
  toMcpServerRecord,
  type McpRuntimeStatus,
} from './server-record';

export {
  normalizeMcpServerEntry,
  normalizeMcpServerMap,
  McpConfigImportError,
  type RawMcpServerEntry,
  type RawMcpServerMap,
} from './config-import';

export {
  SCREENSHOT_WORKSPACE_DIR,
  isScreenshotTool,
  stripScreenshotFilename,
  buildScreenshotFilename,
  persistScreenshotImages,
  type PersistScreenshotResult,
} from './screenshot-capture';
