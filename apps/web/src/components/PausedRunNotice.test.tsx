import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@solidjs/testing-library';
import { PausedRunNotice } from './PausedRunNotice';

describe('PausedRunNotice', () => {
  it('renders the paused state with a continue affordance', () => {
    render(() => <PausedRunNotice onContinue={() => {}} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.getByText(/agent stopped before finishing/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /continue/i }),
    ).toBeInTheDocument();
  });

  it('fires onContinue when the Continue button is clicked', () => {
    const onContinue = vi.fn();
    render(() => <PausedRunNotice onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
