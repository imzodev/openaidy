import { describe, it, expect, vi } from 'vitest';
import { TaskScheduleService } from './schedule-service';
import type { TaskScheduleServiceDeps } from '../types';
import type { Task, TaskSchedule, TaskExecutionHistoryRow } from '@openaidy/db';

// ============================================================================
// Factories (in-memory fakes matching the DB shape)
// ============================================================================

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  description: 'A test task',
  status: 'todo',
  priority: 'medium',
  planningEnabled: false,
  planningStatus: null,
  sessionId: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

const makeSchedule = (overrides: Partial<TaskSchedule> = {}): TaskSchedule => ({
  id: 'sched-1',
  taskId: 'task-1',
  cronExpression: '0 9 * * *',
  preset: '1d',
  scheduleDate: null,
  nextRunAt: new Date('2026-06-05T09:00:00Z'),
  lastRunAt: null,
  status: 'active',
  replanPolicy: 'never',
  maxExecutions: 9999,
  executionCount: 0,
  descriptionHash: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

const makeHistoryRow = (
  overrides: Partial<TaskExecutionHistoryRow> = {},
): TaskExecutionHistoryRow => ({
  id: 'hist-1',
  taskId: 'task-1',
  scheduleId: 'sched-1',
  status: 'completed',
  startedAt: new Date('2026-06-05T09:00:00Z'),
  finishedAt: new Date('2026-06-05T09:05:00Z'),
  durationMs: 300000,
  sessionId: 'session-1',
  taskTitle: 'Test Task',
  taskDescription: 'A test task',
  didReplan: false,
  errorCode: null,
  errorMessage: null,
  attemptNumber: 1,
  subtaskSummary: null,
  createdAt: new Date('2026-06-05T09:00:00Z'),
  ...overrides,
});

// ============================================================================
// Harness
// ============================================================================

type ServiceMocks = {
  deps: TaskScheduleServiceDeps;
  tasksRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  taskSchedulesRepo: {
    findByTaskId: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  taskExecutionHistoryRepo: {
    listByTask: ReturnType<typeof vi.fn>;
  };
  taskScheduleExecutor: {
    triggerNow: ReturnType<typeof vi.fn>;
  };
};

function makeHarness(
  options: {
    task?: Task | null;
    schedule?: TaskSchedule | null;
    historyRows?: TaskExecutionHistoryRow[];
  } = {},
): {
  service: TaskScheduleService;
  mocks: ServiceMocks;
} {
  const task = options.task === undefined ? makeTask() : options.task;
  const schedule =
    options.schedule === undefined
      ? makeSchedule()
      : (options.schedule ?? null);
  const historyRows = options.historyRows ?? [];

  const tasksRepo = {
    findById: vi.fn().mockResolvedValue(task),
  };
  const taskSchedulesRepo = {
    findByTaskId: vi.fn().mockResolvedValue(schedule),
    findById: vi.fn().mockResolvedValue(schedule),
    create: vi.fn().mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...makeSchedule({
          id: 'sched-new',
          taskId: input.taskId as string,
          cronExpression: (input.cronExpression as string) ?? null,
          preset: (input.preset as string) ?? null,
          scheduleDate: (input.scheduleDate as Date) ?? null,
          nextRunAt: input.nextRunAt as Date,
          replanPolicy:
            (input.replanPolicy as TaskSchedule['replanPolicy']) ?? 'never',
          maxExecutions: (input.maxExecutions as number) ?? 9999,
        }),
      }),
    ),
    update: vi
      .fn()
      .mockImplementation((_id: string, updates: Record<string, unknown>) =>
        Promise.resolve({
          ...(schedule ?? makeSchedule()),
          ...updates,
        }),
      ),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const taskExecutionHistoryRepo = {
    listByTask: vi.fn().mockResolvedValue(historyRows),
  };
  const taskScheduleExecutor = {
    triggerNow: vi.fn().mockResolvedValue({
      ok: true,
      historyId: 'hist-triggered',
    }),
  };

  const deps: TaskScheduleServiceDeps = {
    tasksRepo: tasksRepo as unknown as TaskScheduleServiceDeps['tasksRepo'],
    taskSchedulesRepo:
      taskSchedulesRepo as unknown as TaskScheduleServiceDeps['taskSchedulesRepo'],
    taskExecutionHistoryRepo:
      taskExecutionHistoryRepo as unknown as TaskScheduleServiceDeps['taskExecutionHistoryRepo'],
    taskScheduleExecutor:
      taskScheduleExecutor as unknown as TaskScheduleServiceDeps['taskScheduleExecutor'],
  };

  const service = new TaskScheduleService(deps);

  return {
    service,
    mocks: {
      deps,
      tasksRepo,
      taskSchedulesRepo,
      taskExecutionHistoryRepo,
      taskScheduleExecutor,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TaskScheduleService', () => {
  // ========================================
  // createSchedule
  // ========================================

  describe('createSchedule', () => {
    it('creates a row with parsed cron and correct nextRunAt for "every" preset', async () => {
      const { service, mocks } = makeHarness({ schedule: null });

      const result = await service.createSchedule('task-1', {
        schedule: { every: '1d' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.cronExpression).toBe('0 0 * * *');
      expect(result.data.preset).toBe('1d');
      expect(result.data.nextRunAt).toBeDefined();
      expect(result.data.status).toBe('active');
      expect(mocks.taskSchedulesRepo.create).toHaveBeenCalledTimes(1);
    });

    it('defaults maxExecutions to 9999 when not provided', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.createSchedule('task-1', {
        schedule: { every: '1d' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.maxExecutions).toBe(9999);
      expect(result.data.remainingExecutions).toBe(9999);
    });

    it('defaults replanPolicy to "never" when not provided', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.createSchedule('task-1', {
        schedule: { every: '1d' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.replanPolicy).toBe('never');
    });

    it('rejects when task does not exist', async () => {
      const { service } = makeHarness({ task: null, schedule: null });

      const result = await service.createSchedule('task-1', {
        schedule: { every: '1d' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('task.not_found');
    });

    it('rejects when a schedule already exists for the task', async () => {
      const { service } = makeHarness();

      const result = await service.createSchedule('task-1', {
        schedule: { every: '1d' },
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.already_exists');
    });

    it('accepts cron expression via { cron } shorthand', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.createSchedule('task-1', {
        schedule: { cron: '*/5 * * * *' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.cronExpression).toBe('*/5 * * * *');
      expect(result.data.preset).toBeNull();
    });

    it('accepts one-shot via { at } shorthand', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.createSchedule('task-1', {
        schedule: { at: '2027-01-01T00:00:00Z' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.cronExpression).toBeNull();
      expect(result.data.preset).toBeNull();
      expect(result.data.scheduleDate).toBe('2027-01-01T00:00:00.000Z');
    });
  });

  // ========================================
  // updateSchedule
  // ========================================

  describe('updateSchedule', () => {
    it('updates cron and recomputes nextRunAt', async () => {
      const { service, mocks } = makeHarness();

      const result = await service.updateSchedule('task-1', {
        schedule: { every: '1h' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.cronExpression).toBe('0 * * * *');
      expect(result.data.preset).toBe('1h');
      expect(mocks.taskSchedulesRepo.update).toHaveBeenCalledTimes(1);
    });

    it('can change status to "paused"', async () => {
      const { service } = makeHarness();

      const result = await service.updateSchedule('task-1', {
        status: 'paused',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.status).toBe('paused');
    });

    it('cannot transition out of "expired"', async () => {
      const { service } = makeHarness({
        schedule: makeSchedule({ status: 'expired' }),
      });

      const result = await service.updateSchedule('task-1', {
        status: 'active',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.expired');
    });

    it('rejects maxExecutions that is not a positive integer (zero)', async () => {
      const { service } = makeHarness();

      const result = await service.updateSchedule('task-1', {
        maxExecutions: 0,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.invalid_max_executions');
    });

    it('rejects maxExecutions that is not a positive integer (negative)', async () => {
      const { service } = makeHarness();

      const result = await service.updateSchedule('task-1', {
        maxExecutions: -5,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.invalid_max_executions');
    });

    it('rejects maxExecutions that is not an integer (float)', async () => {
      const { service } = makeHarness();

      const result = await service.updateSchedule('task-1', {
        maxExecutions: 3.5,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.invalid_max_executions');
    });

    it('returns error when schedule does not exist', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.updateSchedule('task-1', {
        status: 'paused',
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.not_found');
    });
  });

  // ========================================
  // removeSchedule
  // ========================================

  describe('removeSchedule', () => {
    it('deletes the schedule row', async () => {
      const { service, mocks } = makeHarness();

      const result = await service.removeSchedule('task-1');

      expect(result.ok).toBe(true);
      expect(mocks.taskSchedulesRepo.delete).toHaveBeenCalledWith('sched-1');
    });

    it('returns error when schedule does not exist', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.removeSchedule('task-1');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.not_found');
    });
  });

  // ========================================
  // pause / resume
  // ========================================

  describe('pauseSchedule and resumeSchedule', () => {
    it('pauseSchedule toggles status to "paused"', async () => {
      const { service } = makeHarness();

      const result = await service.pauseSchedule('task-1');

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.status).toBe('paused');
    });

    it('resumeSchedule toggles status to "active"', async () => {
      const { service } = makeHarness({
        schedule: makeSchedule({ status: 'paused' }),
      });

      const result = await service.resumeSchedule('task-1');

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.status).toBe('active');
    });

    it('resumeSchedule fails for expired schedule', async () => {
      const { service } = makeHarness({
        schedule: makeSchedule({ status: 'expired' }),
      });

      const result = await service.resumeSchedule('task-1');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.expired');
    });
  });

  // ========================================
  // triggerNow
  // ========================================

  describe('triggerNow', () => {
    it('delegates to the executor and returns the history ID', async () => {
      const { service, mocks } = makeHarness();

      const result = await service.triggerNow('task-1');

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.historyId).toBe('hist-triggered');
      expect(mocks.taskScheduleExecutor.triggerNow).toHaveBeenCalledWith(
        'sched-1',
      );
    });

    it('returns error when schedule does not exist', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.triggerNow('task-1');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.not_found');
    });

    it('returns error when executor fails', async () => {
      const { service, mocks } = makeHarness();
      mocks.taskScheduleExecutor.triggerNow.mockResolvedValue({
        ok: false,
        error: 'Executor crashed',
      });

      const result = await service.triggerNow('task-1');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('execution.failed');
    });
  });

  // ========================================
  // getScheduleForTask / getScheduleById
  // ========================================

  describe('getScheduleForTask', () => {
    it('returns the schedule DTO when it exists', async () => {
      const { service } = makeHarness();

      const result = await service.getScheduleForTask('task-1');

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.id).toBe('sched-1');
      expect(result.data.taskId).toBe('task-1');
    });

    it('returns error when no schedule exists', async () => {
      const { service } = makeHarness({ schedule: null });

      const result = await service.getScheduleForTask('task-1');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.code).toBe('schedule.not_found');
    });
  });

  // ========================================
  // listExecutions
  // ========================================

  describe('listExecutions', () => {
    it('paginates correctly', async () => {
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeHistoryRow({
          id: `hist-${i + 1}`,
          startedAt: new Date(`2026-06-0${i + 1}T09:00:00Z`),
          finishedAt: new Date(`2026-06-0${i + 1}T09:05:00Z`),
        }),
      );
      const { service } = makeHarness({ historyRows: rows });

      const result = await service.listExecutions('task-1', {
        limit: 5,
        offset: 0,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.total).toBe(10);
      expect(result.data.items).toHaveLength(5);
      expect(result.data.limit).toBe(5);
      expect(result.data.offset).toBe(0);
    });

    it('uses default limit of 20', async () => {
      const { service } = makeHarness({ historyRows: [] });

      const result = await service.listExecutions('task-1');

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    });

    it('filters by status', async () => {
      const rows = [
        makeHistoryRow({ id: 'hist-1', status: 'completed' }),
        makeHistoryRow({ id: 'hist-2', status: 'failed' }),
        makeHistoryRow({ id: 'hist-3', status: 'completed' }),
      ];
      const { service } = makeHarness({ historyRows: rows });

      const result = await service.listExecutions('task-1', {
        status: 'completed',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.total).toBe(2);
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items.every((r) => r.status === 'completed')).toBe(
        true,
      );
    });

    it('respects offset for second page', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        makeHistoryRow({ id: `hist-${i + 1}` }),
      );
      const { service } = makeHarness({ historyRows: rows });

      const result = await service.listExecutions('task-1', {
        limit: 2,
        offset: 2,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.total).toBe(5);
      expect(result.data.items).toHaveLength(2);
      expect(result.data.offset).toBe(2);
    });
  });

  // ========================================
  // DTO mapper: remainingExecutions
  // ========================================

  describe('DTO mapper (via service)', () => {
    it('computes remainingExecutions = max(0, maxExecutions - executionCount)', async () => {
      const { service } = makeHarness({
        schedule: makeSchedule({ maxExecutions: 10, executionCount: 3 }),
      });

      const result = await service.getScheduleForTask('task-1');

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.maxExecutions).toBe(10);
      expect(result.data.executionCount).toBe(3);
      expect(result.data.remainingExecutions).toBe(7);
    });

    it('clamps remainingExecutions to 0 when executionCount exceeds max', async () => {
      const { service } = makeHarness({
        schedule: makeSchedule({ maxExecutions: 5, executionCount: 10 }),
      });

      const result = await service.getScheduleForTask('task-1');

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.remainingExecutions).toBe(0);
    });
  });
});
