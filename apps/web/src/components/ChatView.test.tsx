import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { ChatView } from './ChatView';
import type { SessionMessage } from '../lib/api';
import type { QueuedMessage } from '../lib/types';

// Stub the icons ChatView and its child blocks render. Plain-object factory
// (a Proxy module mock hangs vitest collection here).
vi.mock('lucide-solid', () => ({
  User: () => <span data-testid="user" />,
  Bot: () => <span data-testid="bot" />,
  AlertCircle: () => <span data-testid="alert-circle" />,
  Wrench: () => <span data-testid="wrench" />,
  Server: () => <span data-testid="server" />,
  Brain: () => <span data-testid="brain" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  Loader: () => <span data-testid="loader" />,
  Clock: () => <span data-testid="clock" />,
  Pencil: () => <span data-testid="pencil" />,
  X: () => <span data-testid="x" />,
  Check: () => <span data-testid="check" />,
  CircleStop: () => <span data-testid="circle-stop" />,
  Ban: () => <span data-testid="ban" />,
}));

describe('ChatView', () => {
  const mockMessages: SessionMessage[] = [
    {
      id: '1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello, assistant!',
      sequence: 1,
      createdAt: '2024-01-01T10:00:00Z',
    },
    {
      id: '2',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Hello, user! How can I help?',
      sequence: 2,
      createdAt: '2024-01-01T10:01:00Z',
    },
  ];

  it('should render empty state when no messages', () => {
    render(() => <ChatView messages={[]} isLoading={false} />);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('should render messages', () => {
    render(() => <ChatView messages={mockMessages} isLoading={false} />);
    expect(screen.getByText('Hello, assistant!')).toBeInTheDocument();
    expect(
      screen.getByText('Hello, user! How can I help?'),
    ).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(() => <ChatView messages={[]} isLoading={true} />);
    expect(screen.getByText('Loading messages...')).toBeInTheDocument();
  });

  it('should show error state', () => {
    render(() => (
      <ChatView messages={[]} isLoading={false} error="Failed to load" />
    ));
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  describe('queued messages', () => {
    const queued: QueuedMessage[] = [
      { id: 'q1', content: 'First queued' },
      { id: 'q2', content: 'Second queued' },
    ];

    it('renders queued messages with their position', () => {
      render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          queuedMessages={queued}
        />
      ));
      expect(screen.getByText('First queued')).toBeInTheDocument();
      expect(screen.getByText('Second queued')).toBeInTheDocument();
      expect(screen.getByText('Queued · #1')).toBeInTheDocument();
      expect(screen.getByText('Queued · #2')).toBeInTheDocument();
    });

    it('invokes onRemoveQueued when remove is clicked', () => {
      const onRemoveQueued = vi.fn();
      const { container } = render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          queuedMessages={[queued[0]]}
          onRemoveQueued={onRemoveQueued}
        />
      ));
      const removeBtn = container.querySelector(
        'button[aria-label="Remove queued message"]',
      ) as HTMLButtonElement;
      fireEvent.click(removeBtn);
      expect(onRemoveQueued).toHaveBeenCalledWith('q1');
    });

    it('invokes onEditQueued after editing and saving', () => {
      const onEditQueued = vi.fn();
      const { container } = render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          queuedMessages={[queued[0]]}
          onEditQueued={onEditQueued}
        />
      ));
      fireEvent.click(
        container.querySelector(
          'button[aria-label="Edit queued message"]',
        ) as HTMLButtonElement,
      );
      const textarea = container.querySelector(
        'textarea',
      ) as HTMLTextAreaElement;
      fireEvent.input(textarea, { target: { value: 'Edited content' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onEditQueued).toHaveBeenCalledWith('q1', 'Edited content');
    });
  });

  describe('streaming tool calls', () => {
    const toolCall = {
      id: 'tc-1',
      name: 'exec_run',
      input: { command: 'npm test' },
    };

    it('renders live output for an in-flight tool call', () => {
      render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          isStreaming={true}
          streamingToolCalls={[{ ...toolCall, output: 'running tests...' }]}
        />
      ));
      expect(screen.getByText('running tests...')).toBeInTheDocument();
    });

    it('shows a Stop button and invokes onCancelTool with the tool id', () => {
      const onCancelTool = vi.fn();
      render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          isStreaming={true}
          streamingToolCalls={[toolCall]}
          onCancelTool={onCancelTool}
        />
      ));
      fireEvent.click(screen.getByText('Stop'));
      expect(onCancelTool).toHaveBeenCalledWith('tc-1');
    });

    it('shows a cancelled badge and no Stop button once cancelled', () => {
      const onCancelTool = vi.fn();
      render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          isStreaming={true}
          streamingToolCalls={[{ ...toolCall, cancelled: true }]}
          onCancelTool={onCancelTool}
        />
      ));
      expect(screen.getByText('Cancelled by user')).toBeInTheDocument();
      expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });

    it('shows a Stop agent button that invokes onCancelRun', () => {
      const onCancelRun = vi.fn();
      render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          isStreaming={true}
          onCancelRun={onCancelRun}
        />
      ));
      fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));
      expect(onCancelRun).toHaveBeenCalledTimes(1);
    });

    it('omits the Stop agent button when onCancelRun is not provided', () => {
      render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          isStreaming={true}
        />
      ));
      expect(
        screen.queryByRole('button', { name: 'Stop agent' }),
      ).not.toBeInTheDocument();
    });

    it('renders the activity badge from runActivity', () => {
      render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          isStreaming={true}
          runActivity={{
            phase: 'running_tool',
            toolName: 'exec_run',
            elapsedMs: 7000,
          }}
        />
      ));
      expect(screen.getByText('Running exec_run…')).toBeInTheDocument();
    });
  });
});
