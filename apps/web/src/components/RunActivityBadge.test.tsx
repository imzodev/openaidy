import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { RunActivityBadge } from './RunActivityBadge';

vi.mock('lucide-solid', () => ({
  Loader: () => <span data-testid="loader" />,
  Ban: () => <span data-testid="ban" />,
}));

describe('RunActivityBadge', () => {
  it('shows "Thinking…" with an elapsed counter', () => {
    render(() => <RunActivityBadge phase="thinking" elapsedMs={3000} />);
    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    expect(screen.getByText('3s')).toBeInTheDocument();
    expect(screen.getByTestId('loader')).toBeInTheDocument();
  });

  it('shows the running tool name and elapsed time', () => {
    render(() => (
      <RunActivityBadge
        phase="running_tool"
        toolName="exec_run"
        elapsedMs={12000}
      />
    ));
    expect(screen.getByText('Running exec_run…')).toBeInTheDocument();
    expect(screen.getByText('12s')).toBeInTheDocument();
  });

  it('shows a terminal "Cancelled" state with no counter or spinner', () => {
    render(() => <RunActivityBadge phase="cancelled" elapsedMs={5000} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('5s')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loader')).not.toBeInTheDocument();
    expect(screen.getByTestId('ban')).toBeInTheDocument();
  });

  describe('local ticker', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('ticks the elapsed seconds locally without new events', () => {
      render(() => <RunActivityBadge phase="thinking" elapsedMs={0} />);
      expect(screen.getByText('0s')).toBeInTheDocument();
      vi.advanceTimersByTime(2000);
      expect(screen.getByText('2s')).toBeInTheDocument();
    });
  });
});
