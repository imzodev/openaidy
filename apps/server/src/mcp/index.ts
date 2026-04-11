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
