import type { AgentRegistry } from '../agents/registry';
import type { Agent, WorkspacePermissions } from '../agents/schema';
import { createLogger } from '../lib/logger';

const log = createLogger('workspace-permissions');

/**
 * Permission modes for workspace access
 */
export type PermissionMode = 'read' | 'write' | 'delete' | 'list';

/**
 * Result of permission validation
 */
export interface PermissionResult {
  allowed: boolean;
  reason: string;
}

/**
 * Validate if a source agent can access a target agent's workspace
 * in the specified mode.
 *
 * Rules:
 * 1. Self-access is always allowed (agent can access own workspace)
 * 2. Target agent must exist
 * 3. Target agent must have workspace enabled
 * 4. Source agent must have workspace enabled
 * 5. Source agent's workspace config must include target agent
 * 6. Permission must match the requested mode
 */
export function validateWorkspaceAccess(
  sourceAgentId: string,
  targetAgentId: string,
  mode: PermissionMode,
  agentRegistry: AgentRegistry,
): PermissionResult {
  // Get source agent
  const sourceAgent = agentRegistry.getAgent(sourceAgentId);
  if (!sourceAgent) {
    log.warn('Source agent not found:', sourceAgentId);
    return { allowed: false, reason: 'Source agent not found' };
  }

  // Self-access: check if workspace is enabled and permissions allow the mode
  if (sourceAgentId === targetAgentId) {
    if (!sourceAgent.workspace?.enabled) {
      return { allowed: false, reason: 'Source agent workspace is disabled' };
    }
    if (!sourceAgent.workspace.workspaces || sourceAgent.workspace.workspaces.length === 0) {
      return { allowed: false, reason: 'Source agent has no workspaces configured' };
    }
    // Check effective permissions for the requested mode
    const effectivePerms = getEffectivePermissions(sourceAgentId, agentRegistry);
    if (!effectivePerms || !effectivePerms[mode]) {
      return { allowed: false, reason: `Self-access denied for mode: ${mode}` };
    }
    return { allowed: true, reason: 'Self-access allowed' };
  }

  // Get target agent
  const targetAgent = agentRegistry.getAgent(targetAgentId);
  if (!targetAgent) {
    log.warn('Target agent not found:', targetAgentId);
    return { allowed: false, reason: 'Target agent not found' };
  }

  // Check if target has workspace enabled
  if (!targetAgent.workspace?.enabled) {
    return { allowed: false, reason: 'Target agent workspace is disabled' };
  }

  // Check if source has workspace configuration
  if (!sourceAgent.workspace?.enabled) {
    return { allowed: false, reason: 'Source agent workspace is disabled' };
  }

  // Check if source has the target workspace in its config
  const targetWorkspace = sourceAgent.workspace.workspaces.find(
    (ws) => ws.path === targetAgentId || ws.path.includes(targetAgentId),
  );

  if (!targetWorkspace) {
    // Check default permissions if no specific workspace permission
    const defaultPerms = sourceAgent.workspace.defaultPermissions;
    if (!defaultPerms) {
      return { allowed: false, reason: 'No permission for target workspace' };
    }

    // Check default permission for mode
    if (!defaultPerms[mode]) {
      return {
        allowed: false,
        reason: `Default permission denied for mode: ${mode}`,
      };
    }

    return { allowed: true, reason: 'Default permission allowed' };
  }

  // Check specific workspace permissions
  const permissions = targetWorkspace.permissions;
  if (!permissions) {
    // No specific permissions means use default
    const defaultPerms = sourceAgent.workspace.defaultPermissions;
    if (!defaultPerms || !defaultPerms[mode]) {
      return { allowed: false, reason: 'No permissions for this operation' };
    }
    return { allowed: true, reason: 'Allowed by default permissions' };
  }

  // Check the specific permission
  if (!permissions[mode]) {
    return { allowed: false, reason: `Permission denied for mode: ${mode}` };
  }

  return { allowed: true, reason: 'Permission granted' };
}

/**
 * Get the effective permissions for an agent's workspace access.
 * Returns null if agent has no workspace configured.
 */
export function getEffectivePermissions(
  agentId: string,
  agentRegistry: AgentRegistry,
): WorkspacePermissions | null {
  const agent = agentRegistry.getAgent(agentId);
  if (!agent?.workspace?.enabled) {
    return null;
  }

  // Return default permissions if configured
  if (agent.workspace.defaultPermissions) {
    return agent.workspace.defaultPermissions;
  }

  // Return a default based on having workspace enabled
  return {
    read: true,
    write: false,
    delete: false,
    list: true,
  };
}

/**
 * Check if an agent has any cross-workspace access configured.
 * Returns true if the agent can access other agents' workspaces.
 */
export function hasCrossWorkspaceAccess(
  agentId: string,
  agentRegistry: AgentRegistry,
): boolean {
  const agent = agentRegistry.getAgent(agentId);
  if (!agent?.workspace?.enabled) {
    return false;
  }

  // Check if there are workspaces configured for other agents
  const allAgents = agentRegistry.listAgents();
  const otherAgentIds = allAgents
    .filter((a) => a.id !== agentId && a.workspace?.enabled)
    .map((a) => a.id);

  // Check if any workspace entry references another agent
  for (const ws of agent.workspace.workspaces) {
    for (const otherId of otherAgentIds) {
      if (ws.path === otherId || ws.path.includes(otherId)) {
        return true;
      }
    }
  }

  // Check default permissions - if write is enabled, they have cross access
  if (agent.workspace.defaultPermissions?.write) {
    return true;
  }

  return false;
}

/**
 * Get list of agent IDs whose workspaces this agent can read.
 * Always includes the agent itself if workspace is enabled.
 */
export function getReadableAgents(
  agentId: string,
  agentRegistry: AgentRegistry,
): string[] {
  const readable: string[] = [];
  const agent = agentRegistry.getAgent(agentId);

  // Self is always included if workspace enabled
  if (agent?.workspace?.enabled) {
    readable.push(agentId);
  }

  // Check all other agents
  const allAgents = agentRegistry.listAgents();
  for (const otherAgent of allAgents) {
    if (otherAgent.id === agentId) continue;
    if (!otherAgent.workspace?.enabled) continue;

    const result = validateWorkspaceAccess(
      agentId,
      otherAgent.id,
      'read',
      agentRegistry,
    );
    if (result.allowed) {
      readable.push(otherAgent.id);
    }
  }

  return readable;
}

/**
 * Get list of agent IDs whose workspaces this agent can write.
 * Always includes the agent itself if workspace is enabled with write permission.
 */
export function getWritableAgents(
  agentId: string,
  agentRegistry: AgentRegistry,
): string[] {
  const writable: string[] = [];
  const agent = agentRegistry.getAgent(agentId);

  // Check self-write permission
  if (agent?.workspace?.enabled) {
    const selfPerms = getEffectivePermissions(agentId, agentRegistry);
    if (selfPerms?.write) {
      writable.push(agentId);
    }
  }

  // Check all other agents
  const allAgents = agentRegistry.listAgents();
  for (const otherAgent of allAgents) {
    if (otherAgent.id === agentId) continue;
    if (!otherAgent.workspace?.enabled) continue;

    const result = validateWorkspaceAccess(
      agentId,
      otherAgent.id,
      'write',
      agentRegistry,
    );
    if (result.allowed) {
      writable.push(otherAgent.id);
    }
  }

  return writable;
}

/**
 * Check if an agent can perform a specific operation on a workspace
 * Convenience function that returns boolean
 */
export function canAccessWorkspace(
  sourceAgentId: string,
  targetAgentId: string,
  mode: PermissionMode,
  agentRegistry: AgentRegistry,
): boolean {
  return validateWorkspaceAccess(sourceAgentId, targetAgentId, mode, agentRegistry).allowed;
}
