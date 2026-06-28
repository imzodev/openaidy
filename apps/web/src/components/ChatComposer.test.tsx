import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { ChatComposer } from './ChatComposer';

// Mock lucide-solid
vi.mock('lucide-solid', () => ({
  Send: () => <span data-testid="send-icon">S</span>,
  ListPlus: () => <span data-testid="queue-icon">Q</span>,
  Bot: () => <span data-testid="bot-icon">B</span>,
  ChevronDown: () => <span data-testid="chevron-icon">V</span>,
}));

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
