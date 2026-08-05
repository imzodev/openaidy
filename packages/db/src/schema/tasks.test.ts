import { describe, it, expect } from 'vitest';
import {
  tasks,
  subtasks,
  subtaskEdges,
  taskAgents,
  taskStatusEnum,
  taskPriorityEnum,
  planningStatusEnum,
  subtaskStatusEnum,
  agentRoleEnum,
} from './tasks';

describe('Tasks Schema', () => {
  describe('taskStatusEnum', () => {
    it('should define all required statuses', () => {
      const statuses = taskStatusEnum.enumValues;
      expect(statuses).toContain('backlog');
      expect(statuses).toContain('todo');
      expect(statuses).toContain('in_progress');
      expect(statuses).toContain('review');
      expect(statuses).toContain('done');
      expect(statuses).toContain('cancelled');
    });
  });

  describe('taskPriorityEnum', () => {
    it('should define all required priorities', () => {
      const priorities = taskPriorityEnum.enumValues;
      expect(priorities).toContain('low');
      expect(priorities).toContain('medium');
      expect(priorities).toContain('high');
      expect(priorities).toContain('urgent');
    });
  });

  describe('planningStatusEnum', () => {
    it('should define all required planning statuses', () => {
      const statuses = planningStatusEnum.enumValues;
      expect(statuses).toContain('pending');
      expect(statuses).toContain('in_progress');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('failed');
    });
  });

  describe('subtaskStatusEnum', () => {
    it('should define all required subtask statuses', () => {
      const statuses = subtaskStatusEnum.enumValues;
      expect(statuses).toContain('pending');
      expect(statuses).toContain('assigned');
      expect(statuses).toContain('in_progress');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('failed');
    });
  });

  describe('agentRoleEnum', () => {
    it('should define all required agent roles', () => {
      const roles = agentRoleEnum.enumValues;
      expect(roles).toContain('primary');
      expect(roles).toContain('secondary');
      expect(roles).toContain('reviewer');
    });
  });

  describe('tasks table', () => {
    it('should have required columns', () => {
      const columns = Object.keys(tasks);
      expect(columns).toContain('id');
      expect(columns).toContain('title');
      expect(columns).toContain('description');
      expect(columns).toContain('status');
      expect(columns).toContain('priority');
      expect(columns).toContain('planningEnabled');
      expect(columns).toContain('planningStatus');
      expect(columns).toContain('createdAt');
      expect(columns).toContain('updatedAt');
    });
  });

  describe('subtasks table', () => {
    it('should have required columns including foreign keys', () => {
      const columns = Object.keys(subtasks);
      expect(columns).toContain('id');
      expect(columns).toContain('taskId');
      expect(columns).toContain('title');
      expect(columns).toContain('description');
      expect(columns).toContain('status');
      expect(columns).toContain('assignedAgentId');
      expect(columns).toContain('orderIndex');
      expect(columns).toContain('result');
      expect(columns).toContain('createdAt');
      expect(columns).toContain('updatedAt');
    });
  });

  describe('subtaskEdges table', () => {
    it('should have required columns for a dependency graph', () => {
      const columns = Object.keys(subtaskEdges);
      expect(columns).toContain('id');
      expect(columns).toContain('subtaskId');
      expect(columns).toContain('dependsOnSubtaskId');
      expect(columns).toContain('edgeKind');
      expect(columns).toContain('createdAt');
    });
  });

  describe('taskAgents table', () => {
    it('should have composite primary key columns', () => {
      const columns = Object.keys(taskAgents);
      expect(columns).toContain('taskId');
      expect(columns).toContain('agentId');
      expect(columns).toContain('role');
      expect(columns).toContain('assignedAt');
    });
  });
});
