/**
 * TaskCard component tests.
 *
 * The TaskCard displays a task in the Kanban board and includes a
 * `ScheduleBadge` subcomponent that fetches and displays the task's
 * recurring schedule (if any).
 *
 * What we test:
 * - Renders the task title and priority badge.
 * - Renders the schedule human description when a schedule exists.
 * - Shows the "paused" pill when the schedule is paused.
 * - Renders nothing when the task has no schedule.
 * - Calls onClick when the card is clicked.
 * - Calls onExecute when the play button is clicked.
 */

import { render, screen, waitFor, fireEvent } from '@solidjs/testing-library';
import { describe, it, expect, vi } from 'vitest';
import { TaskCard } from './TaskCard';

// Mock the API client. The default behaviour is "no schedule" —
// individual tests override getTaskSchedule per case.
vi.mock('../../lib/api-tasks', () => ({
  getTaskSchedule: vi.fn().mockResolvedValue(null),
}));

import { getTaskSchedule } from '../../lib/api-tasks';

const makeTask = (overrides = {}) => ({
  id: 'task-1',
  title: 'Daily standup',
  description: 'Run the daily standup',
  status: 'todo' as const,
  priority: 'medium' as const,
  planningEnabled: false,
  planningStatus: null,
  sessionId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

function makeSchedule(
  overrides: Partial<{
    id: string;
    status: 'active' | 'paused' | 'expired';
    scheduleHuman: string;
  }> = {},
) {
  return {
    id: 'sch-1',
    taskId: 'task-1',
    schedule: { every: '1h' as const },
    cronExpression: '0 * * * *',
    preset: '1h' as const,
    scheduleDate: null,
    nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
    lastRunAt: null,
    status: 'active' as const,
    replanPolicy: 'never' as const,
    maxExecutions: 9999,
    remainingExecutions: 9999,
    executionCount: 0,
    scheduleHuman: 'Every hour',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('renders the task title and priority badge', () => {
    render(() => <TaskCard task={makeTask({ title: 'My task' })} />);
    expect(screen.getByText('My task')).toBeInTheDocument();
  });

  it('renders the priority badge with the right color class', () => {
    render(() => <TaskCard task={makeTask({ priority: 'urgent' })} />);
    const badge = screen.getByText('urgent');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/red/);
  });

  it('renders nothing about scheduling when the task has no schedule', async () => {
    vi.mocked(getTaskSchedule).mockResolvedValue(null);
    render(() => <TaskCard task={makeTask()} />);

    await waitFor(() => {
      expect(vi.mocked(getTaskSchedule)).toHaveBeenCalled();
    });
    // The schedule badge uses an icon + text; check the text is absent.
    expect(screen.queryByText('Every hour')).not.toBeInTheDocument();
    expect(screen.queryByText('paused')).not.toBeInTheDocument();
  });

  it('renders the schedule human description when a schedule exists', async () => {
    vi.mocked(getTaskSchedule).mockResolvedValue(
      makeSchedule({
        scheduleHuman: 'Every 15 minutes',
      }),
    );
    render(() => <TaskCard task={makeTask()} />);

    await waitFor(() => {
      expect(screen.getByText('Every 15 minutes')).toBeInTheDocument();
    });
  });

  it('shows the "paused" pill when the schedule status is paused', async () => {
    vi.mocked(getTaskSchedule).mockResolvedValue(
      makeSchedule({
        status: 'paused',
        scheduleHuman: 'Every hour',
      }),
    );
    render(() => <TaskCard task={makeTask()} />);

    await waitFor(() => {
      // "paused" is the text inside the pill (lower-case to match the
      // rendered DOM).
      expect(screen.getByText('paused')).toBeInTheDocument();
    });
  });

  it('does NOT show the "paused" pill for an active schedule', async () => {
    vi.mocked(getTaskSchedule).mockResolvedValue(
      makeSchedule({
        status: 'active',
        scheduleHuman: 'Every hour',
      }),
    );
    render(() => <TaskCard task={makeTask()} />);

    await waitFor(() => {
      expect(screen.getByText('Every hour')).toBeInTheDocument();
    });
    expect(screen.queryByText('paused')).not.toBeInTheDocument();
  });

  it('calls onClick when the card is clicked', () => {
    const onClick = vi.fn();
    render(() => (
      <TaskCard task={makeTask({ title: 'Click me' })} onClick={onClick} />
    ));
    // The card has the `task-card` class. Click the title's parent.
    const title = screen.getByText('Click me');
    fireEvent.click(title);
    expect(onClick).toHaveBeenCalled();
  });

  it('calls onExecute when the play button is clicked', () => {
    const onExecute = vi.fn();
    const { container } = render(() => (
      <TaskCard task={makeTask({ title: 'Ex' })} onExecute={onExecute} />
    ));
    // The execute button is a <button> with class containing
    // "bg-blue-600" (the run-task button) — we find it by class
    // since the component doesn't set an aria-label.
    const button = container.querySelector(
      'button.bg-blue-600',
    ) as HTMLElement | null;
    expect(button).toBeTruthy();
    fireEvent.click(button!);
    expect(onExecute).toHaveBeenCalled();
  });
});
