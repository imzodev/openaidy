import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { ChatComposer } from './ChatComposer';

// Stub the icons ChatComposer + AgentPicker render. Plain-object factory
// (a Proxy module mock hangs vitest collection here).
vi.mock('lucide-solid', () => ({
  Send: () => <span data-testid="send" />,
  ListPlus: () => <span data-testid="list-plus" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  Bot: () => <span data-testid="bot" />,
  X: () => <span data-testid="x" />,
  Paperclip: () => <span data-testid="paperclip" />,
  Music: () => <span data-testid="music" />,
}));

/** Force ChatComposer's `isMobile()` on by stubbing matchMedia. */
function stubMobile(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
}

describe('ChatComposer', () => {
  const mockOnSend = vi.fn().mockResolvedValue(undefined);
  const mockOnAgentSelect = vi.fn();
  const mockAgents = [
    {
      id: 'agent-1',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Test',
      model: 'openai/gpt-4o-mini',
      defaults: {},
    },
  ];

  it('should render textarea', () => {
    const { container } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
  });

  it('should render send button', () => {
    const { container } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    const button = container.querySelector('button[aria-label="Send message"]');
    expect(button).toBeTruthy();
  });

  it('keeps the input enabled while the agent is streaming', () => {
    const { container } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        isStreaming={true}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    const textarea = container.querySelector('textarea');
    expect(textarea?.disabled).toBe(false);
  });

  it('shows a queue affordance while streaming', () => {
    const { container } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        isStreaming={true}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    expect(
      container.querySelector('button[aria-label="Queue message"]'),
    ).toBeTruthy();
  });

  it('hard-disables the input when disabled, even while streaming', () => {
    const { container } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        disabled={true}
        isStreaming={true}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    const textarea = container.querySelector('textarea');
    expect(textarea?.disabled).toBe(true);
    // Falls back to the Send affordance, not Queue, when hard-disabled.
    expect(
      container.querySelector('button[aria-label="Send message"]'),
    ).toBeTruthy();
  });
});

describe('ChatComposer (mobile layout)', () => {
  const mockOnSend = vi.fn().mockResolvedValue(undefined);
  const mockOnAgentSelect = vi.fn();
  const mockAgents = [
    {
      id: 'agent-1',
      name: 'Test Agent',
      description: 'Does testing things',
      enabled: true,
      systemPrompt: 'Test',
      model: 'openai/gpt-4o-mini',
      defaults: {},
    },
  ];

  afterEach(() => {
    // Restore jsdom's default (no matchMedia) so other suites see desktop.
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('renders the agent chip, textarea, and an inline send button', () => {
    stubMobile(true);
    const { container } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    expect(
      container.querySelector('button[aria-label="Select agent"]'),
    ).toBeTruthy();
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(
      container.querySelector('button[aria-label="Send message"]'),
    ).toBeTruthy();
  });

  it('opens a bottom sheet listing agents when the chip is tapped', async () => {
    stubMobile(true);
    const { container, getByText } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    const chip = container.querySelector(
      'button[aria-label="Select agent"]',
    ) as HTMLButtonElement;
    fireEvent.click(chip);
    expect(getByText('Choose an agent')).toBeTruthy();
    expect(getByText('Test Agent')).toBeTruthy();
    expect(getByText('Does testing things')).toBeTruthy();
  });

  it('still queues while streaming on mobile', () => {
    stubMobile(true);
    const { container } = render(() => (
      <ChatComposer
        onSend={mockOnSend}
        isStreaming={true}
        agents={mockAgents}
        onAgentSelect={mockOnAgentSelect}
      />
    ));
    const textarea = container.querySelector('textarea');
    expect(textarea?.disabled).toBe(false);
    expect(
      container.querySelector('button[aria-label="Queue message"]'),
    ).toBeTruthy();
  });
});
