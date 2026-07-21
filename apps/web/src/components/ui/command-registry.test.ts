import { describe, it, expect, vi } from 'vitest';
import {
  buildStaticCommands,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type CommandContext,
} from './command-registry';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    navigate: vi.fn(),
    newSession: vi.fn(),
    toggleTheme: vi.fn(),
    toggleSidebar: vi.fn(),
    ...overrides,
  };
}

describe('buildStaticCommands', () => {
  it('includes navigation, actions, and settings commands', () => {
    const cmds = buildStaticCommands(makeCtx());
    const cats = new Set(cmds.map((c) => c.category));
    expect(cats.has('navigation')).toBe(true);
    expect(cats.has('actions')).toBe(true);
    expect(cats.has('settings')).toBe(true);
  });

  it('does not include the dynamic "recent" category', () => {
    const cmds = buildStaticCommands(makeCtx());
    expect(cmds.some((c) => c.category === 'recent')).toBe(false);
  });

  it('uses the navigate callback for nav commands', () => {
    const navigate = vi.fn();
    const sessions = buildStaticCommands(makeCtx({ navigate })).find(
      (c) => c.id === 'nav.sessions',
    );
    sessions!.run(makeCtx({ navigate }));
    expect(navigate).toHaveBeenCalledWith('sessions');
  });

  it('hides "Stop Agent" when no cancelRun is wired in', () => {
    const cmds = buildStaticCommands(makeCtx());
    const stop = cmds.find((c) => c.id === 'action.stop-agent');
    expect(stop?.hidden).toBe(true);
  });

  it('shows "Stop Agent" when a stopAgent callback is provided', () => {
    const cmds = buildStaticCommands(makeCtx({ stopAgent: vi.fn() }));
    const stop = cmds.find((c) => c.id === 'action.stop-agent');
    expect(stop?.hidden).toBe(false);
  });

  it('invokes stopAgent when the command runs', () => {
    const stopAgent = vi.fn();
    const cmds = buildStaticCommands(makeCtx({ stopAgent }));
    cmds.find((c) => c.id === 'action.stop-agent')!.run(makeCtx({ stopAgent }));
    expect(stopAgent).toHaveBeenCalledTimes(1);
  });

  it('copies the last assistant/user message via clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const getCurrentMessages = () => [
      {
        id: '1',
        sessionId: 's1',
        role: 'user' as const,
        content: 'Hello',
        sequence: 1,
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        id: '2',
        sessionId: 's1',
        role: 'assistant' as const,
        content: 'Hi there!',
        sequence: 2,
        createdAt: '2024-01-01T00:00:01Z',
      },
    ];
    const notify = vi.fn();
    const cmds = buildStaticCommands(makeCtx({ getCurrentMessages, notify }));
    cmds
      .find((c) => c.id === 'action.copy-last-message')!
      .run(makeCtx({ getCurrentMessages, notify }));
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('Hi there!');
    expect(notify).toHaveBeenCalled();
  });

  it('copies the last fenced code block, not the surrounding prose', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const getCurrentMessages = () => [
      {
        id: '1',
        sessionId: 's1',
        role: 'assistant' as const,
        content:
          'Here is some code:\n```js\nconsole.log("a")\n```\nAnd more text\n```py\nprint("b")\n```\nDone.',
        sequence: 1,
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    const cmds = buildStaticCommands(makeCtx({ getCurrentMessages }));
    cmds
      .find((c) => c.id === 'action.copy-last-code')!
      .run(makeCtx({ getCurrentMessages }));
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('print("b")');
  });

  it('notifies when there is no message to copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const notify = vi.fn();
    const getCurrentMessages = () => [];
    const cmds = buildStaticCommands(makeCtx({ getCurrentMessages, notify }));
    cmds
      .find((c) => c.id === 'action.copy-last-message')!
      .run(makeCtx({ getCurrentMessages, notify }));
    await Promise.resolve();
    expect(writeText).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Nothing/i));
  });

  it('exposes a stable category order', () => {
    expect(CATEGORY_ORDER).toEqual([
      'recent',
      'navigation',
      'actions',
      'settings',
    ]);
  });

  it('has a human-readable label for every category', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});
