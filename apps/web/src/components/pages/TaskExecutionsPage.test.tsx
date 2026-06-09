/**
 * TaskExecutionsPage component tests
 */

import { render, screen, waitFor, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskExecutionsPage } from './TaskExecutionsPage';

// Mock the API client
vi.mock('../../lib/api-tasks', () => ({
  getTaskSchedule: vi.fn(),
  listTaskExecutions: vi.fn(),
}));

import { getTaskSchedule, listTaskExecutions } from '../../lib/api-tasks';

function makeSchedule(overrides = {}) {
  return {
    id: 'sch_1',
    taskId: 't_1',
    schedule: { every: '1h' as const },
    cronExpression: null,
    preset: null,
    scheduleDate: null,
    nextRunAt: new Date(Date.now() + 3600000).toISOString(),
    lastRunAt: null,
    status: 'active' as const,
    replanPolicy: 'never' as const,
    maxExecutions: 9999,
    remainingExecutions: 9999,
    executionCount: 3,
    scheduleHuman: 'Every hour',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeExecution(overrides = {}) {
  return {
    id: 'h_1',
    taskId: 't_1',
    scheduleId: 'sch_1',
    status: 'completed' as const,
    startedAt: new Date(Date.now() - 60000).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 60000,
    sessionId: null,
    attemptNumber: 1,
    didReplan: false,
    taskTitle: 'Test Task',
    taskDescription: 'A test task',
    errorCode: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TaskExecutionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTaskSchedule as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (listTaskExecutions as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it('renders the header with back button', async () => {
    const onBack = vi.fn();
    render(() => <TaskExecutionsPage taskId="t_1" onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText('Execution History')).toBeInTheDocument();
    });

    // Back button is present
    expect(screen.getByText('Back to tasks')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn();
    render(() => <TaskExecutionsPage taskId="t_1" onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText('Back to tasks')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Back to tasks'));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders the schedule display when schedule exists', async () => {
    const schedule = makeSchedule();
    (getTaskSchedule as ReturnType<typeof vi.fn>).mockResolvedValue(schedule);

    render(() => <TaskExecutionsPage taskId="t_1" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Every hour')).toBeInTheDocument();
    });
  });

  it('renders execution rows in the table', async () => {
    (listTaskExecutions as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        makeExecution({
          id: 'h_1',
          status: 'completed' as const,
          attemptNumber: 1,
        }),
        makeExecution({
          id: 'h_2',
          status: 'failed' as const,
          attemptNumber: 2,
          errorMessage: 'Something broke',
        }),
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });

    render(() => <TaskExecutionsPage taskId="t_1" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('completed')).toBeInTheDocument();
    });

    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('shows empty state when no executions exist', async () => {
    // Reset to a guaranteed empty list for this specific test. The
    // beforeEach already does this, but we restate it so the test
    // is self-contained and survives future refactors of the
    // beforeEach (the original test was flaky under global cleanup).
    (listTaskExecutions as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });

    render(() => <TaskExecutionsPage taskId="t_1" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/no execution history/i)).toBeInTheDocument();
    });
  });

  it('filters by status', async () => {
    (listTaskExecutions as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        makeExecution({ status: 'failed' as const, errorMessage: 'Boom' }),
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });

    render(() => <TaskExecutionsPage taskId="t_1" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('All statuses')).toBeInTheDocument();
    });

    // Find the status filter select (first combobox is the filter)
    const selects = screen.getAllByRole('combobox');
    const filterSelect = selects[0] as HTMLSelectElement;
    fireEvent.change(filterSelect, { target: { value: 'failed' } });

    await waitFor(() => {
      expect(listTaskExecutions).toHaveBeenCalledWith('t_1', {
        limit: 20,
        offset: 0,
        status: 'failed',
      });
    });
  });

  it('renders pagination when there are multiple pages', async () => {
    (listTaskExecutions as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: Array.from({ length: 20 }, (_, i) =>
        makeExecution({ id: `h_${i}`, attemptNumber: i + 1 }),
      ),
      total: 42,
      limit: 20,
      offset: 0,
    });

    render(() => <TaskExecutionsPage taskId="t_1" onBack={vi.fn()} />);

    // Wait for the pagination to render
    await waitFor(() => {
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    expect(screen.getByText('Previous')).toBeInTheDocument();
  });
});
