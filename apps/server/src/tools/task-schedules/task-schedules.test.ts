import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTaskScheduleTools, type TaskScheduleToolDeps } from './index.js';
import type {
  TaskScheduleDto,
  TaskExecutionHistoryDto,
  TaskExecutionHistoryStatus,
  ReplanPolicy,
  TaskScheduleStatus,
} from '@openaidy/shared-types';

// ---------------------------------------------------------------------------
// Mock TaskScheduleService
// ---------------------------------------------------------------------------

const createMockService = () => ({
  getScheduleForTask: vi.fn(),
  getScheduleById: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  removeSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
  triggerNow: vi.fn(),
  listExecutions: vi.fn(),
  listAllSchedules: vi.fn(),
});

type MockService = ReturnType<typeof createMockService>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSchedule = (
  overrides: Partial<TaskScheduleDto> = {},
): TaskScheduleDto => ({
  id: 'sched-1',
  taskId: 'task-1',
  schedule: { cron: '0 9 * * *' },
  cronExpression: '0 9 * * *',
  preset: null,
  scheduleDate: null,
  nextRunAt: '2026-06-05T09:00:00.000Z',
  lastRunAt: null,
  status: 'active' as TaskScheduleStatus,
  replanPolicy: 'never' as ReplanPolicy,
  maxExecutions: 9999,
  remainingExecutions: 9999,
  executionCount: 0,
  scheduleHuman: 'Every day at 9:00 AM',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...overrides,
});

const makeExecution = (
  overrides: Partial<TaskExecutionHistoryDto> = {},
): TaskExecutionHistoryDto => ({
  id: 'exec-1',
  taskId: 'task-1',
  scheduleId: 'sched-1',
  status: 'completed' as TaskExecutionHistoryStatus,
  startedAt: '2026-06-01T09:00:00.000Z',
  finishedAt: '2026-06-01T09:00:30.000Z',
  durationMs: 30000,
  sessionId: 'sess-1',
  attemptNumber: 1,
  didReplan: false,
  taskTitle: 'T',
  taskDescription: 'D',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-06-01T09:00:00.000Z',
  ...overrides,
});

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('task-schedule tools', () => {
  let mock: MockService;
  let tools: ReturnType<typeof createTaskScheduleTools>;
  let toolByName: Map<
    string,
    ReturnType<typeof createTaskScheduleTools>[number]
  >;

  beforeEach(() => {
    mock = createMockService();
    const deps: TaskScheduleToolDeps = {
      getTaskScheduleService: () =>
        mock as unknown as TaskScheduleToolDeps['getTaskScheduleService'] extends () => infer S
          ? S
          : never,
    };
    tools = createTaskScheduleTools(deps);
    toolByName = new Map(tools.map((t) => [t.name, t]));
  });

  function getTool(name: string) {
    const tool = toolByName.get(name);
    if (!tool) throw new Error(`Tool ${name} not registered`);
    return tool;
  }

  // -------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------
  it('registers exactly 8 tools', () => {
    expect(tools).toHaveLength(8);
  });

  it('registers the expected tool names', () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'task_schedules_create',
      'task_schedules_delete',
      'task_schedules_list',
      'task_schedules_list_executions',
      'task_schedules_pause',
      'task_schedules_resume',
      'task_schedules_trigger',
      'task_schedules_update',
    ]);
  });

  it('all tools use the Tasks category', () => {
    // Each tool's parameters describe the same scheduling domain.
    // We don't introspect ToolMeta here, but every tool's name starts
    // with "task_schedules_".
    for (const t of tools) {
      expect(t.name.startsWith('task_schedules_')).toBe(true);
    }
  });

  // -------------------------------------------------------------------
  // Service unavailable
  // -------------------------------------------------------------------
  describe('when service is unavailable', () => {
    beforeEach(() => {
      const deps: TaskScheduleToolDeps = {
        getTaskScheduleService: () => undefined,
      };
      tools = createTaskScheduleTools(deps);
      toolByName = new Map(tools.map((t) => [t.name, t]));
    });

    it('every tool returns a friendly error', async () => {
      for (const t of tools) {
        const args =
          t.name === 'task_schedules_list'
            ? { taskId: 'x' }
            : t.name === 'task_schedules_list_executions'
              ? { taskId: 'x' }
              : t.name === 'task_schedules_create'
                ? { taskId: 'x', schedule: { every: '1h' } }
                : t.name === 'task_schedules_update'
                  ? { taskId: 'x' }
                  : t.name === 'task_schedules_delete'
                    ? { taskId: 'x', confirm: true }
                    : t.name === 'task_schedules_pause'
                      ? { taskId: 'x' }
                      : t.name === 'task_schedules_resume'
                        ? { taskId: 'x' }
                        : { taskId: 'x' }; // trigger
        const result = await t.execute(args, CTX);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toMatch(/not available/i);
        }
      }
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_list
  // -------------------------------------------------------------------
  describe('task_schedules_list', () => {
    it('returns the schedule for a specific task', async () => {
      mock.getScheduleForTask.mockResolvedValue({
        ok: true,
        data: makeSchedule(),
      });
      const tool = getTool('task_schedules_list');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('ID: sched-1');
        expect(result.content).toContain('Schedule: Every day at 9:00 AM');
        expect(result.content).toContain('Status: active');
        expect(result.content).toContain('Replan policy: never');
      }
      expect(mock.getScheduleForTask).toHaveBeenCalledWith('task-1');
    });

    it('returns a "no schedule" message when not found', async () => {
      mock.getScheduleForTask.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no schedule' },
      });
      const tool = getTool('task_schedules_list');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('No schedule attached to task');
      }
    });

    it('lists all schedules when called without taskId', async () => {
      mock.listAllSchedules.mockResolvedValue({
        ok: true,
        data: {
          items: [
            makeSchedule({ id: 'sched-1', taskId: 'task-1', status: 'active' }),
            makeSchedule({ id: 'sched-2', taskId: 'task-2', status: 'paused' }),
          ],
          total: 2,
          limit: 50,
          offset: 0,
        },
      });
      const tool = getTool('task_schedules_list');
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('ID: sched-1');
        expect(result.content).toContain('ID: sched-2');
        expect(result.content).toContain('Showing 2 of 2 schedules');
      }
      expect(mock.listAllSchedules).toHaveBeenCalledWith(50, 0);
      expect(mock.getScheduleForTask).not.toHaveBeenCalled();
    });

    it('respects limit and offset when listing all', async () => {
      mock.listAllSchedules.mockResolvedValue({
        ok: true,
        data: {
          items: [makeSchedule({ id: 'sched-3', taskId: 'task-3' })],
          total: 10,
          limit: 5,
          offset: 5,
        },
      });
      const tool = getTool('task_schedules_list');
      const result = await tool.execute({ limit: 5, offset: 5 }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('Showing 1 of 10 schedules');
        expect(result.content).toContain('limit: 5, offset: 5');
      }
      expect(mock.listAllSchedules).toHaveBeenCalledWith(5, 5);
    });

    it('returns an empty message when no schedules exist', async () => {
      mock.listAllSchedules.mockResolvedValue({
        ok: true,
        data: { items: [], total: 0, limit: 50, offset: 0 },
      });
      const tool = getTool('task_schedules_list');
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('No task schedules found');
      }
    });

    it('rejects an empty taskId', async () => {
      const tool = getTool('task_schedules_list');
      const result = await tool.execute({ taskId: '   ' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/non-empty/i);
      }
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_create
  // -------------------------------------------------------------------
  describe('task_schedules_create', () => {
    it('creates a schedule with a preset', async () => {
      mock.createSchedule.mockResolvedValue({
        ok: true,
        data: makeSchedule({ preset: '1d', cronExpression: '0 0 * * *' }),
      });
      const tool = getTool('task_schedules_create');
      const result = await tool.execute(
        { taskId: 'task-1', schedule: { every: '1d' } },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('Successfully created schedule');
        expect(result.content).toContain('Replan policy: never');
      }
      expect(mock.createSchedule).toHaveBeenCalledWith('task-1', {
        schedule: { every: '1d' },
      });
    });

    it('passes through cron with tz', async () => {
      mock.createSchedule.mockResolvedValue({ ok: true, data: makeSchedule() });
      const tool = getTool('task_schedules_create');
      await tool.execute(
        {
          taskId: 'task-1',
          schedule: {
            cron: { expression: '0 9 * * *', tz: 'America/Mexico_City' },
          },
        },
        CTX,
      );
      expect(mock.createSchedule).toHaveBeenCalledWith('task-1', {
        schedule: { cron: '0 9 * * *', tz: 'America/Mexico_City' },
      });
    });

    it('passes through replanPolicy and maxExecutions', async () => {
      mock.createSchedule.mockResolvedValue({ ok: true, data: makeSchedule() });
      const tool = getTool('task_schedules_create');
      await tool.execute(
        {
          taskId: 'task-1',
          schedule: { every: '1h' },
          replanPolicy: 'on-description-change',
          maxExecutions: 50,
        },
        CTX,
      );
      expect(mock.createSchedule).toHaveBeenCalledWith('task-1', {
        schedule: { every: '1h' },
        replanPolicy: 'on-description-change',
        maxExecutions: 50,
      });
    });

    it('requires taskId', async () => {
      const tool = getTool('task_schedules_create');
      const result = await tool.execute(
        { schedule: { every: '1h' } } as unknown as { taskId: string },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/taskId is required/);
      }
      expect(mock.createSchedule).not.toHaveBeenCalled();
    });

    it('requires schedule', async () => {
      const tool = getTool('task_schedules_create');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/schedule is required/);
      }
    });

    it('returns service error verbatim', async () => {
      mock.createSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.already_exists', message: 'already has one' },
      });
      const tool = getTool('task_schedules_create');
      const result = await tool.execute(
        { taskId: 'task-1', schedule: { every: '1h' } },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('already has one');
      }
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_update
  // -------------------------------------------------------------------
  describe('task_schedules_update', () => {
    it('updates fields and returns the new schedule', async () => {
      mock.updateSchedule.mockResolvedValue({
        ok: true,
        data: makeSchedule({ replanPolicy: 'always', maxExecutions: 50 }),
      });
      const tool = getTool('task_schedules_update');
      const result = await tool.execute(
        { taskId: 'task-1', replanPolicy: 'always', maxExecutions: 50 },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('Schedule updated');
        expect(result.content).toContain('Replan policy: always');
      }
      expect(mock.updateSchedule).toHaveBeenCalledWith('task-1', {
        replanPolicy: 'always',
        maxExecutions: 50,
      });
    });

    it('passes status through (active/paused)', async () => {
      mock.updateSchedule.mockResolvedValue({
        ok: true,
        data: makeSchedule({ status: 'paused' }),
      });
      const tool = getTool('task_schedules_update');
      await tool.execute({ taskId: 'task-1', status: 'paused' }, CTX);
      expect(mock.updateSchedule).toHaveBeenCalledWith('task-1', {
        status: 'paused',
      });
    });

    it('rejects an empty body (no fields besides taskId)', async () => {
      const tool = getTool('task_schedules_update');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/at least one/i);
      }
      expect(mock.updateSchedule).not.toHaveBeenCalled();
    });

    it('requires taskId', async () => {
      const tool = getTool('task_schedules_update');
      const result = await tool.execute(
        { replanPolicy: 'always' } as unknown as { taskId: string },
        CTX,
      );
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_delete
  // -------------------------------------------------------------------
  describe('task_schedules_delete', () => {
    it('deletes the schedule when confirm=true', async () => {
      mock.removeSchedule.mockResolvedValue({ ok: true, data: true });
      const tool = getTool('task_schedules_delete');
      const result = await tool.execute(
        { taskId: 'task-1', confirm: true },
        CTX,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toMatch(/permanently removed/i);
      }
      expect(mock.removeSchedule).toHaveBeenCalledWith('task-1');
    });

    it('refuses without confirm=true (safety interlock)', async () => {
      const tool = getTool('task_schedules_delete');
      const result = await tool.execute(
        { taskId: 'task-1', confirm: false },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/confirm=true is required/);
      }
      expect(mock.removeSchedule).not.toHaveBeenCalled();
    });

    it('refuses if confirm is omitted entirely', async () => {
      const tool = getTool('task_schedules_delete');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(false);
    });

    it('returns 404-shaped error when schedule does not exist', async () => {
      mock.removeSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no' },
      });
      const tool = getTool('task_schedules_delete');
      const result = await tool.execute(
        { taskId: 'task-1', confirm: true },
        CTX,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/No schedule/);
      }
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_pause
  // -------------------------------------------------------------------
  describe('task_schedules_pause', () => {
    it('pauses and returns updated schedule', async () => {
      mock.pauseSchedule.mockResolvedValue({
        ok: true,
        data: makeSchedule({ status: 'paused' }),
      });
      const tool = getTool('task_schedules_pause');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('Schedule paused');
        expect(result.content).toContain('Status: paused');
      }
      expect(mock.pauseSchedule).toHaveBeenCalledWith('task-1');
    });

    it('returns service error verbatim', async () => {
      mock.pauseSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no schedule' },
      });
      const tool = getTool('task_schedules_pause');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('no schedule');
      }
    });

    it('requires taskId', async () => {
      const tool = getTool('task_schedules_pause');
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_resume
  // -------------------------------------------------------------------
  describe('task_schedules_resume', () => {
    it('resumes and returns updated schedule', async () => {
      mock.resumeSchedule.mockResolvedValue({
        ok: true,
        data: makeSchedule({ status: 'active' }),
      });
      const tool = getTool('task_schedules_resume');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('Schedule resumed');
        expect(result.content).toContain('Status: active');
      }
      expect(mock.resumeSchedule).toHaveBeenCalledWith('task-1');
    });

    it('returns service error when schedule not found', async () => {
      mock.resumeSchedule.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no schedule' },
      });
      const tool = getTool('task_schedules_resume');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('no schedule');
      }
    });

    it('requires taskId', async () => {
      const tool = getTool('task_schedules_resume');
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_trigger
  // -------------------------------------------------------------------
  describe('task_schedules_trigger', () => {
    it('returns the history ID on success', async () => {
      mock.triggerNow.mockResolvedValue({
        ok: true,
        data: { historyId: 'history-123' },
      });
      const tool = getTool('task_schedules_trigger');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('History ID: history-123');
        expect(result.content).toMatch(/track progress/i);
      }
      expect(mock.triggerNow).toHaveBeenCalledWith('task-1');
    });

    it('returns a clear error when no schedule exists', async () => {
      mock.triggerNow.mockResolvedValue({
        ok: false,
        error: { code: 'schedule.not_found', message: 'no' },
      });
      const tool = getTool('task_schedules_trigger');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/No schedule/);
      }
    });

    it('requires taskId', async () => {
      const tool = getTool('task_schedules_trigger');
      const result = await tool.execute({}, CTX);
      expect(result.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // task_schedules_list_executions
  // -------------------------------------------------------------------
  describe('task_schedules_list_executions', () => {
    it('returns paginated executions with default limit', async () => {
      mock.listExecutions.mockResolvedValue({
        ok: true,
        data: { items: [makeExecution()], total: 1, limit: 20, offset: 0 },
      });
      const tool = getTool('task_schedules_list_executions');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('ID: exec-1');
        expect(result.content).toContain('Status: completed');
        expect(result.content).toContain('Duration: 30.0s');
      }
      expect(mock.listExecutions).toHaveBeenCalledWith('task-1', {
        limit: 20,
        offset: 0,
      });
    });

    it('passes status filter through', async () => {
      mock.listExecutions.mockResolvedValue({
        ok: true,
        data: { items: [], total: 0, limit: 20, offset: 0 },
      });
      const tool = getTool('task_schedules_list_executions');
      await tool.execute({ taskId: 'task-1', status: 'failed' }, CTX);
      expect(mock.listExecutions).toHaveBeenCalledWith('task-1', {
        status: 'failed',
        limit: 20,
        offset: 0,
      });
    });

    it('returns a "no history yet" message for an empty result', async () => {
      mock.listExecutions.mockResolvedValue({
        ok: true,
        data: { items: [], total: 0, limit: 20, offset: 0 },
      });
      const tool = getTool('task_schedules_list_executions');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toMatch(/No execution history/i);
      }
    });

    it('surfaces error info for failed runs', async () => {
      mock.listExecutions.mockResolvedValue({
        ok: true,
        data: {
          items: [
            makeExecution({
              status: 'failed' as TaskExecutionHistoryStatus,
              errorCode: 'EXECUTION_ERROR',
              errorMessage: 'planner said no',
            }),
          ],
          total: 1,
          limit: 20,
          offset: 0,
        },
      });
      const tool = getTool('task_schedules_list_executions');
      const result = await tool.execute({ taskId: 'task-1' }, CTX);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toContain('Status: failed');
        expect(result.content).toContain('[EXECUTION_ERROR]');
        expect(result.content).toContain('planner said no');
      }
    });
  });
});
