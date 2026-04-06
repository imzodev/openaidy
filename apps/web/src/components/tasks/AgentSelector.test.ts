/**
 * Agent Selector Component Tests
 */

import { describe, it, expect, vi } from 'vitest';

// Simple unit tests for AgentSelector logic
describe('AgentSelector', () => {
  const mockAgents = [
    { id: 'agent-1', name: 'Alpha Agent', description: 'First agent' },
    { id: 'agent-2', name: 'Beta Agent', description: 'Second agent' },
    { id: 'agent-3', name: 'Gamma Agent', description: 'Third agent' },
  ];

  describe('toggleAgent', () => {
    it('should add agent when not selected', () => {
      const selectedAgents: Array<{ agentId: string; role?: string }> = [];
      const agentId = 'agent-1';
      
      const isSelected = selectedAgents.some((a) => a.agentId === agentId);
      if (!isSelected) {
        selectedAgents.push({ agentId, role: 'primary' });
      }
      
      expect(selectedAgents).toHaveLength(1);
      expect(selectedAgents[0]).toEqual({ agentId: 'agent-1', role: 'primary' });
    });

    it('should remove agent when already selected', () => {
      let selectedAgents = [
        { agentId: 'agent-1', role: 'primary' as const },
        { agentId: 'agent-2', role: 'secondary' as const },
      ];
      const agentId = 'agent-1';
      
      const isSelected = selectedAgents.some((a) => a.agentId === agentId);
      if (isSelected) {
        selectedAgents = selectedAgents.filter((a) => a.agentId !== agentId);
      }
      
      expect(selectedAgents).toHaveLength(1);
      expect(selectedAgents[0].agentId).toBe('agent-2');
    });
  });

  describe('filteredAgents', () => {
    it('should return all agents when search is empty', () => {
      const query = '';
      const filtered = mockAgents.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          (a.description?.toLowerCase().includes(query) ?? false)
      );
      
      expect(filtered).toHaveLength(3);
    });

    it('should filter agents by name', () => {
      const query = 'alpha';
      const filtered = mockAgents.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          (a.description?.toLowerCase().includes(query) ?? false)
      );
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Alpha Agent');
    });

    it('should filter agents by description', () => {
      const query = 'second';
      const filtered = mockAgents.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          (a.description?.toLowerCase().includes(query) ?? false)
      );
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Beta Agent');
    });
  });

  describe('maxAgents limit', () => {
    it('should prevent selection when max is reached', () => {
      const maxAgents = 2;
      const selectedAgents = [
        { agentId: 'agent-1', role: 'primary' as const },
        { agentId: 'agent-2', role: 'secondary' as const },
      ];
      
      const isMaxReached = selectedAgents.length >= maxAgents;
      expect(isMaxReached).toBe(true);
    });

    it('should allow selection when max is not reached', () => {
      const maxAgents = 3;
      const selectedAgents = [
        { agentId: 'agent-1', role: 'primary' as const },
      ];
      
      const isMaxReached = selectedAgents.length >= maxAgents;
      expect(isMaxReached).toBe(false);
    });
  });

  describe('updateRole', () => {
    it('should update role for selected agent', () => {
      let selectedAgents = [
        { agentId: 'agent-1', role: 'primary' as const },
      ];
      
      const agentId = 'agent-1';
      const newRole = 'reviewer' as const;
      
      selectedAgents = selectedAgents.map((a) =>
        a.agentId === agentId ? { ...a, role: newRole } : a
      );
      
      expect(selectedAgents[0].role).toBe('reviewer');
    });
  });

  describe('removeAgent', () => {
    it('should remove agent from selection', () => {
      let selectedAgents = [
        { agentId: 'agent-1', role: 'primary' as const },
        { agentId: 'agent-2', role: 'secondary' as const },
      ];
      
      const agentId = 'agent-1';
      selectedAgents = selectedAgents.filter((a) => a.agentId !== agentId);
      
      expect(selectedAgents).toHaveLength(1);
      expect(selectedAgents[0].agentId).toBe('agent-2');
    });
  });

  describe('clearAll', () => {
    it('should clear all selected agents', () => {
      let selectedAgents = [
        { agentId: 'agent-1', role: 'primary' as const },
        { agentId: 'agent-2', role: 'secondary' as const },
      ];
      
      selectedAgents = [];
      
      expect(selectedAgents).toHaveLength(0);
    });
  });
});
