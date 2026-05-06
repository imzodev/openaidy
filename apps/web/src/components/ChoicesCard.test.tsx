import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { ChoicesCard } from './ChoicesCard';

afterEach(() => cleanup());

vi.mock('lucide-solid', () => ({
  X: () => <span data-testid="dismiss-icon" />,
}));

describe('ChoicesCard', () => {
  const defaultProps = {
    choices: ['Option A', 'Option B', 'Option C'],
    onSelect: vi.fn(),
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all choices as buttons', () => {
    const { container } = render(() => <ChoicesCard {...defaultProps} />);
    const buttons = container.querySelectorAll('button[role="option"]');
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent).toContain('Option A');
    expect(buttons[1].textContent).toContain('Option B');
    expect(buttons[2].textContent).toContain('Option C');
  });

  it('calls onSelect with correct choice on click', () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <ChoicesCard {...defaultProps} onSelect={onSelect} />
    ));
    const buttons = container.querySelectorAll('button[role="option"]');
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith('Option B');
  });

  it('calls onSelect on Enter key when a choice is focused', () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <ChoicesCard {...defaultProps} onSelect={onSelect} />
    ));
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    // Focus second item via mouse enter
    const buttons = container.querySelectorAll('button[role="option"]');
    fireEvent.mouseEnter(buttons[1]);
    // Press Enter
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('Option B');
  });

  it('calls onDismiss on Escape key', () => {
    const onDismiss = vi.fn();
    const { container } = render(() => (
      <ChoicesCard {...defaultProps} onDismiss={onDismiss} />
    ));
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    fireEvent.keyDown(listbox, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders question text when provided', () => {
    const { container } = render(() => (
      <ChoicesCard {...defaultProps} question="Which option do you prefer?" />
    ));
    expect(container.textContent).toContain('Which option do you prefer?');
  });

  it('does not render question when undefined', () => {
    const { container } = render(() => <ChoicesCard {...defaultProps} />);
    expect(container.textContent).not.toContain('Which option');
  });

  it('navigates down with ArrowDown key', () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <ChoicesCard {...defaultProps} onSelect={onSelect} />
    ));
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    // Started at 0, ArrowDown moves to 1
    expect(onSelect).toHaveBeenCalledWith('Option B');
  });

  it('navigates up with ArrowUp key', () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <ChoicesCard {...defaultProps} onSelect={onSelect} />
    ));
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    // Move down once, then up
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    // Down to 1, Up back to 0
    expect(onSelect).toHaveBeenCalledWith('Option A');
  });

  it('wraps around when navigating past the end', () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <ChoicesCard {...defaultProps} onSelect={onSelect} />
    ));
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    // Navigate down 3 times on 3 items wraps to 0
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('Option A');
  });
});
