/**
 * MCP Client Service
 *
 * Connects to MCP (Model Context Protocol) servers via stdio or HTTP transport,
 * discovers available tools, and executes tool calls.
 *
 * @see https://modelcontextprotocol.io
 */

import { spawn, ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { FastifyBaseLogger } from 'fastify';
import type { McpServerConfig } from '@openaidy/config';

/**
 * Tool definition from an MCP server
 */
export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Tool call result from an MCP server
 */
export type McpToolResult = {
  content: Array<{ type: string; text: string } | { type: string; data: string; mimeType?: string }>;
  isError?: boolean;
};

/**
 * Connection state for an MCP server
 */
type McpConnection = {
  client: Client;
  transport: StdioClientTransport | null;
  process: ChildProcess | null;
  tools: McpToolDefinition[];
};

/**
 * Options for creating an MCP client service
 */
export type McpClientServiceOptions = {
  logger?: FastifyBaseLogger;
};

/**
 * MCP Client Service
 *
 * Manages connections to MCP servers and provides tool discovery and execution.
 */
export class McpClientService {
  private connections = new Map<string, McpConnection>();
  private logger?: FastifyBaseLogger;

  constructor(options?: McpClientServiceOptions) {
    this.logger = options?.logger;
  }

  /**
   * Connect to an MCP server
   */
  async connect(serverConfig: McpServerConfig): Promise<void> {
    const { id, transport } = serverConfig;

    if (this.connections.has(id)) {
      this.logger?.warn({ serverId: id }, 'Already connected to MCP server');
      return;
    }

    if (transport === 'stdio') {
      await this.connectStdio(serverConfig);
    } else if (transport === 'http') {
      await this.connectHttp(serverConfig);
    } else {
      throw new Error(`Unsupported transport type: ${transport}`);
    }
  }

  /**
   * Validate environment variable placeholders in config
   * Checks for placeholders like ${VAR_NAME} and ensures they exist in process.env
   */
  private validateEnvPlaceholders(env: Record<string, string> | undefined, serverId: string): void {
    if (!env) return;

    const placeholderPattern = /\$\{([^}]+)\}/g;
    const missingVars: string[] = [];

    for (const [key, value] of Object.entries(env)) {
      const matches = value.match(placeholderPattern);
      if (matches) {
        for (const match of matches) {
          const varName = match.slice(2, -1); // Extract VAR_NAME from ${VAR_NAME}
          if (!process.env[varName]) {
            missingVars.push(`${key}: ${varName}`);
          }
        }
      }
    }

    if (missingVars.length > 0) {
      throw new Error(
        `MCP server ${serverId}: Missing required environment variables: ${missingVars.join(', ')}. ` +
        `Please set these environment variables before starting the server.`
      );
    }
  }

  /**
   * Connect to a stdio-based MCP server
   */
  private async connectStdio(serverConfig: McpServerConfig): Promise<void> {
    const { id, command, args, env } = serverConfig;

    if (!command) {
      throw new Error(`stdio transport requires command for server ${id}`);
    }

    // Validate environment variable placeholders before spawning
    this.validateEnvPlaceholders(env, id);

    this.logger?.info({ serverId: id, command }, 'Connecting to MCP server via stdio');

    // Spawn the MCP server process (note: env is not logged to prevent sensitive data exposure)
    const childProcess = spawn(command, args || [], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    childProcess.on('error', (error) => {
      this.logger?.error({ serverId: id, error: error.message }, 'MCP process error');
      this.cleanup(id);
    });

    childProcess.on('exit', (code, signal) => {
      this.logger?.info({ serverId: id, code, signal }, 'MCP process exited');
      this.cleanup(id);
    });

    // Create the stdio transport
    const transport = new StdioClientTransport({
      stdin: childProcess.stdin!,
      stdout: childProcess.stdout!,
    });

    // Create the MCP client
    const client = new Client(
      { name: `openaidy-${id}`, version: '1.0.0' },
      {
        capabilities: {},
      },
    );

    client.onerror = (error) => {
      this.logger?.error({ serverId: id, error }, 'MCP client error');
    };

    // Connect the client
    await client.connect(transport);

    // Store the connection
    this.connections.set(id, {
      client,
      transport,
      process: childProcess,
      tools: [],
    });

    // Discover tools
    await this.discoverTools(id);

    this.logger?.info({ serverId: id }, 'Connected to MCP server');
  }

  /**
   * Connect to an HTTP-based MCP server
   */
  private async connectHttp(serverConfig: McpServerConfig): Promise<void> {
    const { id, url, headers } = serverConfig;

    if (!url) {
      throw new Error(`http transport requires url for server ${id}`);
    }

    this.logger?.info({ serverId: id, url }, 'Connecting to MCP server via HTTP');

    // HTTP transport not fully implemented yet
    // This would use SSE (Server-Sent Events) for HTTP-based MCP servers
    throw new Error(`HTTP transport for MCP server ${id} is not yet implemented`);
  }

  /**
   * Discover available tools from an MCP server
   */
  private async discoverTools(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`Not connected to MCP server ${serverId}`);
    }

    try {
      const response = await connection.client.request(
        { method: 'tools/list' },
        {},
      );

      const tools: McpToolDefinition[] = (response.tools || []).map(
        (tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema || {},
        }),
      );

      connection.tools = tools;
      this.logger?.debug({ serverId, toolCount: tools.length }, 'Discovered MCP tools');
    } catch (error) {
      this.logger?.warn(
        { serverId, error: error instanceof Error ? error.message : String(error) },
        'Failed to discover tools from MCP server',
      );
      connection.tools = [];
    }
  }

  /**
   * Get all tools from an MCP server
   */
  getTools(serverId: string): McpToolDefinition[] {
    const connection = this.connections.get(serverId);
    return connection?.tools || [];
  }

  /**
   * Get filtered tools from an MCP server
   */
  getFilteredTools(serverId: string, toolNames?: string[]): McpToolDefinition[] {
    const allTools = this.getTools(serverId);
    if (!toolNames || toolNames.length === 0) {
      return allTools;
    }
    return allTools.filter((tool) => toolNames.includes(tool.name));
  }

  /**
   * Check if connected to an MCP server
   */
  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  /**
   * Get list of connected server IDs
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Execute a tool call on an MCP server
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    this.logger?.debug({ serverId, toolName }, 'Calling MCP tool');

    try {
      const response = await connection.client.request(
        { method: 'tools/call' },
        {
          name: toolName,
          arguments: args,
        },
      );

      return response as McpToolResult;
    } catch (error) {
      this.logger?.error(
        { serverId, toolName, error: error instanceof Error ? error.message : String(error) },
        'MCP tool call failed',
      );
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) {
      return;
    }

    this.logger?.info({ serverId }, 'Disconnecting from MCP server');

    try {
      await connection.client.close();
    } catch (error) {
      this.logger?.warn(
        { serverId, error: error instanceof Error ? error.message : String(error) },
        'Error closing MCP client',
      );
    }

    if (connection.process) {
      connection.process.kill();
    }

    this.connections.delete(serverId);
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.connections.keys());
    await Promise.all(serverIds.map((id) => this.disconnect(id)));
  }

  /**
   * Clean up connection state
   */
  private cleanup(serverId: string): void {
    const connection = this.connections.get(serverId);
    if (connection?.process) {
      try {
        connection.process.kill();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.connections.delete(serverId);
  }
}

/**
 * Create an MCP client service instance
 */
export function createMcpClientService(
  options?: McpClientServiceOptions,
): McpClientService {
  return new McpClientService(options);
}
