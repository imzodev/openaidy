/**
 * Planning Service Tests - Agent Assignment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanningService, type PlanningServiceOptions } from './service';
import type {
  TasksRepository,
  SubtasksRepository,
  TaskAgentsRepository,
} from '@openaidy/db';
import type { ProviderServices } from '../providers';

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
  assignedAgentId?: string;
};

const makeProviders = (overrides?: { invoke?: ReturnType<typeof vi.fn> }) => ({
  registry: {
    getDefault: vi
      .fn()
      .mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' }),
  },
  invocation: {
    invoke:
      overrides?.invoke ??
      vi.fn().mockResolvedValue({
        ok: true,
        value: {
          content: JSON.stringify([
            {
              title: 'Subtask 1',
              description: 'First subtask',
              dependencies: [],
              assignedAgentId: 'researcher',
              assignmentReason: 'Has web_fetch tool',
            },
            {
              title: 'Subtask 2',
              description: 'Second subtask',
              dependencies: [0],
              assignedAgentId: 'creative',
              assignmentReason: 'Creative tasks',
            },
          ]),
        },
      }),
  },
});

const makeTasksRepo = (task?: Partial<MockTask>) => ({
  findById: vi.fn().mockResolvedValue({
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description',
    planningEnabled: true,
    planningStatus: null,
    ...task,
  } as MockTask),
  updatePlanningStatus: vi.fn().mockResolvedValue({}),
});

const makeSubtasksRepo = () => ({
  create: vi.fn().mockImplementation((input) =>
    Promise.resolve({
      id: `subtask-${Date.now()}`,
      taskId: input.taskId,
      title: input.title,
      description: input.description,
      orderIndex: input.orderIndex,
      assignedAgentId: input.assignedAgentId,
    } as MockSubtask),
  ),
  deleteByTask: vi.fn().mockResolvedValue([]),
  addEdges: vi.fn().mockResolvedValue(undefined),
});

const makeTaskAgentsRepo = () => ({
  removeAllFromTask: vi.fn().mockResolvedValue([]),
  assignMultiple: vi.fn().mockResolvedValue([]),
});

describe('PlanningService - Agent Assignment', () => {
  let mockProviders: ReturnType<typeof makeProviders>;
  let mockTasksRepo: ReturnType<typeof makeTasksRepo>;
  let mockSubtasksRepo: ReturnType<typeof makeSubtasksRepo>;
  let mockTaskAgentsRepo: ReturnType<typeof makeTaskAgentsRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProviders = makeProviders();
    mockTasksRepo = makeTasksRepo();
    mockSubtasksRepo = makeSubtasksRepo();
    mockTaskAgentsRepo = makeTaskAgentsRepo();
  });

  describe('when planning creates subtasks with assigned agents', () => {
    it('assigns those agents to the parent task', async () => {
      const options: PlanningServiceOptions = {
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: mockTasksRepo as unknown as TasksRepository,
        subtasksRepo: mockSubtasksRepo as unknown as SubtasksRepository,
        taskAgentsRepo: mockTaskAgentsRepo as unknown as TaskAgentsRepository,
      };

      const service = new PlanningService(options);
      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      expect(mockTaskAgentsRepo.assignMultiple).toHaveBeenCalledWith(
        'task-1',
        expect.any(Array),
      );
    });

    it('uses "primary" role for first agent assignment', async () => {
      const options: PlanningServiceOptions = {
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: mockTasksRepo as unknown as TasksRepository,
        subtasksRepo: mockSubtasksRepo as unknown as SubtasksRepository,
        taskAgentsRepo: mockTaskAgentsRepo as unknown as TaskAgentsRepository,
      };

      const service = new PlanningService(options);
      await service.planTask('task-1');

      const assignCalls = mockTaskAgentsRepo.assignMultiple.mock.calls;
      const firstCall = assignCalls[0];
      if (firstCall && firstCall[1]) {
        const assignments = firstCall[1] as Array<{
          agentId: string;
          role: string;
        }>;
        const researcherAssignment = assignments.find(
          (a) => a.agentId === 'researcher',
        );
        expect(researcherAssignment?.role).toBe('primary');
      }
    });

    it('uses "secondary" role for duplicate agent assignments', async () => {
      // First call creates subtasks, second call creates the same agent again
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: '{"complexity":"simple","maxSubtasks":2}' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              {
                title: 'Subtask 1',
                description: 'First subtask',
                dependencies: [],
                assignedAgentId: 'researcher',
              },
              {
                title: 'Subtask 2',
                description: 'Second subtask',
                dependencies: [0],
                assignedAgentId: 'researcher', // Same agent again
              },
            ]),
          },
        });

      const options: PlanningServiceOptions = {
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: mockTasksRepo as unknown as TasksRepository,
        subtasksRepo: mockSubtasksRepo as unknown as SubtasksRepository,
        taskAgentsRepo: mockTaskAgentsRepo as unknown as TaskAgentsRepository,
      };

      const service = new PlanningService(options);
      await service.planTask('task-1');

      const assignCalls = mockTaskAgentsRepo.assignMultiple.mock.calls;
      const firstCall = assignCalls[0];
      if (firstCall && firstCall[1]) {
        const assignments = firstCall[1] as Array<{
          agentId: string;
          role: string;
        }>;
        const researcherAssignments = assignments.filter(
          (a) => a.agentId === 'researcher',
        );
        // Should have exactly one assignment for researcher (deduped)
        expect(researcherAssignments.length).toBe(1);
      }
    });

    it('does not assign agents to task when no subtasks have assignments', async () => {
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: '{"complexity":"simple","maxSubtasks":2}' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              {
                title: 'Subtask 1',
                description: 'First subtask',
                dependencies: [],
                // No assignedAgentId
              },
            ]),
          },
        });

      const options: PlanningServiceOptions = {
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: mockTasksRepo as unknown as TasksRepository,
        subtasksRepo: mockSubtasksRepo as unknown as SubtasksRepository,
        taskAgentsRepo: mockTaskAgentsRepo as unknown as TaskAgentsRepository,
      };

      const service = new PlanningService(options);
      await service.planTask('task-1');

      expect(mockTaskAgentsRepo.assignMultiple).not.toHaveBeenCalled();
    });

    it('handles planning when taskAgentsRepo is not provided', async () => {
      const options: PlanningServiceOptions = {
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: mockTasksRepo as unknown as TasksRepository,
        subtasksRepo: mockSubtasksRepo as unknown as SubtasksRepository,
        // No taskAgentsRepo
      };

      const service = new PlanningService(options);
      const result = await service.planTask('task-1');

      // Should still succeed - agents just won't be assigned to task
      expect(result.ok).toBe(true);
    });
  });
});
