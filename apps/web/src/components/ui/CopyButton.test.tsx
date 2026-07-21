import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { CopyButton } from './CopyButton';

vi.mock('lucide-solid', () => ({
  Copy: () => <span data-testid="copy" />,
  Check: () => <span data-testid="check" />,
}));

describe('CopyButton', () => {
  let writeText: ReturnType<typeof vi.fn>;
  let execCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue(undefined);
    execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    document.execCommand =
      execCommand as unknown as typeof document.execCommand;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it('copies text via the async clipboard API when clicked', async () => {
    const { container } = render(() => <CopyButton text="hello world" />);
    const btn = container.querySelector('button')!;
    fireEvent.click(btn);
    // Allow the async handler to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('hello world');
    expect(
      container.querySelector('[data-testid="check"]'),
    ).toBeInTheDocument();
  });

  it('switches the icon to Check after copy', async () => {
    const { container } = render(() => <CopyButton text="x" />);
    expect(container.querySelector('[data-testid="copy"]')).toBeInTheDocument();
    fireEvent.click(container.querySelector('button')!);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      container.querySelector('[data-testid="check"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="copy"]'),
    ).not.toBeInTheDocument();
  });

  it('reverts to the Copy icon after 2 seconds', async () => {
    const { container } = render(() => <CopyButton text="x" />);
    fireEvent.click(container.querySelector('button')!);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      container.querySelector('[data-testid="check"]'),
    ).toBeInTheDocument();
    vi.advanceTimersByTime(2_000);
    expect(container.querySelector('[data-testid="copy"]')).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="check"]'),
    ).not.toBeInTheDocument();
  });

  it('falls back to execCommand when the clipboard API throws', async () => {
    writeText.mockRejectedValueOnce(new Error('blocked'));
    const { container } = render(() => <CopyButton text="fallback" />);
    fireEvent.click(container.querySelector('button')!);
    await Promise.resolve();
    await Promise.resolve();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(
      container.querySelector('[data-testid="check"]'),
    ).toBeInTheDocument();
  });

  it('does not toggle the icon if both clipboard and fallback fail', async () => {
    writeText.mockRejectedValueOnce(new Error('blocked'));
    execCommand.mockReturnValueOnce(false);
    const { container } = render(() => <CopyButton text="nope" />);
    fireEvent.click(container.querySelector('button')!);
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('[data-testid="copy"]')).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="check"]'),
    ).not.toBeInTheDocument();
  });

  it('stops propagation so wrapping click handlers do not fire', async () => {
    const onClick = vi.fn();
    const { container } = render(() => (
      <div onClick={onClick}>
        <CopyButton text="stop" />
      </div>
    ));
    fireEvent.click(container.querySelector('button')!);
    expect(onClick).not.toHaveBeenCalled();
  });
});
