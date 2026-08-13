import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette';
import type { CommandContext } from './command-registry';
import {
  recordRecentSession,
  recordRecentAgent,
  clearRecentItems,
} from '../../stores/recent-items';

// Stub every icon the palette renders. Plain-object factory — Proxy mocks
// hang vitest's collector here.
vi.mock('lucide-solid', () => {
  const Stub = () => null;
  const out: Record<string, unknown> = {};
  for (const name of [
    'Layers',
    'CheckSquare',
    'Zap',
    'Bot',
    'Wrench',
    'Server',
    'BarChart3',
    'FileText',
    'Save',
    'Puzzle',
    'KeyRound',
    'Settings',
    'Plus',
    'CircleStop',
    'Copy',
    'Code',
    'Sun',
    'PanelLeftClose',
    'Keyboard',
    'MessageSquare',
    'Search',
    'EyeOff',
  ]) {
    out[name] = Stub;
  }
  return out;
});

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    navigate: vi.fn(),
    newSession: vi.fn(),
    togglePrivacy: vi.fn(),
    canTogglePrivacy: vi.fn(() => false),
    isSessionPrivate: vi.fn(() => false),
    toggleTheme: vi.fn(),
    toggleSidebar: vi.fn(),
    ...overrides,
  };
}

function renderPalette(ctx: CommandContext) {
  const [isOpen, setIsOpen] = createSignal(true);
  const result = render(() => (
    <CommandPalette
      ctx={ctx}
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
    />
  ));
  return { ...result, setIsOpen };
}

// Helper that targets the input by its unique testid to avoid ambiguity
// with the dialog's aria-label.
const getInput = () => screen.getByTestId('command-palette-input');

beforeEach(() => {
  cleanup();
  clearRecentItems();
});

describe('CommandPalette', () => {
  it('renders the input and a list of commands when open', () => {
    renderPalette(makeCtx());
    const input = getInput();
    expect(input).toBeInTheDocument();
    // Static navigation commands should appear.
    expect(screen.getByText('Go to Sessions')).toBeInTheDocument();
    expect(screen.getByText('Go to Settings')).toBeInTheDocument();
  });

  it('filters commands by typed query (fuzzy match)', () => {
    renderPalette(makeCtx());
    const input = getInput();
    fireEvent.input(input, { target: { value: 'chat' } });
    // "Go to Chat" should be visible.
    expect(screen.getByText('Go to Chat')).toBeInTheDocument();
    // "Go to Settings" should not be visible.
    expect(screen.queryByText('Go to Settings')).not.toBeInTheDocument();
  });

  it('shows an empty-state when no command matches', () => {
    renderPalette(makeCtx());
    const input = getInput();
    fireEvent.input(input, { target: { value: 'zzzzzz-no-match' } });
    expect(screen.getByText(/No commands match/i)).toBeInTheDocument();
  });

  it('runs the highlighted command when Enter is pressed', () => {
    const ctx = makeCtx();
    renderPalette(ctx);
    const input = getInput();
    fireEvent.keyDown(input, { key: 'Enter' });
    // runCommand defers via queueMicrotask before invoking ctx.navigate.
    return Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        expect(ctx.navigate).toHaveBeenCalled();
      });
  });

  it('runs the clicked command via the navigate callback', () => {
    const navigate = vi.fn();
    renderPalette(makeCtx({ navigate }));
    // Click the option that renders the "Go to Sessions" label.
    const options = screen.getAllByRole('option');
    const option = options.find((el) =>
      el.textContent?.includes('Go to Sessions'),
    );
    if (!option) {
      const labels = options.map((el) => el.textContent).join('\n  - ');
      throw new Error(
        `No option labelled "Go to Sessions". Found:\n  - ${labels}`,
      );
    }
    // The palette closes the modal on click via props.onClose(); flush
    // microtasks so the deferred cmd.run executes before the assertion.
    fireEvent.click(option);
    return Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        expect(navigate).toHaveBeenCalledWith('sessions');
      });
  });

  it('renders a "Recent" section when sessions have been recorded', () => {
    recordRecentSession({ id: 's1', title: 'My Project Session' });
    renderPalette(makeCtx());
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('My Project Session')).toBeInTheDocument();
  });

  it('shows a "Recent" section for recent agents', () => {
    recordRecentAgent({ id: 'a1', name: 'Helper Bot' });
    renderPalette(makeCtx());
    expect(screen.getByText('Helper Bot')).toBeInTheDocument();
  });

  it('highlights the next command when ArrowDown is pressed', () => {
    renderPalette(makeCtx());
    const input = getInput();
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('data-highlighted')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // After pressing ArrowDown, the *second* option should be highlighted.
    const optionsAfter = screen.getAllByRole('option');
    expect(optionsAfter[1].getAttribute('data-highlighted')).toBe('true');
  });

  it('hides the "Stop Agent" command when no stopAgent is provided', () => {
    renderPalette(makeCtx());
    expect(screen.queryByText('Stop Agent')).not.toBeInTheDocument();
  });

  it('shows the "Stop Agent" command when stopAgent is wired', () => {
    renderPalette(makeCtx({ stopAgent: vi.fn() }));
    expect(screen.getByText('Stop Agent')).toBeInTheDocument();
  });

  it('renders keyboard hint footer', () => {
    renderPalette(makeCtx());
    expect(screen.getByText(/navigate/)).toBeInTheDocument();
    expect(screen.getByText(/select/)).toBeInTheDocument();
  });
});

describe('useCommandPaletteHotkey', () => {
  it('opens the palette when ⌘K is pressed', () => {
    const [open, setOpen] = createSignal(false);
    render(() => {
      useCommandPaletteHotkey(setOpen);
      return <div />;
    });
    expect(open()).toBe(false);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(open()).toBe(true);
  });

  it('opens the palette when Ctrl+K is pressed', () => {
    const [open, setOpen] = createSignal(false);
    render(() => {
      useCommandPaletteHotkey(setOpen);
      return <div />;
    });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(open()).toBe(true);
  });

  it('ignores unrelated keys', () => {
    const [open, setOpen] = createSignal(false);
    render(() => {
      useCommandPaletteHotkey(setOpen);
      return <div />;
    });
    fireEvent.keyDown(window, { key: 'a', metaKey: true });
    fireEvent.keyDown(window, { key: 'k' });
    expect(open()).toBe(false);
  });
});
