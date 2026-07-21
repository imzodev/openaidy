import { describe, it, expect } from 'vitest';
import {
  validateWorkspaceAccess,
  getEffectivePermissions,
  hasCrossWorkspaceAccess,
  getReadableAgents,
  getWritableAgents,
  canAccessWorkspace,
} from './permissions';
import type { AgentRegistry } from '../agents/registry';
import type { Agent } from '../agents/schema';

// Mock AgentRegistry
function createMockRegistry(agents: Agent[]): AgentRegistry {
  return {
    getAgent: (id: string) => agents.find((a) => a.id === id),
    listAgents: () => agents.filter((a) => a.enabled),
    registerAgent: async () => {},
    unregisterAgent: async () => {},
    reloadAgents: async () => {},
    getAgentsByTag: () => [],
    getAgentsByTool: () => [],
  } as unknown as AgentRegistry;
}

describe('workspace permissions', () => {
  let registry: AgentRegistry;

  describe('validateWorkspaceAccess', () => {
    it('should allow self-access for agent with workspace', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [{ path: '/project' }],
          },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'agent-1',
        'read',
        registry,
      );
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('Self-access allowed');
    });

    it('should deny self-access if workspace is disabled', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: false,
            workspaces: [],
          },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'agent-1',
        'read',
        registry,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('should deny access if source agent not found', () => {
      registry = createMockRegistry([]);

      const result = validateWorkspaceAccess(
        'unknown',
        'agent-1',
        'read',
        registry,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Source agent not found');
    });

    it('should deny access if target agent not found', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [{ path: '/project' }] },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'unknown',
        'read',
        registry,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Target agent not found');
    });

    it('should deny access if target workspace is disabled', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [
              {
                path: 'agent-2',
                permissions: {
                  read: true,
                  write: false,
                  delete: false,
                  list: true,
                },
              },
            ],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: false, workspaces: [] },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'agent-2',
        'read',
        registry,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('should allow cross-workspace access with explicit permission', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [
              {
                path: 'agent-2',
                permissions: {
                  read: true,
                  write: true,
                  delete: false,
                  list: true,
                },
              },
            ],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [{ path: '/project2' }] },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'agent-2',
        'write',
        registry,
      );
      expect(result.allowed).toBe(true);
    });

    it('should deny cross-workspace access without permission', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [
              {
                path: 'agent-2',
                permissions: {
                  read: true,
                  write: false,
                  delete: false,
                  list: true,
                },
              },
            ],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [{ path: '/project2' }] },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'agent-2',
        'write',
        registry,
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Permission denied');
    });

    it('should use default permissions if no specific permission', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            defaultPermissions: {
              read: true,
              write: true,
              delete: false,
              list: true,
            },
            workspaces: [],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [{ path: '/project2' }] },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'agent-2',
        'write',
        registry,
      );
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Default permission');
    });

    it('should deny delete operation by default', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [{ path: 'agent-2' }],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [{ path: '/project2' }] },
        },
      ];
      registry = createMockRegistry(agents);

      const result = validateWorkspaceAccess(
        'agent-1',
        'agent-2',
        'delete',
        registry,
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe('getEffectivePermissions', () => {
    it('should return default permissions for agent with workspace', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            defaultPermissions: {
              read: true,
              write: true,
              delete: true,
              list: true,
            },
            workspaces: [],
          },
        },
      ];
      registry = createMockRegistry(agents);

      const perms = getEffectivePermissions('agent-1', registry);
      expect(perms).toEqual({
        read: true,
        write: true,
        delete: true,
        list: true,
      });
    });

    it('should return null for agent without workspace', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
        },
      ];
      registry = createMockRegistry(agents);

      const perms = getEffectivePermissions('agent-1', registry);
      expect(perms).toBeNull();
    });

    it('should return default read/list permissions if no defaultPermissions set', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [{ path: '/project' }],
          },
        },
      ];
      registry = createMockRegistry(agents);

      const perms = getEffectivePermissions('agent-1', registry);
      expect(perms).toEqual({
        read: true,
        write: false,
        delete: false,
        list: true,
      });
    });
  });

  describe('hasCrossWorkspaceAccess', () => {
    it('should return false for agent without workspace', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
        },
      ];
      registry = createMockRegistry(agents);

      expect(hasCrossWorkspaceAccess('agent-1', registry)).toBe(false);
    });

    it('should return true if agent has write default permissions', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            defaultPermissions: {
              read: true,
              write: true,
              delete: false,
              list: true,
            },
            workspaces: [],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [] },
        },
      ];
      registry = createMockRegistry(agents);

      expect(hasCrossWorkspaceAccess('agent-1', registry)).toBe(true);
    });

    it('should return true if agent has other agent in workspace config', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [{ path: 'agent-2' }],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [] },
        },
      ];
      registry = createMockRegistry(agents);

      expect(hasCrossWorkspaceAccess('agent-1', registry)).toBe(true);
    });
  });

  describe('getReadableAgents', () => {
    it('should include self if workspace enabled', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [{ path: '/project' }] },
        },
      ];
      registry = createMockRegistry(agents);

      const readable = getReadableAgents('agent-1', registry);
      expect(readable).toContain('agent-1');
    });

    it('should include other agents with read permission', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [
              {
                path: 'agent-2',
                permissions: {
                  read: true,
                  write: false,
                  delete: false,
                  list: true,
                },
              },
            ],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [] },
        },
      ];
      registry = createMockRegistry(agents);

      const readable = getReadableAgents('agent-1', registry);
      expect(readable).toContain('agent-1');
      expect(readable).toContain('agent-2');
    });
  });

  describe('getWritableAgents', () => {
    it('should include self if write permission', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            defaultPermissions: {
              read: true,
              write: true,
              delete: false,
              list: true,
            },
            workspaces: [{ path: '/project' }],
          },
        },
      ];
      registry = createMockRegistry(agents);

      const writable = getWritableAgents('agent-1', registry);
      expect(writable).toContain('agent-1');
    });

    it('should not include self if no write permission', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [{ path: '/project' }] },
        },
      ];
      registry = createMockRegistry(agents);

      const writable = getWritableAgents('agent-1', registry);
      expect(writable).not.toContain('agent-1');
    });

    it('should include other agents with write permission', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            workspaces: [
              {
                path: 'agent-2',
                permissions: {
                  read: true,
                  write: true,
                  delete: false,
                  list: true,
                },
              },
            ],
          },
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: { enabled: true, workspaces: [] },
        },
      ];
      registry = createMockRegistry(agents);

      const writable = getWritableAgents('agent-1', registry);
      expect(writable).toContain('agent-2');
    });
  });

  describe('canAccessWorkspace', () => {
    it('should return boolean for access check', () => {
      const agents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          enabled: true,
          systemPrompt: 'test',
          model: 'openai/gpt-4o-mini',
          version: 1,
          workspace: {
            enabled: true,
            defaultPermissions: {
              read: true,
              write: false,
              delete: false,
              list: true,
            },
            workspaces: [{ path: '/project' }],
          },
        },
      ];
      registry = createMockRegistry(agents);

      expect(canAccessWorkspace('agent-1', 'agent-1', 'read', registry)).toBe(
        true,
      );
      expect(canAccessWorkspace('agent-1', 'agent-1', 'write', registry)).toBe(
        false,
      );
    });
  });
});
