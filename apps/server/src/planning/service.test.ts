/**
 * Planning Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanningService, type PlanningServiceOptions } from './service';

// Mock types
type MockTask = {
  id: string;
  title: string;
  description: string;
  planningEnabled: boolean;
  planningStatus: string | null;
};

type MockSubtask = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  orderIndex: number;
};

describe('PlanningService', () => {
  let service: PlanningService;
  let mockProviders: {
    registry: { getDefault: ReturnType<typeof vi.fn> };
    invocation: { invoke: ReturnType<typeof vi.fn> };
  };
  let mockTasksRepo: {
    findById: ReturnType<typeof vi.fn>;
    updatePlanningStatus: ReturnType<typeof vi.fn>;
  };
  let mockSubtasksRepo: {
    create: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockProviders = {
      registry: {
        getDefault: vi.fn().mockReturnValue({
          providerId: 'openai',
          modelId: 'gpt-4',
        }),
      },
      invocation: {
        invoke: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'Subtask 1', description: 'First subtask', dependencies: [] },
              { title: 'Subtask 2', description: 'Second subtask', dependencies: [0] },
            ]),
          },
        }),
      },
    };

    mockTasksRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'task-1',
        title: 'Test Task',
        description: 'Test description',
        planningEnabled: true,
        planningStatus: null,
      } as MockTask),
      updatePlanningStatus: vi.fn().mockResolvedValue({}),
    };

    mockSubtasksRepo = {
      create: vi.fn().mockResolvedValue({
        id: 'subtask-1',
        taskId: 'task-1',
        title: 'Test Subtask',
        description: 'Test description',
        orderIndex: 0,
      } as MockSubtask),
    };

    const options: PlanningServiceOptions = {
      providers: mockProviders as any,
      tasksRepo: mockTasksRepo as any,
      subtasksRepo: mockSubtasksRepo as any,
    };

    service = new PlanningService(options);
  });

  describe('planTask', () => {
    it('plans a task and creates subtasks', async () => {
      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subtasks).toHaveLength(2);
        expect(result.subtasks[0]!.title).toBe('Subtask 1');
      }
    });

    it('updates planning status to completed on success', async () => {
      await service.planTask('task-1');

      expect(mockTasksRepo.updatePlanningStatus).toHaveBeenCalledWith('task-1', 'completed');
    });

    it('updates planning status to in_progress at start', async () => {
      await service.planTask('task-1');

      // First call should be 'in_progress'
      expect(mockTasksRepo.updatePlanningStatus).toHaveBeenCalledWith('task-1', 'in_progress');
    });

    it('updates planning status to failed on error', async () => {
      mockProviders.invocation.invoke.mockRejectedValueOnce(new Error('API error'));

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('planning.failed');
      }
      expect(mockTasksRepo.updatePlanningStatus).toHaveBeenCalledWith('task-1', 'failed');
    });

    it('returns error if task not found', async () => {
      mockTasksRepo.findById.mockResolvedValueOnce(null);

      const result = await service.planTask('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task.not_found');
      }
    });

    it('returns error if planning not enabled', async () => {
      mockTasksRepo.findById.mockResolvedValueOnce({
        id: 'task-1',
        planningEnabled: false,
      } as MockTask);

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('planning.not_enabled');
      }
    });
  });

  describe('parsePlanningResponse', () => {
    it('parses valid JSON array', () => {
      const content = '[{"title": "A", "description": "B", "dependencies": []}]';
      const result = service.parsePlanningResponse(content);

      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('A');
    });

    it('extracts JSON from markdown code blocks', () => {
      const content = 'Here are the subtasks:\n```json\n[{"title": "A", "description": "B"}]\n```';
      const result = service.parsePlanningResponse(content);

      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('A');
    });

    it('respects maxSubtasks limit', () => {
      const content = JSON.stringify([
        { title: 'A', description: 'A' },
        { title: 'B', description: 'B' },
        { title: 'C', description: 'C' },
      ]);
      const result = service.parsePlanningResponse(content, { maxSubtasks: 2 });

      expect(result).toHaveLength(2);
    });

    it('throws on invalid JSON', () => {
      const content = 'not valid json';

      expect(() => service.parsePlanningResponse(content)).toThrow('Failed to parse');
    });

    it('throws on non-array response', () => {
      const content = '{"not": "an array"}';

      expect(() => service.parsePlanningResponse(content)).toThrow('must be an array');
    });

    it('provides default values for missing fields', () => {
      const content = '[{"title": null, "description": null}]';
      const result = service.parsePlanningResponse(content);

      expect(result[0]!.title).toBe('Subtask 1');
      expect(result[0]!.description).toBe('');
    });
  });
});
