# Agent Workspace Permissions Implementation Plan

## Overview

Implement a granular workspace permission system where:

- Each agent has its own workspace directory
- Agents can be granted read/write access to other agents' workspaces
- Permission is defined per-agent in JSON config

## Reusing Existing Code - Best Practices

Before implementing, review these existing components to avoid duplication:

### Reuse from Server

| Existing                             | Reuse For              | How                                                         |
| ------------------------------------ | ---------------------- | ----------------------------------------------------------- |
| `apps/server/src/agents/schema.ts`   | Agent, Workspace types | Extend existing `AgentSchema`, don't create new             |
| `apps/server/src/agents/registry.ts` | Agent lookup           | Use `getAgent()`, `getAllAgentsMap()` for permission checks |
| `apps/server/src/config/service.ts`  | Config loading         | Use existing config service to access workspace settings    |
| `apps/server/src/lib/env.ts`         | Environment vars       | Use `getWorkspaceDir()` or similar for root path            |
| `apps/server/src/lib/logger.ts`      | Logging                | Use existing logger for workspace operations                |

### Reuse from Web

| Existing                              | Reuse For     | How                                                  |
| ------------------------------------- | ------------- | ---------------------------------------------------- |
| `apps/web/src/lib/api.ts`             | HTTP client   | Add workspace API functions using existing pattern   |
| `apps/web/src/components/ui/Tabs.tsx` | UI components | Use for file browser tab layout                      |
| `apps/web/src/lib/ws-api.ts`          | WebSocket API | May need WebSocket events for real-time file updates |

### Key Design Patterns to Follow

1. **Zod Schema Extension**: Extend existing `AgentSchema` rather than creating standalone schema
2. **Service Pattern**: Follow existing service pattern (e.g., `ConfigService`, `AgentRegistry`)
3. **Error Handling**: Use existing error types from `packages/runtime/src/errors`
4. **Logging**: Use existing logger with appropriate context

### Types to Reuse

```typescript
// From apps/server/src/agents/schema.ts
import { AgentSchema, type Agent, type AgentSummary } from './schema';

// From packages/shared-types
import type { AgentId, SessionId } from '@openaidy/shared-types';
```

## Architecture

```mermaid
flowchart TB
    subgraph Agent Config
        A[config/openaidy.template.json] --> B[workspace.permissions]
    end

    subgraph Server
        C[WorkspaceService] --> D[Permission Validator]
        D --> E[File Operations]
    end

    subgraph API
        F[/api/workspace/:agentId/files] --> C
        G[/api/workspace/:agentId/read] --> C
        H[/api/workspace/:agentId/write] --> C
    end

    subgraph Web UI
        I[File Browser Component] --> F
    end
```

## Implementation Steps

### Step 1: Extend Agent Schema

File: `apps/server/src/agents/schema.ts`

**IMPORTANT**: Extend the EXISTING schema, don't create a new one. Import and reuse existing types.

```typescript
import { z } from 'zod';
import {
  AgentSchema, // EXISTING - extend this
  type Agent, // REUSE - for type hints
  type AgentSummary,
} from './schema';

// REUSE: Extend existing workspace config into AgentSchema
// Add workspace to the existing schema via Zod extension or create optional extension
const WorkspacePermissionsSchema = z.object({
  canRead: z.array(z.string()).default([]),
  canWrite: z.array(z.string()).default([]),
});

const WorkspaceSchema = z.object({
  path: z.string(), // e.g., "default"
  permissions: WorkspacePermissionsSchema.optional(),
});

// REUSE: Since we can't easily extend AgentSchema, create a merged type
// The workspace config will be parsed alongside the agent
export const WorkspaceConfigSchema = WorkspaceSchema;
export type WorkspaceConfig = z.infer<typeof WorkspaceSchema>;
export type WorkspacePermissions = z.infer<typeof WorkspacePermissionsSchema>;

/**
 * REUSE: Helper to extract workspace from agent config
 */
export function getAgentWorkspace(agent: Agent): WorkspaceConfig | undefined {
  return (agent as any).workspace;
}
```

### Step 2: Create Workspace Service

File: `apps/server/src/workspace/service.ts`

**IMPORTANT**: Follow the existing service pattern in the codebase (see `ConfigService`, `AgentRegistry` for reference).

```typescript
import fs from 'fs/promises';
import path from 'path';
// REUSE: Import existing logger
import { logger } from '../lib/logger';
// REUSE: Import error types
import { ValidationError, NotFoundError } from '@openaidy/runtime/errors';

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: Date;
}

export interface WorkspaceServiceConfig {
  rootPath: string; // e.g., process.env.WORKSPACE_DIR || "/workspaces"
}

export class WorkspaceService {
  private rootPath: string;

  constructor(config: WorkspaceServiceConfig) {
    this.rootPath = config.rootPath;
  }

  /**
   * REUSE: Getter pattern from existing services
   */
  get workspaceRoot(): string {
    return this.rootPath;
  }

  /**
   * REUSE: Get the workspace directory path for an agent
   * Pattern: use path.join for cross-platform compatibility
   */
  getWorkspacePath(agentId: string): string {
    return path.join(this.rootPath, agentId);
  }

  /**
   * Ensure workspace directory exists
   */
  async ensureWorkspace(agentId: string): Promise<void> {
    const workspacePath = this.getWorkspacePath(agentId);
    await fs.mkdir(workspacePath, { recursive: true });
  }

  /**
   * List files in a workspace directory
   */
  async listFiles(
    agentId: string,
    relativePath: string = '',
  ): Promise<FileInfo[]> {
    const workspacePath = this.getWorkspacePath(agentId);
    const fullPath = path.join(workspacePath, relativePath);

    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    return Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(entryPath);

        return {
          name: entry.name,
          path: path.join(relativePath, entry.name),
          isDirectory: entry.isDirectory(),
          size: stats.size,
          modifiedAt: stats.mtime,
        };
      }),
    );
  }

  /**
   * Read a file from workspace
   */
  async readFile(agentId: string, filePath: string): Promise<string> {
    const workspacePath = this.getWorkspacePath(agentId);
    const fullPath = path.join(workspacePath, filePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  /**
   * Write content to a file in workspace
   */
  async writeFile(
    agentId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const workspacePath = this.getWorkspacePath(agentId);
    const fullPath = path.join(workspacePath, filePath);

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  /**
   * Delete a file from workspace
   */
  async deleteFile(agentId: string, filePath: string): Promise<void> {
    const workspacePath = this.getWorkspacePath(agentId);
    const fullPath = path.join(workspacePath, filePath);
    await fs.unlink(fullPath);
  }

  /**
   * Validate that a path stays within workspace bounds
   * Throws error if path traversal is detected
   */
  validatePath(agentId: string, requestedPath: string): string {
    const workspacePath = path.resolve(this.getWorkspacePath(agentId));
    const requestedFullPath = path.resolve(
      path.join(workspacePath, requestedPath),
    );

    // Check if the resolved path starts with workspace path
    if (!requestedFullPath.startsWith(workspacePath)) {
      throw new Error('Path traversal detected: access denied');
    }

    return requestedFullPath;
  }
}
```

### Step 2: Create Workspace Service

File: `apps/server/src/workspace/service.ts`

Create a new service to manage workspace operations:

```typescript
export class WorkspaceService {
  private rootPath: string;
  private permissionMatrix: Map<string, WorkspacePermissions>;

  // Get workspace path for an agent
  getWorkspacePath(agentId: string): string;

  // Check if agent can access target workspace
  canAccess(
    sourceAgentId: string,
    targetAgentId: string,
    mode: 'read' | 'write',
  ): boolean;

  // List files in workspace
  listFiles(agentId: string, path?: string): Promise<FileInfo[]>;

  // Read file from workspace
  readFile(agentId: string, filePath: string): Promise<string>;

  // Write file to workspace
  writeFile(agentId: string, filePath: string, content: string): Promise<void>;

  // Validate path to prevent traversal attacks
  private validatePath(agentId: string, requestedPath: string): string;
}
```

### Step 3: Add Permission Validation

File: `apps/server/src/workspace/permissions.ts`

**IMPORTANT**: Use existing AgentRegistry to look up agents - don't create new data stores.

```typescript
import type { Agent } from '../agents/schema';
// REUSE: Import AgentRegistry for agent lookups
import { AgentRegistry } from '../agents/registry';

/**
 * Validate if a source agent can access a target agent's workspace
 *
 * REUSE: Uses AgentRegistry pattern for agent lookups
 *
 * @param sourceAgentId - The agent trying to access
 * @param targetAgentId - The workspace being accessed
 * @param mode - 'read' or 'write'
 * @param agentRegistry - REUSE: Pass existing AgentRegistry instance
 * @returns true if access is allowed, false otherwise
 */
export function validateWorkspaceAccess(
  sourceAgentId: string,
  targetAgentId: string,
  mode: 'read' | 'write',
  agentRegistry: AgentRegistry,
): boolean {
  // Cannot access own workspace through cross-access mechanism
  if (sourceAgentId === targetAgentId) {
    return true;
  }

  // REUSE: Get agent from registry
  const sourceAgent = agentRegistry.getAgent(sourceAgentId);

  // No workspace defined = default deny
  if (!sourceAgent?.workspace) {
    return false;
  }

  const permissions = sourceAgent.workspace.permissions;
  if (!permissions) {
    return false;
  }

  const { canRead, canWrite } = permissions;

  if (mode === 'read') {
    return canRead.includes(targetAgentId);
  }

  return canWrite.includes(targetAgentId);
}

/**
 * Get the effective permissions for an agent
 * Returns combined permissions from direct config
 */
export function getEffectivePermissions(
  agentId: string,
  agents: Map<string, Agent>,
): WorkspacePermissions | null {
  const agent = agents.get(agentId);
  if (!agent?.workspace?.permissions) {
    return null;
  }
  return agent.workspace.permissions;
}

/**
 * Check if an agent has any cross-workspace access
 */
export function hasCrossWorkspaceAccess(
  agentId: string,
  agents: Map<string, Agent>,
): boolean {
  const perms = getEffectivePermissions(agentId, agents);
  if (!perms) {
    return false;
  }
  return perms.canRead.length > 0 || perms.canWrite.length > 0;
}

/**
 * Get list of agents this agent can read from
 */
export function getReadableAgents(
  agentId: string,
  agents: Map<string, Agent>,
): string[] {
  const perms = getEffectivePermissions(agentId, agents);
  return perms?.canRead ?? [];
}

/**
 * Get list of agents this agent can write to
 */
export function getWritableAgents(
  agentId: string,
  agents: Map<string, Agent>,
): string[] {
  const perms = getEffectivePermissions(agentId, agents);
  return perms?.canWrite ?? [];
}
```

### Step 4: Create API Routes

File: `apps/server/src/routes/workspace.ts`

**IMPORTANT**: Follow existing route patterns in the codebase (see `apps/server/src/routes/agents.ts` for reference).

```typescript
import { Router, type Request, type Response } from 'express';
// REUSE: Import existing services
import { WorkspaceService } from '../workspace/service';
import { AgentRegistry } from '../agents/registry';
import { validateWorkspaceAccess } from '../workspace/permissions';
// REUSE: Use existing error handling
import { errorHandler, AppError } from '@openaidy/runtime/errors';

// REUSE: Get singleton instances from app context
const getAgentRegistry = (): AgentRegistry => {
  // This should be set during app initialization
  return (global as any).agentRegistry;
};

const getWorkspaceService = (): WorkspaceService => {
  return (global as any).workspaceService;
};

const router = Router();

/**
 * GET /api/workspace/:agentId/files
 * List files in an agent's workspace
 */
router.get('/:agentId/files', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const path = req.query.path as string | undefined;

    // Get requesting agent from auth header or query
    const requestingAgentId =
      (req.headers['x-agent-id'] as string) ??
      (req.query.requestingAgentId as string);

    if (!requestingAgentId) {
      return res.status(401).json({ error: 'No agent identified' });
    }

    // Check permissions
    const agents = agentRegistry.getAllAgentsMap();
    if (!validateWorkspaceAccess(requestingAgentId, agentId, 'read', agents)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const files = await workspaceService.listFiles(agentId, path ?? '');
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/workspace/:agentId/files/:path
 * Read a file from workspace
 */
router.get('/:agentId/files/*', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const filePath = req.params[0]; // Captured wildcard path

    const requestingAgentId = req.headers['x-agent-id'] as string;

    if (!requestingAgentId) {
      return res.status(401).json({ error: 'No agent identified' });
    }

    const agents = agentRegistry.getAllAgentsMap();
    if (!validateWorkspaceAccess(requestingAgentId, agentId, 'read', agents)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const content = await workspaceService.readFile(agentId, filePath);
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/workspace/:agentId/files/:path
 * Create a new file in workspace
 */
router.post('/:agentId/files/*', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const filePath = req.params[0];
    const { content } = req.body;

    const requestingAgentId = req.headers['x-agent-id'] as string;

    if (!requestingAgentId) {
      return res.status(401).json({ error: 'No agent identified' });
    }

    const agents = agentRegistry.getAllAgentsMap();
    if (!validateWorkspaceAccess(requestingAgentId, agentId, 'write', agents)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await workspaceService.writeFile(agentId, filePath, content);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/workspace/:agentId/files/:path
 * Update an existing file
 */
router.put('/:agentId/files/*', async (req: Request, res: Response) => {
  // Same as POST for now
  return router.post('/:agentId/files/*', req, res);
});

/**
 * DELETE /api/workspace/:agentId/files/:path
 * Delete a file from workspace
 */
router.delete('/:agentId/files/*', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const filePath = req.params[0];

    const requestingAgentId = req.headers['x-agent-id'] as string;

    if (!requestingAgentId) {
      return res.status(401).json({ error: 'No agent identified' });
    }

    const agents = agentRegistry.getAllAgentsMap();
    if (!validateWorkspaceAccess(requestingAgentId, agentId, 'write', agents)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await workspaceService.deleteFile(agentId, filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

Register routes in `apps/server/src/app.ts`:

```typescript
import workspaceRoutes from './routes/workspace';

// ... after other routes
app.use('/api/workspace', workspaceRoutes);
```

### Step 5: Add Web UI Components

File: `apps/web/src/components/workspace/FileExplorer.tsx`

**IMPORTANT**: Follow existing SolidJS component patterns (see `apps/web/src/components/SessionList.tsx` for reference).

```typescript
import { createSignal, For, Show } from 'solid-js';
// REUSE: Import existing types
import type { FileInfo } from '../../../server/src/workspace/service';
// REUSE: Import existing API functions pattern
import { listWorkspaceFiles, readWorkspaceFile } from '../../lib/api';
// REUSE: Use existing UI components
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { Tabs } from '../ui/Tabs';

interface FileExplorerProps {
  agentId: string;
  onFileSelect?: (path: string) => void;
  onFileOpen?: (path: string) => void;
}

export function FileExplorer(props: FileExplorerProps) {
  const [currentPath, setCurrentPath] = createSignal('');
  const [files, setFiles] = createSignal<FileInfo[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const loadFiles = async (path: string = '') => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspace/${props.agentId}/files?path=${encodeURIComponent(path)}`,
        {
          headers: {
            'X-Agent-Id': props.agentId,
          },
        }
      );
      if (!response.ok) {
        throw new Error('Failed to load files');
      }
      const data = await response.json();
      setFiles(data.files);
      setCurrentPath(path);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const navigateToFolder = (folderPath: string) => {
    loadFiles(folderPath);
  };

  const goUp = () => {
    const parts = currentPath().split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.join('/');
    loadFiles(newPath);
  };

  return (
    <div class="file-explorer">
      <div class="file-explorer-header">
        <button onClick={goUp} disabled={!currentPath()}>
          Back
        </button>
        <span class="current-path">/{currentPath()}</span>
      </div>

      <Show when={loading()}>
        <div>Loading...</div>
      </Show>

      <Show when={error()}>
        <div class="error">{error()}</div>
      </Show>

      <div class="file-list">
        <For each={files()}>
          {(file) => (
            <div
              class="file-item"
              onClick={() => {
                if (file.isDirectory) {
                  navigateToFolder(file.path);
                } else {
                  props.onFileSelect?.(file.path);
                }
              }}
            >
              <span class="file-icon">
                {file.isDirectory ? '📁' : '📄'}
              </span>
              <span class="file-name">{file.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
```

Add API functions to `apps/web/src/lib/api.ts`:

**IMPORTANT**: Follow existing API function patterns in the codebase (see `listSessions`, `submitMessage` for reference).

```typescript
/**
 * REUSE: Follow existing API pattern from this file
 * Fetch file list from agent workspace
 */
export async function listWorkspaceFiles(
  agentId: string,
  path: string = '',
): Promise<{ files: FileInfo[] }> {
  const response = await fetch(
    `/api/workspace/${agentId}/files?path=${encodeURIComponent(path)}`,
    {
      headers: {
        'X-Agent-Id': agentId,
      },
    },
  );
  if (!response.ok) {
    throw new Error('Failed to load workspace files');
  }
  return response.json();
}

/**
 * Read a file from agent workspace
 */
export async function readWorkspaceFile(
  agentId: string,
  filePath: string,
): Promise<{ content: string }> {
  const response = await fetch(`/api/workspace/${agentId}/files/${filePath}`, {
    headers: {
      'X-Agent-Id': agentId,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to read file');
  }
  return response.json();
}

/**
 * Write a file to agent workspace
 */
export async function writeWorkspaceFile(
  agentId: string,
  filePath: string,
  content: string,
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/workspace/${agentId}/files/${filePath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': agentId,
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error('Failed to write file');
  }
  return response.json();
}

/**
 * Delete a file from agent workspace
 */
export async function deleteWorkspaceFile(
  agentId: string,
  filePath: string,
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/workspace/${agentId}/files/${filePath}`, {
    method: 'DELETE',
    headers: {
      'X-Agent-Id': agentId,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to delete file');
  }
  return response.json();
}
```

### Step 6: Update OpenAidy Config

File: `config/openaidy.template.json`

Add workspace configuration to each agent in the agents array:

```json
{
  "version": 1,
  "agents": [
    {
      "id": "default",
      "workspace": {
        "path": "default",
        "permissions": {
          "canRead": ["code-assistant"],
          "canWrite": []
        }
      }
    },
    {
      "id": "code-assistant",
      "workspace": {
        "path": "code-assistant",
        "permissions": {
          "canRead": [],
          "canWrite": []
        }
      }
    }
  ]
}
```

Note: This replaces the earlier suggestion of using separate config files in `config/agents/`. The unified `config/openaidy.template.json` approach keeps all configuration in one place.

## Permission Matrix Example

For scenario: Agent1 → Agent2, Agent2 → Agent3, Agent3 blocked

| Agent   | canRead   | canWrite |
| ------- | --------- | -------- |
| agent-1 | [agent-2] | []       |
| agent-2 | [agent-3] | []       |
| agent-3 | []        | []       |

## Files to Create/Modify

| File                                                 | Action                                  |
| ---------------------------------------------------- | --------------------------------------- |
| `apps/server/src/agents/schema.ts`                   | Modify - add WorkspaceSchema            |
| `apps/server/src/workspace/service.ts`               | Create - main service                   |
| `apps/server/src/workspace/permissions.ts`           | Create - validation logic               |
| `apps/server/src/routes/workspace.ts`                | Create - API routes                     |
| `apps/server/src/app.ts`                             | Modify - register routes                |
| `apps/web/src/components/workspace/FileExplorer.tsx` | Create - UI component                   |
| `apps/web/src/lib/api.ts`                            | Modify - add workspace API calls        |
| `.openaidy/openaidy.json`                            | Modify - add workspace config to agents |
| `config/openaidy.template.json`                      | Modify - add workspace config template  |

## Security Considerations

1. **Path Traversal Prevention**
   - Validate all paths to ensure they stay within workspace bounds
   - Reject paths containing `../`
   - Use canonical paths for comparison

2. **Symlink Attacks**
   - Check if resolved path is within workspace
   - Consider blocking symlinks entirely

3. **Default Deny**
   - Agents have no cross-workspace access by default
   - Must explicitly grant permissions

## Docker Migration Path

The current filesystem-based approach maps easily to Docker:

| Current                 | Docker Future                                     |
| ----------------------- | ------------------------------------------------- |
| `/workspaces/agent-id/` | `docker volume create agent-workspace-{agent-id}` |
| Path validation         | Container filesystem isolation                    |
| Permission matrix       | Container user/group permissions                  |
| File API                | Volume mount + container exec                     |

This architecture is intentionally designed to be replaceable with Docker containers while maintaining the same API contracts.

## Summary

This implementation plan provides:

1. **Workspace Isolation** - Each agent has its own directory under `/workspaces/{agentId}/`

2. **Permission System** - Granular read/write permissions defined per-agent in config

3. **API Endpoints** - RESTful routes for file operations with permission checks

4. **Web UI** - File browser component for visualizing workspace contents

5. **Security** - Path traversal prevention, default deny policy

6. **Docker-Ready** - Can migrate to containerized workspaces later

The plan includes full TypeScript code for:

- Extended agent schema with workspace config
- WorkspaceService for file operations
- Permission validation functions
- Express API routes
- SolidJS web components
- API client functions

## Code Reuse Best Practices Summary

When implementing, follow these guidelines:

| Guideline                     | Implementation                                                 |
| ----------------------------- | -------------------------------------------------------------- |
| **Extend Existing Schemas**   | Don't recreate `AgentSchema`, add workspace config to existing |
| **Use AgentRegistry**         | For all agent lookups, don't create new data stores            |
| **Follow Service Patterns**   | Match `ConfigService`, `AgentRegistry` patterns                |
| **Use Existing Error Types**  | Import from `@openaidy/runtime/errors`                         |
| **Use Existing Logger**       | Import from `../lib/logger`                                    |
| **Follow API Patterns**       | Match existing route patterns in `apps/server/src/routes/`     |
| **Follow Component Patterns** | Match existing SolidJS patterns in web components              |

This ensures consistency with the codebase and avoids code duplication.
