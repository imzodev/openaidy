/**
 * Planning Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanningService, type PlanningServiceOptions } from './service';
import { buildPlanningPrompt, buildComplexityPrompt } from './prompts';
import type { TasksRepository, SubtasksRepository, Task } from '@openaidy/db';
import type { ProviderServices } from '../providers';
import type { AgentRegistry } from '../agents';

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

const makeProviders = (overrides?: {
  getDefault?: ReturnType<typeof vi.fn>;
  invoke?: ReturnType<typeof vi.fn>;
}) => ({
  registry: {
    getDefault:
      overrides?.getDefault ??
      vi.fn().mockReturnValue({ providerId: 'openai', modelId: 'gpt-4' }),
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
            },
            {
              title: 'Subtask 2',
              description: 'Second subtask',
              dependencies: [0],
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
  create: vi.fn().mockResolvedValue({
    id: 'subtask-1',
    taskId: 'task-1',
    title: 'Test Subtask',
    description: 'Test description',
    orderIndex: 0,
  } as MockSubtask),
  deleteByTask: vi.fn().mockResolvedValue([]),
});

describe('PlanningService', () => {
  let service: PlanningService;
  let mockProviders: ReturnType<typeof makeProviders>;
  let mockTasksRepo: ReturnType<typeof makeTasksRepo>;
  let mockSubtasksRepo: ReturnType<typeof makeSubtasksRepo>;

  beforeEach(() => {
    mockProviders = makeProviders();
    mockTasksRepo = makeTasksRepo();
    mockSubtasksRepo = makeSubtasksRepo();

    const options: PlanningServiceOptions = {
      providers: mockProviders as unknown as ProviderServices,
      tasksRepo: mockTasksRepo as unknown as TasksRepository,
      subtasksRepo: mockSubtasksRepo as unknown as SubtasksRepository,
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

      expect(mockTasksRepo.updatePlanningStatus).toHaveBeenCalledWith(
        'task-1',
        'completed',
      );
    });

    it('updates planning status to in_progress at start', async () => {
      await service.planTask('task-1');

      // First call should be 'in_progress'
      expect(mockTasksRepo.updatePlanningStatus).toHaveBeenCalledWith(
        'task-1',
        'in_progress',
      );
    });

    it('updates planning status to failed on error', async () => {
      // First call is assessComplexity (succeeds with default), second call is the planning invoke (fails)
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: '{"complexity":"simple","maxSubtasks":2}' },
        })
        .mockRejectedValueOnce(new Error('API error'));

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('planning.failed');
      }
      expect(mockTasksRepo.updatePlanningStatus).toHaveBeenCalledWith(
        'task-1',
        'failed',
      );
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

  describe('assessComplexity (via planTask)', () => {
    it('constrains to 2 subtasks for simple tasks', async () => {
      // Complexity call returns simple, planning call returns 2 subtasks
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: '{"complexity":"simple","maxSubtasks":2}' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'A', description: 'Step A', dependencies: [] },
              { title: 'B', description: 'Step B', dependencies: [0] },
            ]),
          },
        });

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subtasks).toHaveLength(2);
      }
      // Verify the planning prompt used maxSubtasks=2
      expect(mockProviders.invocation.invoke).toHaveBeenCalledTimes(2);
    });

    it('constrains to 4 subtasks for moderate tasks', async () => {
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: '{"complexity":"moderate","maxSubtasks":4}' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'A', description: 'Step A', dependencies: [] },
              { title: 'B', description: 'Step B', dependencies: [0] },
              { title: 'C', description: 'Step C', dependencies: [1] },
              { title: 'D', description: 'Step D', dependencies: [2] },
            ]),
          },
        });

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subtasks).toHaveLength(4);
      }
    });

    it('constrains to 8 subtasks for complex tasks', async () => {
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: '{"complexity":"complex","maxSubtasks":8}' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'A', description: 'Step A', dependencies: [] },
              { title: 'B', description: 'Step B', dependencies: [0] },
              { title: 'C', description: 'Step C', dependencies: [1] },
              { title: 'D', description: 'Step D', dependencies: [2] },
              { title: 'E', description: 'Step E', dependencies: [3] },
              { title: 'F', description: 'Step F', dependencies: [4] },
              { title: 'G', description: 'Step G', dependencies: [5] },
              { title: 'H', description: 'Step H', dependencies: [6] },
            ]),
          },
        });

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subtasks).toHaveLength(8);
      }
    });

    it('falls back to default maxSubtasks when complexity call fails', async () => {
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: false,
          error: { code: 'provider.error', message: 'fail' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'A', description: 'Step A', dependencies: [] },
            ]),
          },
        });

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subtasks).toHaveLength(1);
      }
    });

    it('falls back to default when complexity response has no valid maxSubtasks', async () => {
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: 'some nonsense without json' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'A', description: 'Step A', dependencies: [] },
            ]),
          },
        });

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subtasks).toHaveLength(1);
      }
    });

    it('falls back to default when complexity provider throws', async () => {
      mockProviders.invocation.invoke
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'A', description: 'Step A', dependencies: [] },
            ]),
          },
        });

      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.subtasks).toHaveLength(1);
      }
    });
  });

  describe('model resolution via default agent', () => {
    it('uses the default agent model when configured', async () => {
      const noDefaultProvider = makeProviders({
        getDefault: vi.fn().mockReturnValue(null),
      });
      const agentRegistry = {
        getAgent: vi
          .fn()
          .mockReturnValue({ id: 'default', model: 'openai/gpt-4o' }),
        listAllAgents: vi.fn().mockReturnValue([]),
      };

      const svc = new PlanningService({
        providers: noDefaultProvider as unknown as ProviderServices,
        tasksRepo: makeTasksRepo() as unknown as TasksRepository,
        subtasksRepo: makeSubtasksRepo() as unknown as SubtasksRepository,
        agents: agentRegistry as unknown as AgentRegistry,
        getDefaultAgentId: () => 'default',
      });

      const result = await svc.planTask('task-1');

      expect(result.ok).toBe(true);
      expect(noDefaultProvider.invocation.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o' }),
        { providerId: 'openai' },
      );
    });

    it('falls back to default provider when no agent configured', async () => {
      const result = await service.planTask('task-1');

      expect(result.ok).toBe(true);
      expect(mockProviders.invocation.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4' }),
        { providerId: 'openai' },
      );
    });

    it('returns error when neither agent nor provider is configured', async () => {
      const noConfig = makeProviders({
        getDefault: vi.fn().mockReturnValue(null),
      });

      const svc = new PlanningService({
        providers: noConfig as unknown as ProviderServices,
        tasksRepo: makeTasksRepo() as unknown as TasksRepository,
        subtasksRepo: makeSubtasksRepo() as unknown as SubtasksRepository,
      });

      const result = await svc.planTask('task-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('planning.failed');
        expect(result.error.message).toMatch(/No model configured/);
      }
    });

    it('ignores agent with unparseable model string and falls back to provider', async () => {
      const agentRegistry = {
        getAgent: vi
          .fn()
          .mockReturnValue({ id: 'default', model: 'bad-model-no-slash' }),
        listAllAgents: vi.fn().mockReturnValue([]),
      };

      const svc = new PlanningService({
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: makeTasksRepo() as unknown as TasksRepository,
        subtasksRepo: makeSubtasksRepo() as unknown as SubtasksRepository,
        agents: agentRegistry as unknown as AgentRegistry,
        getDefaultAgentId: () => 'default',
      });

      const result = await svc.planTask('task-1');

      expect(result.ok).toBe(true);
      expect(mockProviders.invocation.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4' }),
        { providerId: 'openai' },
      );
    });

    it('ignores getDefaultAgentId returning undefined and falls back to provider', async () => {
      const svc = new PlanningService({
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: makeTasksRepo() as unknown as TasksRepository,
        subtasksRepo: makeSubtasksRepo() as unknown as SubtasksRepository,
        getDefaultAgentId: () => undefined,
      });

      const result = await svc.planTask('task-1');

      expect(result.ok).toBe(true);
    });
  });

  describe('parsePlanningResponse', () => {
    it('parses valid JSON array', () => {
      const content =
        '[{"title": "A", "description": "B", "dependencies": []}]';
      const result = service.parsePlanningResponse(content);

      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0]!.title).toBe('A');
    });

    it('extracts JSON from markdown code blocks', () => {
      const content =
        'Here are the subtasks:\n```json\n[{"title": "A", "description": "B"}]\n```';
      const result = service.parsePlanningResponse(content);

      expect(result.subtasks).toHaveLength(1);
      expect(result.subtasks[0]!.title).toBe('A');
    });

    it('respects maxSubtasks limit', () => {
      const content = JSON.stringify([
        { title: 'A', description: 'A' },
        { title: 'B', description: 'B' },
        { title: 'C', description: 'C' },
      ]);
      const result = service.parsePlanningResponse(content, { maxSubtasks: 2 });

      expect(result.subtasks).toHaveLength(2);
    });

    it('throws on invalid JSON', () => {
      const content = 'not valid json';

      expect(() => service.parsePlanningResponse(content)).toThrow(
        'Failed to parse',
      );
    });

    it('throws on non-array response', () => {
      const content = '{"not": "an array"}';

      expect(() => service.parsePlanningResponse(content)).toThrow(
        'must be an array',
      );
    });

    it('provides default values for missing fields', () => {
      const content = '[{"title": null, "description": null}]';
      const result = service.parsePlanningResponse(content);

      expect(result.subtasks[0]?.title).toBe('Subtask 1');
      expect(result.subtasks[0]?.description).toBe('');
    });
  });

  describe('buildPlanningPrompt', () => {
    it('includes the maxSubtasks in the prompt', () => {
      const task = {
        id: 't1',
        title: 'Test',
        description: 'Do something',
      } as MockTask;
      const prompt = buildPlanningPrompt(task as unknown as Task, 3);

      expect(prompt).toContain('1-3 subtasks');
      expect(prompt).toContain('use as FEW as needed');
    });

    it('defaults to 10 when no maxSubtasks provided', () => {
      const task = {
        id: 't1',
        title: 'Test',
        description: 'Do something',
      } as MockTask;
      const prompt = buildPlanningPrompt(task as unknown as Task);

      expect(prompt).toContain('1-10 subtasks');
    });

    it('includes task title and description', () => {
      const task = {
        id: 't1',
        title: 'My Task',
        description: 'Build a thing',
      } as MockTask;
      const prompt = buildPlanningPrompt(task as unknown as Task, 2);

      expect(prompt).toContain('My Task');
      expect(prompt).toContain('Build a thing');
    });
  });

  describe('buildComplexityPrompt', () => {
    it('includes task title and description', () => {
      const task = {
        id: 't1',
        title: 'Test',
        description: 'Fix a typo',
      } as MockTask;
      const prompt = buildComplexityPrompt(task as unknown as Task);

      expect(prompt).toContain('Test');
      expect(prompt).toContain('Fix a typo');
    });

    it('includes complexity levels and their maxSubtasks', () => {
      const task = { id: 't1', title: 'T', description: 'D' } as MockTask;
      const prompt = buildComplexityPrompt(task as unknown as Task);

      expect(prompt).toContain('"simple"');
      expect(prompt).toContain('"moderate"');
      expect(prompt).toContain('"complex"');
      expect(prompt).toContain('maxSubtasks');
    });
  });

  describe('re-planning', () => {
    it('deletes existing subtasks before creating new ones on re-plan', async () => {
      // Reset all mocks to ensure clean state
      vi.clearAllMocks();

      mockSubtasksRepo.deleteByTask = vi.fn().mockResolvedValue([]);

      // Each planTask makes 2 invoke calls: assessComplexity + planning
      // First plan
      mockProviders.invocation.invoke
        .mockResolvedValueOnce({
          ok: true,
          value: { content: '{"complexity":"simple","maxSubtasks":2}' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            content: JSON.stringify([
              { title: 'Subtask 1', description: 'First', dependencies: [] },
              { title: 'Subtask 2', description: 'Second', dependencies: [0] },
            ]),
          },
        });

      // First plan
      const firstResult = await service.planTask('task-1');
      expect(firstResult.ok).toBe(true);
      expect(mockSubtasksRepo.create).toHaveBeenCalledTimes(2);

      // Reset mocks for second plan
      mockSubtasksRepo.create.mockClear();
      mockSubtasksRepo.deleteByTask.mockClear();
      mockProviders.invocation.invoke.mockClear();

      // Second plan (re-plan): complexity assessment + actual planning with new subtasks
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
                title: 'New Subtask 1',
                description: 'First',
                dependencies: [],
              },
              {
                title: 'New Subtask 2',
                description: 'Second',
                dependencies: [0],
              },
            ]),
          },
        });

      // Second plan (re-plan)
      const secondResult = await service.planTask('task-1');
      expect(secondResult.ok).toBe(true);
      // deleteByTask should have been called before creating new subtasks
      expect(mockSubtasksRepo.deleteByTask).toHaveBeenCalledWith('task-1');
      expect(mockSubtasksRepo.create).toHaveBeenCalledTimes(2);
    });

    it('clears existing agent assignments before re-assigning on re-plan', async () => {
      const mockTaskAgentsRepo = {
        removeAllFromTask: vi.fn().mockResolvedValue([]),
        assignMultiple: vi.fn().mockResolvedValue([]),
      };

      const svc = new PlanningService({
        providers: mockProviders as unknown as ProviderServices,
        tasksRepo: mockTasksRepo as unknown as TasksRepository,
        subtasksRepo: mockSubtasksRepo as unknown as SubtasksRepository,
        taskAgentsRepo: mockTaskAgentsRepo as never,
      });

      // Set up invoke to return subtasks with assigned agents
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
                description: 'First',
                assignedAgentId: 'agent-1',
                dependencies: [],
              },
              {
                title: 'Subtask 2',
                description: 'Second',
                assignedAgentId: 'agent-2',
                dependencies: [0],
              },
            ]),
          },
        });

      await svc.planTask('task-1');

      // On re-plan, removeAllFromTask should be called before assignMultiple
      expect(mockTaskAgentsRepo.removeAllFromTask).toHaveBeenCalledWith(
        'task-1',
      );
      expect(mockTaskAgentsRepo.assignMultiple).toHaveBeenCalled();
    });
  });
});
