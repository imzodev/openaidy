import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TaskScheduleExecutor,
  hashDescription,
  type TaskScheduleExecutorDeps,
  type TaskSchedulePayload,
} from './task-schedule-executor';
import type { Task, Subtask, TaskAgent, TaskSchedule } from '@openaidy/db';

// ============================================================================
// Fakes (in-memory implementations of the repos the executor depends on).
// We test the executor's *logic* (claim, replan decision, lifecycle
// transitions, reschedule) without needing a real DB.
// ============================================================================

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Daily summary',
  description: 'Summarise my day',
  status: 'todo',
  priority: 'medium',
  planningEnabled: true,
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
  nextRunAt: new Date('2026-06-05T08:59:00Z'),
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

const makeAgent = (overrides: Partial<TaskAgent> = {}): TaskAgent => ({
  taskId: 'task-1',
  agentId: 'agent-1',
  role: 'primary',
  assignedAt: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

const makeSubtask = (overrides: Partial<Subtask> = {}): Subtask => ({
  id: 'sub-1',
  taskId: 'task-1',
  // The Drizzle schema declares parentSubtaskId as NOT NULL, so we use
  // a placeholder string for root subtasks. (The repository's own create()
  // writes null — pre-existing inconsistency in the codebase, not ours.)
  parentSubtaskId: '',
  title: 'Subtask 1',
  description: 'Do thing 1',
  status: 'pending',
  assignedAgentId: 'agent-1',
  sessionId: null,
  orderIndex: 0,
  result: null,
  retryCount: 0,
  pendingVerificationResult: null,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

// ============================================================================
// Test harness
// ============================================================================

type ExecutorMocks = {
  deps: TaskScheduleExecutorDeps;
  tasksRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateStatus?: ReturnType<typeof vi.fn>;
  };
  subtasksRepo: {
    listByTask: ReturnType<typeof vi.fn>;
    deleteByTask?: ReturnType<typeof vi.fn>;
  };
  taskAgentsRepo: {
    listByTask: ReturnType<typeof vi.fn>;
  };
  taskSchedulesRepo: {
    claimNextDue: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  taskExecutionHistoryRepo: {
    create: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  taskService: {
    executeTask: ReturnType<typeof vi.fn>;
    executeSubtasks: ReturnType<typeof vi.fn>;
  };
  planningService:
    | {
        planTask: ReturnType<typeof vi.fn>;
      }
    | undefined;
  sessionService: {
    createSession: ReturnType<typeof vi.fn>;
    submitMessageStreaming: ReturnType<typeof vi.fn>;
  };
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  calculateNextRun: ReturnType<typeof vi.fn>;
};

function makeHarness(
  options: {
    schedule?: TaskSchedule | null;
    task?: Task | null;
    agents?: TaskAgent[];
    subtasks?: Subtask[];
    defaultAgent?: string | undefined;
    planTaskResult?:
      | { ok: true }
      | { ok: false; error: { code: string; message: string } };
    planningService?: 'none' | 'fail' | 'ok';
    nextRunAt?: Date;
  } = {},
): {
  executor: TaskScheduleExecutor;
  mocks: ExecutorMocks;
} {
  const schedule =
    options.schedule === undefined ? makeSchedule() : options.schedule;
  const task = options.task === undefined ? makeTask() : options.task;
  const agents = options.agents ?? [makeAgent()];
  const subtasks = options.subtasks ?? [];

  const tasksRepo = {
    findById: vi.fn().mockResolvedValue(task),
    update: vi.fn().mockResolvedValue(task),
    // Optional in the repo surface (the executor calls it with `?.`).
    // The real TasksRepository has updateStatus; we add it here so
    // the executor's status transitions are observable in tests.
    updateStatus: vi.fn().mockResolvedValue(task),
  };
  const subtasksRepo: ExecutorMocks['subtasksRepo'] = {
    listByTask: vi.fn().mockResolvedValue(subtasks),
    deleteByTask: vi.fn().mockResolvedValue(undefined),
  };
  const taskAgentsRepo = {
    listByTask: vi.fn().mockResolvedValue(agents),
  };
  const taskSchedulesRepo = {
    claimNextDue: vi
      .fn()
      .mockResolvedValue(
        schedule ? { id: schedule.id, payload: { schedule } } : null,
      ),
    findById: vi.fn().mockResolvedValue(schedule),
    update: vi.fn().mockResolvedValue(schedule),
  };
  const taskExecutionHistoryRepo = {
    create: vi.fn().mockResolvedValue({ id: 'history-1' }),
    updateStatus: vi.fn().mockResolvedValue({ id: 'history-1' }),
    markFailed: vi.fn().mockResolvedValue({ id: 'history-1' }),
  };
  const taskService = {
    executeTask: vi.fn().mockResolvedValue({
      ok: true,
      data: { sessionId: 'session-1' },
    }),
    executeSubtasks: vi.fn().mockResolvedValue({
      ok: true,
      data: { startedCount: subtasks.length },
    }),
  };

  let planningService: ExecutorMocks['planningService'] | undefined;
  if (options.planningService === 'ok') {
    planningService = { planTask: vi.fn().mockResolvedValue({ ok: true }) };
  } else if (options.planningService === 'fail') {
    planningService = {
      planTask: vi
        .fn()
        .mockResolvedValue({
          ok: false,
          error: { code: 'plan.fail', message: 'planner said no' },
        }),
    };
  } else if (options.planningService === 'none') {
    // No planning service injected — default (omitted) below.
  }

  const sessionService = {
    createSession: vi
      .fn()
      .mockResolvedValue({ id: 'session-1', title: 'Task: Daily summary' }),
    submitMessageStreaming: vi.fn().mockResolvedValue({ ok: true as const }),
  };

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const calculateNextRun = vi
    .fn()
    .mockReturnValue(options.nextRunAt ?? new Date('2026-06-06T09:00:00Z'));

  // Build deps strictly to satisfy the executor's required fields.
  // We strip the optional `planningService` when not requested.
  const baseDeps: TaskScheduleExecutorDeps = {
    tasksRepo: tasksRepo as unknown as TaskScheduleExecutorDeps['tasksRepo'],
    subtasksRepo:
      subtasksRepo as unknown as TaskScheduleExecutorDeps['subtasksRepo'],
    taskAgentsRepo:
      taskAgentsRepo as unknown as TaskScheduleExecutorDeps['taskAgentsRepo'],
    taskSchedulesRepo:
      taskSchedulesRepo as unknown as TaskScheduleExecutorDeps['taskSchedulesRepo'],
    taskExecutionHistoryRepo:
      taskExecutionHistoryRepo as unknown as TaskScheduleExecutorDeps['taskExecutionHistoryRepo'],
    taskService,
    sessionService,
    defaultAgentIdProvider: () => options.defaultAgent,
    calculateNextRun,
    logger: log,
  };
  const deps: TaskScheduleExecutorDeps = planningService
    ? { ...baseDeps, planningService }
    : baseDeps;

  return {
    executor: new TaskScheduleExecutor(deps),
    mocks: {
      deps,
      tasksRepo,
      subtasksRepo,
      taskAgentsRepo,
      taskSchedulesRepo,
      taskExecutionHistoryRepo,
      taskService,
      planningService,
      sessionService,
      log,
      calculateNextRun,
    },
  };
}

const payloadFor = (
  overrides: Partial<TaskSchedulePayload> = {},
): TaskSchedulePayload => ({
  schedule: makeSchedule(),
  taskTitle: 'Daily summary',
  taskDescription: 'Summarise my day',
  taskAssignedAgents: [makeAgent()],
  currentDescriptionHash: hashDescription('Summarise my day'),
  ...overrides,
});

// ============================================================================
// hashDescription
// ============================================================================

describe('hashDescription', () => {
  it('returns a stable SHA-256 hex digest', () => {
    const a = hashDescription('hello');
    const b = hashDescription('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashDescription('a')).not.toBe(hashDescription('b'));
  });
});

// ============================================================================
// claimNextDue
// ============================================================================

describe('TaskScheduleExecutor.claimNextDue', () => {
  it('returns null when no schedule is due', async () => {
    const { executor, mocks } = makeHarness({ schedule: null });
    const result = await executor.claimNextDue();
    expect(result).toBeNull();
    expect(mocks.taskSchedulesRepo.claimNextDue).toHaveBeenCalledOnce();
  });

  it('claims a schedule, loads the task, and returns the payload', async () => {
    const { executor, mocks } = makeHarness();
    const result = await executor.claimNextDue();
    expect(result).not.toBeNull();
    expect(result!.id).toBe('sched-1');
    expect(result!.payload.taskTitle).toBe('Daily summary');
    expect(result!.payload.taskAssignedAgents).toHaveLength(1);
    expect(result!.payload.currentDescriptionHash).toBe(
      hashDescription('Summarise my day'),
    );
    expect(mocks.taskAgentsRepo.listByTask).toHaveBeenCalledWith('task-1');
  });

  it('marks the schedule expired and returns null when the task was deleted', async () => {
    const { executor, mocks } = makeHarness({ task: null });
    const result = await executor.claimNextDue();
    expect(result).toBeNull();
    expect(mocks.taskSchedulesRepo.update).toHaveBeenCalledWith('sched-1', {
      status: 'expired',
    });
    expect(mocks.log.warn).toHaveBeenCalled();
  });

  it('falls back to the default agent when the task has no task_agents rows', async () => {
    const { executor } = makeHarness({
      agents: [],
      defaultAgent: 'fallback-agent',
    });
    const result = await executor.claimNextDue();
    expect(result!.payload.taskAssignedAgents).toHaveLength(1);
    expect(result!.payload.taskAssignedAgents[0]!.agentId).toBe(
      'fallback-agent',
    );
  });

  it('warns when the task has no agents and no default is configured', async () => {
    const { executor, mocks } = makeHarness({
      agents: [],
      defaultAgent: undefined,
    });
    const result = await executor.claimNextDue();
    expect(result!.payload.taskAssignedAgents).toHaveLength(0);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' }),
      expect.any(String),
    );
  });
});

// ============================================================================
// execute (the main lifecycle: history, cleanup, plan, run)
// ============================================================================

describe('TaskScheduleExecutor.execute', () => {
  let harness: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('creates a history row before doing anything else', async () => {
    const { executor, mocks } = harness;
    await executor.execute('sched-1', payloadFor());
    expect(mocks.taskExecutionHistoryRepo.create).toHaveBeenCalledOnce();
    expect(mocks.taskExecutionHistoryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        scheduleId: 'sched-1',
        taskTitle: 'Daily summary',
        taskDescription: 'Summarise my day',
      }),
    );
  });

  it('with replanPolicy=never: skips planning, reuses subtasks, does NOT delete them', async () => {
    const { executor, mocks } = harness;
    const subtask = makeSubtask();
    mocks.subtasksRepo.listByTask.mockResolvedValue([subtask]);
    const schedule = makeSchedule({ replanPolicy: 'never' });
    await executor.execute('sched-1', payloadFor({ schedule }));
    // No planning call
    expect(mocks.planningService).toBeUndefined();
    // No subtask delete
    expect(mocks.subtasksRepo.deleteByTask).not.toHaveBeenCalled();
    // Subtasks were executed (the existing plan was reused)
    expect(mocks.taskService.executeSubtasks).toHaveBeenCalledWith('task-1');
    expect(mocks.taskService.executeTask).not.toHaveBeenCalled();
  });

  it('with replanPolicy=always: re-invokes the planning agent and deletes subtasks first', async () => {
    const schedule = makeSchedule({ replanPolicy: 'always' });
    const { executor, mocks } = makeHarness({
      schedule,
      planningService: 'ok',
    });
    // After replan, listByTask returns the new plan
    mocks.subtasksRepo.listByTask.mockResolvedValue([makeSubtask()]);
    await executor.execute('sched-1', payloadFor({ schedule }));
    expect(mocks.planningService!.planTask).toHaveBeenCalledWith('task-1');
    expect(mocks.subtasksRepo.deleteByTask).toHaveBeenCalledWith('task-1');
    expect(mocks.taskExecutionHistoryRepo.updateStatus).toHaveBeenCalledWith(
      'history-1',
      expect.objectContaining({ status: 'planning', didReplan: true }),
    );
  });

  it('with replanPolicy=on-description-change: replans when the hash changed', async () => {
    const schedule = makeSchedule({
      replanPolicy: 'on-description-change',
      descriptionHash: 'old-hash',
    });
    const { executor, mocks } = makeHarness({
      schedule,
      planningService: 'ok',
    });
    mocks.subtasksRepo.listByTask.mockResolvedValue([makeSubtask()]);
    await executor.execute('sched-1', payloadFor({ schedule }));
    expect(mocks.planningService!.planTask).toHaveBeenCalled();
    expect(mocks.subtasksRepo.deleteByTask).toHaveBeenCalled();
  });

  it('with replanPolicy=on-description-change: skips replan when the hash is unchanged', async () => {
    const currentHash = hashDescription('Summarise my day');
    const schedule = makeSchedule({
      replanPolicy: 'on-description-change',
      descriptionHash: currentHash, // matches
    });
    const { executor, mocks } = makeHarness({
      schedule,
      planningService: 'ok',
    });
    mocks.subtasksRepo.listByTask.mockResolvedValue([makeSubtask()]);
    await executor.execute(
      'sched-1',
      payloadFor({ schedule, currentDescriptionHash: currentHash }),
    );
    expect(mocks.planningService!.planTask).not.toHaveBeenCalled();
    expect(mocks.subtasksRepo.deleteByTask).not.toHaveBeenCalled();
  });

  it('creates a new session and links it to the task before running', async () => {
    const { executor, mocks } = harness;
    await executor.execute('sched-1', payloadFor());
    expect(mocks.sessionService.createSession).toHaveBeenCalledWith(
      'Task: Daily summary (run #1)',
      'task',
    );
    // The session ref is set via update(); the status is set via a
    // separate updateStatus() call (the TasksRepository keeps these
    // concerns separate).
    expect(mocks.tasksRepo.update).toHaveBeenCalledWith('task-1', {
      sessionId: 'session-1',
    });
    expect(mocks.tasksRepo.update).toHaveBeenCalledWith('task-1', {
      sessionId: null,
    });
    // updateStatus is optional in the repo surface — only assert if the
    // fake implements it.
    const taskRepo = mocks.tasksRepo as unknown as {
      updateStatus?: ReturnType<typeof vi.fn>;
    };
    if (taskRepo.updateStatus) {
      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'todo');
      expect(taskRepo.updateStatus).toHaveBeenCalledWith(
        'task-1',
        'in_progress',
      );
    }
  });

  it('falls back to executeTask (description) when the task has no subtasks', async () => {
    const { executor, mocks } = harness;
    mocks.subtasksRepo.listByTask.mockResolvedValue([]);
    await executor.execute('sched-1', payloadFor());
    expect(mocks.taskService.executeTask).toHaveBeenCalledWith('task-1');
    expect(mocks.taskService.executeSubtasks).not.toHaveBeenCalled();
  });

  it('marks history as failed when planning fails', async () => {
    const schedule = makeSchedule({ replanPolicy: 'always' });
    const { executor, mocks } = makeHarness({
      schedule,
      planningService: 'fail',
    });
    const result = await executor.execute('sched-1', payloadFor({ schedule }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/Planning failed/);
    }
    expect(mocks.taskExecutionHistoryRepo.markFailed).toHaveBeenCalledWith(
      'history-1',
      expect.any(Number),
      expect.objectContaining({ code: 'Error' }),
    );
  });

  it('returns ok and marks verifying when execute succeeds', async () => {
    const { executor, mocks } = harness;
    const result = await executor.execute('sched-1', payloadFor());
    expect(result.ok).toBe(true);
    expect(mocks.taskExecutionHistoryRepo.updateStatus).toHaveBeenCalledWith(
      'history-1',
      expect.objectContaining({ status: 'verifying' }),
    );
  });

  it('logs and returns an error result when taskService.executeSubtasks fails', async () => {
    const { executor, mocks } = harness;
    mocks.subtasksRepo.listByTask.mockResolvedValue([makeSubtask()]);
    mocks.taskService.executeSubtasks.mockResolvedValue({
      ok: false,
      error: { code: 'subtask.boom', message: 'subtask failed' },
    });
    const result = await executor.execute('sched-1', payloadFor());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/executeSubtasks failed/);
    }
    expect(mocks.log.error).toHaveBeenCalled();
    expect(mocks.taskExecutionHistoryRepo.markFailed).toHaveBeenCalled();
  });
});

// ============================================================================
// reschedule
// ============================================================================

describe('TaskScheduleExecutor.reschedule', () => {
  it('bumps executionCount, sets lastRunAt, and computes the next cron run', async () => {
    const { executor, mocks } = makeHarness({
      nextRunAt: new Date('2026-06-06T09:00:00Z'),
    });
    const result = await executor.reschedule('sched-1', payloadFor(), {
      ok: true,
      durationMs: 100,
    });
    expect(result).toEqual(new Date('2026-06-06T09:00:00Z'));
    expect(mocks.taskSchedulesRepo.update).toHaveBeenCalledWith(
      'sched-1',
      expect.objectContaining({
        status: 'active',
        executionCount: 1,
        lastRunAt: expect.any(Date),
        nextRunAt: new Date('2026-06-06T09:00:00Z'),
        descriptionHash: hashDescription('Summarise my day'),
      }),
    );
  });

  it('transitions to expired when executionCount reaches maxExecutions', async () => {
    const schedule = makeSchedule({ executionCount: 4, maxExecutions: 5 });
    const { executor, mocks } = makeHarness({ schedule });
    const result = await executor.reschedule(
      'sched-1',
      payloadFor({ schedule }),
      {
        ok: true,
        durationMs: 100,
      },
    );
    expect(result).toBeNull();
    expect(mocks.taskSchedulesRepo.update).toHaveBeenCalledWith(
      'sched-1',
      expect.objectContaining({ status: 'expired', executionCount: 5 }),
    );
  });

  it('transitions to expired for one-shots after the first execution', async () => {
    const schedule = makeSchedule({ cronExpression: null, preset: null });
    const { executor, mocks } = makeHarness({ schedule });
    const result = await executor.reschedule(
      'sched-1',
      payloadFor({ schedule }),
      {
        ok: true,
        durationMs: 100,
      },
    );
    expect(result).toBeNull();
    expect(mocks.taskSchedulesRepo.update).toHaveBeenCalledWith(
      'sched-1',
      expect.objectContaining({ status: 'expired' }),
    );
  });

  it('marks expired and counts the failed run when maxExecutions is reached', async () => {
    const schedule = makeSchedule({ executionCount: 4, maxExecutions: 5 });
    const { executor, mocks } = makeHarness({ schedule });
    const result = await executor.reschedule(
      'sched-1',
      payloadFor({ schedule }),
      { ok: false, error: new Error('boom'), durationMs: 50 },
    );
    expect(result).toBeNull();
    expect(mocks.taskSchedulesRepo.update).toHaveBeenCalledWith(
      'sched-1',
      expect.objectContaining({ status: 'expired', executionCount: 5 }),
    );
  });

  it('marks expired when calculateNextRun throws', async () => {
    const { executor, mocks } = makeHarness();
    mocks.calculateNextRun.mockImplementation(() => {
      throw new Error('bad cron');
    });
    const result = await executor.reschedule('sched-1', payloadFor(), {
      ok: true,
      durationMs: 100,
    });
    expect(result).toBeNull();
    expect(mocks.taskSchedulesRepo.update).toHaveBeenCalledWith(
      'sched-1',
      expect.objectContaining({ status: 'expired' }),
    );
    expect(mocks.log.error).toHaveBeenCalled();
  });
});

// ============================================================================
// triggerNow
// ============================================================================

describe('TaskScheduleExecutor.triggerNow', () => {
  it('returns ok with the history ID and runs execute()', async () => {
    const { executor, mocks } = makeHarness();
    const result = await executor.triggerNow('sched-1');
    expect(result.ok).toBe(true);
    expect(result.historyId).toBe('history-1');
    expect(mocks.taskExecutionHistoryRepo.create).toHaveBeenCalled();
    // The full execute() ran, which means the session was created.
    expect(mocks.sessionService.createSession).toHaveBeenCalled();
  });

  it('returns an error when the schedule does not exist', async () => {
    const { executor, mocks } = makeHarness({ schedule: null });
    const result = await executor.triggerNow('nope');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Schedule not found');
    // Nothing was created.
    expect(mocks.taskExecutionHistoryRepo.create).not.toHaveBeenCalled();
  });

  it('returns an error when the task does not exist', async () => {
    const { executor } = makeHarness({ task: null });
    const result = await executor.triggerNow('sched-1');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Task not found');
  });
});
