/**
 * MCP Client Service
 *
 * Connects to MCP (Model Context Protocol) servers via stdio or HTTP transport,
 * discovers available tools, and executes tool calls.
 *
 * @see https://modelcontextprotocol.io
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { FastifyBaseLogger } from 'fastify';
import type { McpServerConfig } from '@openaidy/config';
import { EnvPlaceholderResolver } from './placeholder-resolver';
import {
  createProcessRunner,
  createPypiReleaseDateLookup,
  createUvxEnvironmentRepairer,
  type UvxEnvironmentRepairer,
} from './uvx-repair';

/**
 * How much of a child's stderr to keep for diagnosing a launch failure. A
 * Python traceback fits comfortably; anything longer is already in the log.
 */
const STDERR_TAIL_LIMIT = 8_192;

/**
 * Tool definition from an MCP server
 */
export type McpToolDefinition = {
  name: string;
  description: string | undefined;
  inputSchema: Record<string, unknown>;
};

/**
 * Content types in an MCP tool result
 */
export type McpTextContent = { type: 'text'; text: string };
export type McpImageContent = {
  type: 'image';
  data: string;
  mimeType?: string;
};
export type McpResourceContent = {
  type: 'resource';
  data: string;
  mimeType?: string;
};

/**
 * Tool call result from an MCP server
 */
export type McpToolResult = {
  content: Array<McpTextContent | McpImageContent | McpResourceContent>;
  isError?: boolean;
};

/**
 * Connection state for an MCP server
 */
type McpConnection = {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport | null;
  tools: McpToolDefinition[];
  config: McpServerConfig; // Store original config for reconnection
  manuallyDisconnected: boolean; // Track if disconnect was intentional
};

/**
 * Options for creating an MCP client service
 */
export type McpClientServiceOptions = {
  logger?: FastifyBaseLogger | undefined;
  /**
   * Resolves `${VAR}` placeholders in server `env`/`headers`. Injectable for
   * testing; defaults to reading from `process.env`.
   */
  resolver?: EnvPlaceholderResolver | undefined;
  /**
   * Rebuilds the environment of a `uvx` server that died at launch, so the
   * connection can be retried once. Injectable for testing; defaults to the
   * real `uv tool install --exclude-newer` repair. Pass `null` to disable
   * repair entirely.
   */
  uvxRepairer?: UvxEnvironmentRepairer | null | undefined;
};

/**
 * MCP Client Service
 *
 * Manages connections to MCP servers and provides tool discovery and execution.
 */
export class McpClientService {
  private connections = new Map<string, McpConnection>();
  private logger: FastifyBaseLogger | undefined;
  private resolver: EnvPlaceholderResolver;
  private repairUvxEnvironment: UvxEnvironmentRepairer | undefined;
  private shutdownHandlersRegistered = false;

  constructor(options?: McpClientServiceOptions) {
    this.logger = options?.logger;
    this.resolver = options?.resolver ?? new EnvPlaceholderResolver();
    this.repairUvxEnvironment =
      options?.uvxRepairer === null
        ? undefined
        : (options?.uvxRepairer ??
          createUvxEnvironmentRepairer({
            logger: options?.logger,
            run: createProcessRunner(),
            lookupReleaseDate: createPypiReleaseDateLookup(),
          }));
    this.registerShutdownHandlers();
  }

  /**
   * Register shutdown handlers for graceful termination
   * Ensures child processes are cleaned up when the parent process terminates
   */
  private registerShutdownHandlers(): void {
    if (this.shutdownHandlersRegistered) return;

    const handleShutdown = async () => {
      this.logger?.info('Received shutdown signal, disconnecting MCP servers');
      await this.disconnectAll();
      process.exit(0);
    };

    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

    this.shutdownHandlersRegistered = true;
  }

  /**
   * Names of `${VAR}` placeholders in this server's secret-bearing fields
   * (`env` for stdio, `headers` for http) that are not yet set in the
   * environment. Empty when the server is fully configured and ready to
   * connect. Lets callers skip a doomed connect — and its misleading
   * "connection failed" warning — for a server that is simply awaiting its
   * API key (e.g. a preinstalled GitHub server before a token is pasted in).
   */
  missingSecrets(serverConfig: McpServerConfig): string[] {
    const record =
      serverConfig.transport === 'http'
        ? serverConfig.headers
        : serverConfig.env;
    return this.resolver.findMissingVars(record);
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
   * Connect to a stdio-based MCP server
   *
   * The {@link StdioClientTransport} owns the spawned child process — it
   * resolves the right launcher on each platform (e.g. `npx.cmd` on Windows)
   * and terminates the child on `close()`. Spawning a second process here
   * previously produced misleading `MCP process error` logs and a redundant
   * process that was never wired to the protocol.
   */
  private async connectStdio(
    serverConfig: McpServerConfig,
    options: { allowRepair?: boolean } = {},
  ): Promise<void> {
    const { id, command, args, env } = serverConfig;
    const allowRepair = options.allowRepair ?? true;

    if (!command) {
      throw new Error(`stdio transport requires command for server ${id}`);
    }

    // Resolve ${VAR} placeholders from the environment before spawning; throws
    // MissingEnvVarsError listing any unset variables.
    const resolvedEnv = this.resolver.resolveRecord(
      env,
      `MCP server ${id} env`,
    );

    this.logger?.info(
      { serverId: id, command },
      'Connecting to MCP server via stdio',
    );

    // Create the stdio transport. `stderr: 'pipe'` yields a PassThrough
    // available immediately (before start()), so we can attach a listener
    // and never miss early stderr from the child. env is not logged to
    // avoid leaking sensitive values.
    const transport = new StdioClientTransport({
      command,
      args: args ?? [],
      ...(resolvedEnv ? { env: resolvedEnv } : {}),
      stderr: 'pipe',
    });

    // Surface the server's stderr for debugging. onData is buffered by the
    // PassThrough, so this is safe to attach post-construction. The tail is
    // also kept in memory: when a stdio server dies before the handshake, the
    // protocol error is a bare "Connection closed" and this text is the only
    // evidence of why.
    let stderrTail = '';
    const stderrStream = transport.stderr;
    stderrStream?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_TAIL_LIMIT);
      this.logger?.warn({ serverId: id, stderr: chunk }, 'MCP server stderr');
    });

    // Trigger reconnection when the child exits unexpectedly. The Client
    // preserves a transport.onclose set before connect(), so install it
    // here — it fires once the transport observes process 'close'.
    transport.onclose = () => {
      this.logger?.info({ serverId: id }, 'MCP process exited');
      this.attemptReconnection(id).catch((error) => {
        this.logger?.error(
          { serverId: id, error: error.message },
          'Reconnection failed',
        );
        this.cleanup(id);
      });
    };

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

    // Connect the client. This spawns the child via cross-spawn (which
    // handles Windows .cmd/.bat launchers), so failures surface here.
    //
    // A `uvx` server that dies at import time fails here with a bare
    // "Connection closed". That is usually a drifted dependency resolution
    // rather than a broken config, and it is repairable — see uvx-repair.ts.
    // One retry only, and only for a first attempt, so a genuinely broken
    // server cannot loop.
    try {
      await client.connect(transport);
    } catch (error) {
      if (!allowRepair || !this.repairUvxEnvironment) throw error;

      // The transport's child is already gone, but close() releases the
      // client's own listeners before a second attempt reuses the id.
      await client.close().catch(() => {});

      const repaired = await this.repairUvxEnvironment({
        serverId: id,
        command,
        args: args ?? [],
        stderr: stderrTail,
      });
      if (!repaired) throw error;

      return this.connectStdio(serverConfig, { allowRepair: false });
    }

    // Store the connection with config for reconnection
    this.connections.set(id, {
      client,
      transport,
      tools: [],
      config: serverConfig,
      manuallyDisconnected: false,
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

    // Resolve ${VAR} placeholders (e.g. `Bearer ${TOKEN}`) before connecting;
    // throws MissingEnvVarsError listing any unset variables. Done outside the
    // try below so the failure surfaces directly rather than as a generic
    // connection error.
    const resolvedHeaders = this.resolver.resolveRecord(
      headers,
      `MCP server ${id} headers`,
    );

    this.logger?.info(
      { serverId: id, url },
      'Connecting to MCP server via HTTP',
    );

    try {
      // Create Streamable HTTP transport with optional headers via requestInit
      const httpTransportOptions: { requestInit?: RequestInit } = {};
      if (resolvedHeaders && Object.keys(resolvedHeaders).length > 0) {
        httpTransportOptions.requestInit = {
          headers: resolvedHeaders,
        };
      }
      const transport = new StreamableHTTPClientTransport(
        new URL(url),
        httpTransportOptions,
      );

      // Create the MCP client
      const client = new Client(
        { name: `openaidy-${id}`, version: '1.0.0' },
        {
          capabilities: {},
        },
      );

      client.onerror = (error: Error) => {
        this.logger?.error(
          { serverId: id, error: error.message },
          'MCP client error',
        );
      };

      // Connect the client
      await client.connect(transport as Transport);

      // Store the connection (no child process for HTTP transport)
      this.connections.set(id, {
        client,
        transport: transport,
        tools: [],
        config: serverConfig,
        manuallyDisconnected: false,
      });

      // Discover tools
      await this.discoverTools(id);

      this.logger?.info({ serverId: id }, 'Connected to MCP server via HTTP');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger?.error(
        { serverId: id, url, error: errorMessage },
        'Failed to connect to MCP server via HTTP',
      );
      throw new Error(
        `Failed to connect to MCP server ${id} via HTTP: ${errorMessage}`,
      );
    }
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
      const response = await connection.client.listTools();

      const tools: McpToolDefinition[] = (response.tools || []).map((tool) => ({
        name: tool.name,
        description: tool.description ?? undefined,
        inputSchema: tool.inputSchema ?? {},
      }));

      connection.tools = tools;
      this.logger?.debug(
        { serverId, toolCount: tools.length },
        'Discovered MCP tools',
      );
    } catch (error) {
      this.logger?.warn(
        {
          serverId,
          error: error instanceof Error ? error.message : String(error),
        },
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
  getFilteredTools(
    serverId: string,
    toolNames?: string[],
  ): McpToolDefinition[] {
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
      const response = await connection.client.callTool({
        name: toolName,
        arguments: args,
      });

      return response as McpToolResult;
    } catch (error) {
      this.logger?.error(
        {
          serverId,
          toolName,
          error: error instanceof Error ? error.message : String(error),
        },
        'MCP tool call failed',
      );
      throw error;
    }
  }

  /**
   * Attempt to reconnect to an MCP server with exponential backoff
   *
   * @param serverId - Server to reconnect to
   * @param attempt - Current attempt number (starts at 1)
   */
  private async attemptReconnection(
    serverId: string,
    attempt: number = 1,
  ): Promise<void> {
    const connection = this.connections.get(serverId);

    // Don't reconnect if:
    // - No connection exists
    // - Connection was manually disconnected
    // - Connection is still active
    if (!connection || connection.manuallyDisconnected) {
      return;
    }

    const maxRetries = 3;
    const baseDelayMs = 1000; // 1 second base delay

    if (attempt > maxRetries) {
      this.logger?.warn(
        { serverId, attempts: attempt, maxRetries },
        'Max reconnection attempts reached, giving up',
      );
      throw new Error(
        `Failed to reconnect to MCP server ${serverId} after ${maxRetries} attempts`,
      );
    }

    // Exponential backoff: 1s, 2s, 4s
    const delayMs = baseDelayMs * Math.pow(2, attempt - 1);

    this.logger?.info(
      { serverId, attempt, maxRetries, delayMs },
      'Attempting to reconnect to MCP server',
    );

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      // Clean up old connection state
      this.connections.delete(serverId);

      // Attempt to reconnect using stored config
      await this.connect(connection.config);

      this.logger?.info(
        { serverId, attempt },
        'Successfully reconnected to MCP server',
      );
    } catch (error) {
      this.logger?.warn(
        {
          serverId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        },
        'Reconnection attempt failed, will retry',
      );

      // Recursively try again
      await this.attemptReconnection(serverId, attempt + 1);
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

    // Mark as manually disconnected to prevent reconnection attempts
    connection.manuallyDisconnected = true;

    try {
      // client.close() propagates to transport.close(), which terminates
      // the child process (SIGTERM → SIGKILL) when present.
      await connection.client.close();
    } catch (error) {
      this.logger?.warn(
        {
          serverId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error closing MCP client',
      );
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
