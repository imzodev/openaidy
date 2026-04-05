# MCP Server Integration Implementation Plan

## Overview

Integrate [@modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) to allow agents to use MCP server tools. This enables agents to connect to external MCP servers (filesystem, GitHub, etc.) and use their tools during LLM invocations.

## Current Architecture Analysis

### Existing Components

| Component                                                  | Status             | Description                             |
| ---------------------------------------------------------- | ------------------ | --------------------------------------- |
| [`AgentSchema`](apps/server/src/agents/schema.ts:9)        | ⚠️ Needs extension | Has `tools: string[]` - just tool names |
| [`McpService`](apps/server/src/mcp/service.ts:1)           | ❌ Stub            | Just returns empty array                |
| [`ToolDefinition`](packages/runtime/src/tools/index.ts:19) | ✅ Ready           | Provider tool format                    |
| Provider adapters                                          | ✅ Support tools   | Anthropic, OpenAI, Gemini all support   |

### Gap Analysis

```mermaid
flowchart LR
    subgraph Current
        A[Agent JSON] -->|tools: string[]| B[AgentRegistry]
        B -->|no tools| C[Provider]
        C --> D[LLM Response]
    end

    subgraph With MCP
        A2[Agent JSON] -->|mcpServers: string[]| B2[AgentRegistry]
        B2 --> C2[McpClientService]
        C2 -->|connect| E[MCP Server stdio/HTTP]
        E -->|list_tools| F[Tool[]]
        F --> G[Tool Registry]
        G --> H[Provider]
        H --> I[LLM + Tools]
    end
```

---

## Step 1: Extend Agent Schema with MCP Server References

### What

Add `mcpServers` field to AgentSchema to link agents to configured MCP servers.

### File to Modify

- [`apps/server/src/agents/schema.ts`](apps/server/src/agents/schema.ts)

### Code Changes

```typescript
// Add MCP server reference type
export const McpServerRefSchema = z.object({
  id: z.string().min(1), // MCP server ID from config
  tools: z.array(z.string()).optional(), // Specific tools (empty = all)
});

// Extend AgentSchema
export const AgentSchema = z.object({
  // ... existing fields (lines 9-28)

  // Replace tools field with mcpServers
  mcpServers: z.array(McpServerRefSchema).optional(),

  // Keep tools for legacy/custom tools
  tools: z.array(z.string()).optional(),
});

// Update Agent type
export type Agent = z.infer<typeof AgentSchema>;

// Update AgentSummary
export type AgentSummary = {
  // ... existing fields
  mcpServers?: Array<{ id: string; tools?: string[] }>;
};
```

### Reuse

- Use existing Zod schemas from [`zod`](packages/config/src/app-config.ts)
- Use existing validation patterns from [`AgentSchema`](apps/server/src/agents/schema.ts:69)

### Tests

```typescript
// agents/schema.test.ts - Add tests for MCP extension
describe('MCP server references', () => {
  it('should parse agent with mcpServers', () => {
    const agent = parseAgent(
      {
        id: 'test',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o-mini',
        mcpServers: [{ id: 'filesystem', tools: ['read_file', 'write_file'] }],
      },
      'test.json',
    );
    expect(agent.mcpServers).toEqual([
      { id: 'filesystem', tools: ['read_file', 'write_file'] },
    ]);
  });

  it('should allow empty tools array for all tools', () => {
    const agent = parseAgent(
      {
        id: 'test',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o-mini',
        mcpServers: [{ id: 'github' }], // No tools specified = all
      },
      'test.json',
    );
    expect(agent.mcpServers?.[0].tools).toBeUndefined();
  });
});
```

---

## Step 2: Create MCP Server Config Schema

### What

Add MCP server configuration to the app config template.

### File to Modify

- [`config/openaidy.template.json`](config/openaidy.template.json)

### Code Changes

```json
{
  "version": 1,
  "mcpServers": [
    {
      "id": "filesystem",
      "name": "Filesystem Tools",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {}
    },
    {
      "id": "github",
      "name": "GitHub Tools",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    {
      "id": "http-api",
      "name": "HTTP API Server",
      "transport": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_API_KEY}"
      }
    }
  ],
  "defaults": { ... },
  "providers": [ ... ],
  "agents": [ ... ]
}
```

### Add Config Schema

- Modify [`packages/config/src/app-config.ts`](packages/config/src/app-config.ts)

```typescript
// Add MCP server config schema
export const McpServerTransportSchema = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string()).optional(),
  }),
  z.object({
    transport: z.literal('http'),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
]);

export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  transport: z.string(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export const AppConfigSchema = z.object({
  version: z.number(),
  mcpServers: z.array(McpServerConfigSchema).optional(),
  defaults: AppDefaultsSchema.optional(),
  providers: z.array(AppProviderConfigSchema),
  agents: z.array(AppAgentConfigSchema),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type OpenAidyConfig = z.infer<typeof AppConfigSchema>;
```

---

## Step 3: Create MCP Client Service

### What

Build a service that connects to MCP servers, discovers tools, and executes tool calls.

### New File

- [`apps/server/src/mcp/client.ts`](apps/server/src/mcp/client.ts)

### Implementation

```typescript
import { Client } from '@modelcontextprotocol/typescript-sdk';
import { spawn, ChildProcess } from 'child_process';
import { get } from 'http'; // For HTTP transport
import type { ToolDefinition } from '@openaidy/runtime';

export type McpServerTransport =
  | {
      type: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | { type: 'http'; url: string; headers?: Record<string, string> };

export class McpClientService {
  private connections = new Map<string, Client>();
  private processes = new Map<string, ChildProcess>();
  private toolCache = new Map<string, ToolDefinition[]>();

  /**
   * Connect to an MCP server by ID from config
   */
  async connect(serverConfig: McpServerConfig): Promise<void> {
    const { id, transport, command, args, env, url, headers } = serverConfig;

    if (this.connections.has(id)) {
      return; // Already connected
    }

    if (transport === 'stdio' && command) {
      await this.connectStdio(id, {
        command,
        args: args || [],
        env: env || {},
      });
    } else if (transport === 'http' && url) {
      await this.connectHttp(id, { url, headers: headers || {} });
    }
  }

  private async connectStdio(
    id: string,
    config: { command: string; args: string[]; env: Record<string, string> },
  ): Promise<void> {
    const child = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.processes.set(id, child);

    const client = new Client(
      {
        name: id,
        version: '1.0.0',
      },
      {
        onerror: (error) => console.error(`MCP ${id} error:`, error),
        onclose: () => {
          this.connections.delete(id);
          this.processes.delete(id);
          this.toolCache.delete(id);
        },
      },
    );

    await client.connect(child);
    this.connections.set(id, client);

    // Initial tool discovery
    await this.discoverTools(id);
  }

  private async connectHttp(
    id: string,
    config: { url: string; headers?: Record<string, string> },
  ): Promise<void> {
    // HTTP-based MCP server connection
    const client = new Client(
      {
        name: id,
        version: '1.0.0',
      },
      {
        onerror: (error) => console.error(`MCP ${id} error:`, error),
      },
    );

    // For HTTP transport, we'd use SSE connection
    // This is a simplified approach - full implementation would use SSE
    this.connections.set(id, client);
    await this.discoverTools(id);
  }

  /**
   * Discover available tools from an MCP server
   */
  private async discoverTools(serverId: string): Promise<void> {
    const client = this.connections.get(serverId);
    if (!client) return;

    const response = await client.request({ method: 'tools/list' }, {});

    const tools: ToolDefinition[] = response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as ToolParameterSchema,
    }));

    this.toolCache.set(serverId, tools);
  }

  /**
   * Get all tools for an MCP server
   */
  getTools(serverId: string): ToolDefinition[] {
    return this.toolCache.get(serverId) || [];
  }

  /**
   * Get tools for specific server, optionally filtered by tool names
   */
  getFilteredTools(serverId: string, toolNames?: string[]): ToolDefinition[] {
    const allTools = this.getTools(serverId);
    if (!toolNames || toolNames.length === 0) {
      return allTools;
    }
    return allTools.filter((t) => toolNames.includes(t.name));
  }

  /**
   * Execute a tool call on an MCP server
   */
  async callTool(
    serverId: string,
    toolName: string,
    arguments_: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const client = this.connections.get(serverId);
    if (!client) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    const response = await client.request(
      { method: 'tools/call' },
      {
        name: toolName,
        arguments: arguments_,
      },
    );

    return response;
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverId: string): Promise<void> {
    const client = this.connections.get(serverId);
    const child = this.processes.get(serverId);

    if (client) {
      await client.close();
      this.connections.delete(serverId);
    }

    if (child) {
      child.kill();
      this.processes.delete(serverId);
    }

    this.toolCache.delete(serverId);
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    for (const serverId of Array.from(this.connections.keys())) {
      await this.disconnect(serverId);
    }
  }
}

/**
 * Create an MCP client service instance
 */
export function createMcpClientService(): McpClientService {
  return new McpClientService();
}
```

### Reuse

- Use [`ToolDefinition`](packages/runtime/src/tools/index.ts:19) from `@openaidy/runtime`
- Use [`spawn`](node:child_process) from Node.js stdio
- Use existing error patterns from [`apps/server/src/mcp/service.ts`](apps/server/src/mcp/service.ts)

### Tests

```typescript
// mcp/client.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpClientService } from './client';

describe('McpClientService', () => {
  let mcpService: McpClientService;

  afterEach(() => {
    mcpService.disconnectAll();
  });

  describe('connect', () => {
    it('should connect to stdio-based MCP server', async () => {
      // Test with mock MCP server
    });

    it('should throw for unknown server', async () => {
      await expect(
        mcpService.connect({
          id: 'unknown',
          transport: 'stdio',
          command: 'echo',
        }),
      ).rejects.toThrow();
    });
  });

  describe('callTool', () => {
    it('should call a tool on connected server', async () => {
      // Test tool execution
    });
  });
});
```

---

## Step 4: Integrate MCP Tools into Agent Invocation

### What

Modify the agent invocation flow to include MCP server tools when calling the model.

### File to Modify

- [`apps/server/src/agents/registry.ts`](apps/server/src/agents/registry.ts)
- [`apps/server/src/dispatch/service.ts`](apps/server/src/dispatch/service.ts)
- [`apps/server/src/providers/invocation.ts`](apps/server/src/providers/invocation.ts)

### Implementation

First, update AgentRegistry to expose MCP server references:

```typescript
// apps/server/src/agents/registry.ts - Add method
export class AgentRegistry {
  // ... existing methods (lines 28-220)

  /**
   * Get MCP server IDs for an agent
   */
  getMcpServers(agentId: string): Array<{ id: string; tools?: string[] }> {
    const agent = this.getAgent(agentId);
    if (!agent) return [];
    return agent.mcpServers || [];
  }
}
```

Then, modify the dispatch service to inject MCP tools:

```typescript
// apps/server/src/dispatch/service.ts - Modify invoke/run methods
export class DispatchService {
  // ... existing constructor and methods

  /**
   * Get tools for agent's MCP servers
   */
  async getMcpToolsForAgent(agentId: string): Promise<ToolDefinition[]> {
    const mcpServerRefs = this.agents.getMcpServers(agentId);
    const allTools: ToolDefinition[] = [];

    for (const ref of mcpServerRefs) {
      try {
        const tools = this.mcp.getFilteredTools(ref.id, ref.tools);
        allTools.push(...tools);
      } catch (error) {
        this.logger.warn(
          { agentId, mcpServerId: ref.id, error },
          'Failed to get MCP tools',
        );
      }
    }

    return allTools;
  }

  /**
   * Execute an MCP tool call
   */
  async executeMcpTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.mcp.callTool(serverId, toolName, args);
    return result;
  }

  // Update the run method to include tools
  async run(input: RunInput): Promise<{ runId: string }> {
    const agent = this.agents.getAgent(input.agentId);
    if (!agent) {
      throw new Error(`Agent ${input.agentId} not found`);
    }

    // Get MCP tools for this agent
    const mcpTools = await this.getMcpToolsForAgent(input.agentId);

    // Build model request with MCP tools
    const modelRequest: ModelRequest = {
      model: agent.model,
      messages: [
        { role: 'system', content: agent.systemPrompt },
        ...input.messages,
      ],
      // Include MCP tools if available
      ...(mcpTools.length > 0 && { tools: mcpTools }),
    };

    // ... rest of invocation logic
  }

  /**
   * Execute MCP tool when LLM requests it
   */
  private async handleToolCall(
    toolCall: ToolCall,
    agentId: string,
  ): Promise<ToolCallResult> {
    const mcpServerRefs = this.agents.getMcpServers(agentId);

    // Find which MCP server has this tool
    for (const ref of mcpServerRefs) {
      const tools = this.mcp.getFilteredTools(ref.id, ref.tools);
      const tool = tools.find((t) => t.name === toolCall.name);

      if (tool) {
        try {
          const result = await this.mcp.callTool(
            ref.id,
            toolCall.name,
            toolCall.arguments as Record<string, unknown>,
          );

          return {
            toolCallId: toolCall.toolCallId,
            name: toolCall.name,
            content: JSON.stringify(result),
            isError: false,
          };
        } catch (error) {
          return {
            toolCallId: toolCall.toolCallId,
            name: toolCall.name,
            content:
              error instanceof Error ? error.message : 'Tool execution failed',
            isError: true,
          };
        }
      }
    }

    // Tool not found in any MCP server
    return {
      toolCallId: toolCall.toolCallId,
      name: toolCall.name,
      content: `Tool ${toolCall.name} not found in any configured MCP server`,
      isError: true,
    };
  }
}
```

### Reuse

- Use [`ToolDefinition`](packages/runtime/src/tools/index.ts) from `@openaidy/runtime`
- Use [`ToolCallResult`](packages/runtime/src/tools/index.ts:28)
- Use existing agent patterns from [`AgentRegistry`](apps/server/src/agents/registry.ts)
- Use existing dispatch events from [`DispatchEvents`](apps/server/src/dispatch/events.ts)

### Tests

```typescript
// dispatch/service.test.ts - Add MCP integration tests
describe('MCP tool integration', () => {
  it('should include MCP tools in model invocation', async () => {
    // Set up agent with MCP server reference
    // Invoke model
    // Verify tools are passed to provider
  });

  it('should execute tool call via MCP server', async () => {
    // Mock MCP server
    // Invoke tool call
    // Verify execution result
  });
});
```

---

## Step 5: Add WebSocket Handler for Tool Execution

### What

Allow clients to explicitly trigger MCP tool calls via WebSocket.

### File to Modify

- [`apps/server/src/websocket/index.ts`](apps/server/src/websocket/index.ts)
- Create new handler: [`apps/server/src/websocket/handlers/mcp.ts`](apps/server/src/websocket/handlers/mcp.ts)

### Implementation

```typescript
// apps/server/src/websocket/handlers/mcp.ts
import type { McpClientService } from '../../mcp/client';

export function createMcpHandler(mcp: McpClientService) {
  return {
    'mcp.list': async (request: { serverId?: string }) => {
      if (request.serverId) {
        return { tools: mcp.getTools(request.serverId) };
      }
      // List all servers and their tools
      return {
        /* all servers and tools */
      };
    },

    'mcp.call': async (request: {
      serverId: string;
      tool: string;
      arguments: Record<string, unknown>;
    }) => {
      const result = await mcp.callTool(
        request.serverId,
        request.tool,
        request.arguments,
      );
      return { result };
    },

    'mcp.connect': async (request: { config: McpServerConfig }) => {
      await mcp.connect(request.config);
      return { ok: true };
    },

    'mcp.disconnect': async (request: { serverId: string }) => {
      await mcp.disconnect(request.serverId);
      return { ok: true };
    },
  };
}
```

---

## Step 6: Create Web UI Component

### What

Display MCP servers and their tools in the web UI.

### File to Modify

- [`apps/web/src/components/pages/McpsPage.tsx`](apps/web/src/components/pages/McpsPage.tsx)

### Implementation

```typescript
// apps/web/src/components/pages/McpsPage.tsx
import { Layout } from './Layout';
import { For, createSignal } from 'solid-js';
import { api } from '../lib/api';

export function McpsPage() {
  const [servers, setServers] = createSignal<Array<{
    id: string;
    name: string;
    tools: Array<{ name: string; description: string }>;
  }>>([]);

  const [selectedServer, setSelectedServer] = createSignal<string | null>(null);

  // Load MCP servers on mount
  createEffect(() => {
    loadServers();
  });

  async function loadServers() {
    const response = await api.getMcpServers();
    setServers(response);
  }

  return (
    <Layout title="MCP Servers" description="Model Context Protocol server connections">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Server list */}
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h2 class="text-lg font-semibold mb-4">Configured Servers</h2>

          <div class="space-y-2">
            <For each={servers()}>
              {(server) => (
                <div
                  class="p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                  classList={{ 'border-primary': selectedServer() === server.id }}
                  onClick={() => setSelectedServer(server.id)}
                >
                  <div class="font-medium">{server.name || server.id}</div>
                  <div class="text-sm text-text-secondary">
                    {server.tools.length} tools available
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Tool details */}
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h2 class="text-lg font-semibold mb-4">Available Tools</h2>

          <Show when={selectedServer()}>
            <div class="space-y-3">
              <For each={servers().find(s => s.id === selectedServer())?.tools || []}>
                {(tool) => (
                  <div class="p-3 border rounded-lg">
                    <div class="font-mono text-sm font-medium">{tool.name}</div>
                    <div class="text-sm text-text-secondary mt-1">{tool.description}</div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={!selectedServer()}>
            <div class="text-text-tertiary">Select a server to see tools</div>
          </Show>
        </div>
      </div>
    </Layout>
  );
}
```

### Add API Methods

- [`apps/web/src/lib/api.ts`](apps/web/src/lib/api.ts)

```typescript
// apps/web/src/lib/api.ts - Add methods
export const api = {
  // ... existing methods

  async getMcpServers(): Promise<
    Array<{
      id: string;
      name: string;
      tools: Array<{ name: string; description: string }>;
    }>
  > {
    const response = await fetch('/api/mcp/servers');
    return response.json();
  },
};
```

---

## Files to Create/Modify

| Action     | File                                                                                       | Description            |
| ---------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| **Modify** | [`apps/server/src/agents/schema.ts`](apps/server/src/agents/schema.ts)                     | Add mcpServers field   |
| **Modify** | [`config/openaidy.template.json`](config/openaidy.template.json)                           | Add MCP server configs |
| **Modify** | [`packages/config/src/app-config.ts`](packages/config/src/app-config.ts)                   | Add config schemas     |
| **Create** | [`apps/server/src/mcp/client.ts`](apps/server/src/mcp/client.ts)                           | MCP client service     |
| **Create** | [`apps/server/src/mcp/client.test.ts`](apps/server/src/mcp/client.test.ts)                 | Client tests           |
| **Modify** | [`apps/server/src/agents/registry.ts`](apps/server/src/agents/registry.ts)                 | Expose MCP refs        |
| **Modify** | [`apps/server/src/dispatch/service.ts`](apps/server/src/dispatch/service.ts)               | Tool injection         |
| **Create** | [`apps/server/src/websocket/handlers/mcp.ts`](apps/server/src/websocket/handlers/mcp.ts)   | WS handler             |
| **Modify** | [`apps/web/src/components/pages/McpsPage.tsx`](apps/web/src/components/pages/McpsPage.tsx) | UI component           |
| **Modify** | [`apps/web/src/lib/api.ts`](apps/web/src/lib/api.ts)                                       | Add API methods        |

---

## Security Considerations

1. **Process Isolation**: MCP servers run as child processes - kill them if they exceed timeout
2. **Tool Validation**: Validate tool call arguments before execution
3. **Resource Limits**: Limit number of concurrent MCP connections
4. **Network**: For HTTP transport, validate URLs andHeaders
5. **Secrets**: Never pass MCP server configs with secrets to web UI

---

## Code Reuse Summary

| Reuse From                                                                   | What                               |
| ---------------------------------------------------------------------------- | ---------------------------------- |
| [`@openaidy/runtime`](packages/runtime/src/tools/index.ts)                   | `ToolDefinition`, `ToolCallResult` |
| [`AgentRegistry`](apps/server/src/agents/registry.ts)                        | `getAgent`, `listAgents`           |
| [`packages/config/src/app-config.ts`](packages/config/src/app-config.ts)     | Zod schemas, config loading        |
| [`apps/server/src/mcp/service.ts`](apps/server/src/mcp/service.ts)           | Service patterns                   |
| [`apps/server/src/dispatch/service.ts`](apps/server/src/dispatch/service.ts) | Execution flow                     |

---

## Summary

| Step | Task                   | Files Modified                                                                                                           |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1    | Extend Agent Schema    | [`agents/schema.ts`](apps/server/src/agents/schema.ts)                                                                   |
| 2    | MCP Server Config      | [`openaidy.template.json`](config/openaidy.template.json), [`app-config.ts`](packages/config/src/app-config.ts)          |
| 3    | MCP Client Service     | [`mcp/client.ts`](apps/server/src/mcp/client.ts)                                                                         |
| 4    | Invocation Integration | [`dispatch/service.ts`](apps/server/src/dispatch/service.ts), [`agents/registry.ts`](apps/server/src/agents/registry.ts) |
| 5    | WebSocket Handler      | [`websocket/handlers/mcp.ts`](apps/server/src/websocket/handlers/mcp.ts)                                                 |
| 6    | Web UI                 | [`McpsPage.tsx`](apps/web/src/components/pages/McpsPage.tsx), [`api.ts`](apps/web/src/lib/api.ts)                        |
