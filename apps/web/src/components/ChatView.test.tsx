import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  Copy: () => <span data-testid="copy" />,
  CircleStop: () => <span data-testid="circle-stop" />,
  Ban: () => <span data-testid="ban" />,
  ArrowUp: () => <span data-testid="arrow-up" />,
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

  describe('message copy buttons', () => {
    it('renders a copy button for every non-empty message', () => {
      render(() => <ChatView messages={mockMessages} isLoading={false} />);
      const buttons = screen.getAllByRole('button', { name: 'Copy' });
      expect(buttons).toHaveLength(mockMessages.length);
    });

    it('omits the copy button for empty messages', () => {
      render(() => (
        <ChatView
          messages={[{ ...mockMessages[0], content: '' }, mockMessages[1]]}
          isLoading={false}
        />
      ));
      const buttons = screen.getAllByRole('button', { name: 'Copy' });
      expect(buttons).toHaveLength(1);
    });

    it('copies the full message content when the button is clicked', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      render(() => <ChatView messages={mockMessages} isLoading={false} />);
      const buttons = screen.getAllByRole('button', { name: 'Copy' });
      fireEvent.click(buttons[0]);
      expect(writeText).toHaveBeenCalledWith('Hello, assistant!');
    });
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

  describe('auto-scroll containment', () => {
    beforeEach(() => {
      vi.mocked(Element.prototype.scrollTo).mockClear();
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
    });
    afterEach(() => {
      vi.mocked(Element.prototype.scrollTo).mockClear();
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
    });

    it('scrolls the chat container, not the document, when messages change', () => {
      const { container } = render(() => (
        <ChatView messages={mockMessages} isLoading={false} />
      ));
      // The scroll container is the first child div (the ref div with
      // overflow-y-auto). After mount + initial render, the auto-scroll
      // effect must have called scrollTo on it — never scrollIntoView on
      // any descendant.
      const scrollContainer = container.firstElementChild as HTMLElement;
      expect(scrollContainer).toBeTruthy();
      expect(vi.mocked(Element.prototype.scrollTo).mock.instances).toContain(
        scrollContainer,
      );
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });

    it('scrolls to a specific message inside the chat container', () => {
      const { container } = render(() => (
        <ChatView
          messages={mockMessages}
          isLoading={false}
          scrollToMessageId="1"
        />
      ));
      const scrollContainer = container.firstElementChild as HTMLElement;
      // The scrollTo for the run click should also land on the chat
      // container — never the document or a descendant element.
      expect(scrollContainer).toBeTruthy();
      const instances = vi.mocked(Element.prototype.scrollTo).mock.instances;
      expect(instances).toContain(scrollContainer);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
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

  describe('infinite scroll (load older messages)', () => {
    const baseMessages: SessionMessage[] = [
      {
        id: 'm-latest',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Latest reply',
        sequence: 100,
        createdAt: '2024-06-15T10:00:00Z',
      },
    ];

    it('renders the "Load older messages" button when hasMore is true', () => {
      render(() => (
        <ChatView
          messages={baseMessages}
          isLoading={false}
          hasMore={true}
          isLoadingMore={false}
          total={75}
          onLoadMore={() => {}}
        />
      ));
      expect(screen.getByTestId('load-more')).toBeInTheDocument();
    });

    it('invokes onLoadMore when the button is clicked', () => {
      const onLoadMore = vi.fn();
      render(() => (
        <ChatView
          messages={baseMessages}
          isLoading={false}
          hasMore={true}
          isLoadingMore={false}
          total={75}
          onLoadMore={onLoadMore}
        />
      ));
      fireEvent.click(screen.getByTestId('load-more'));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('renders a skeleton / loading label while isLoadingMore is true', () => {
      render(() => (
        <ChatView
          messages={baseMessages}
          isLoading={false}
          hasMore={true}
          isLoadingMore={true}
          total={75}
          onLoadMore={() => {}}
        />
      ));
      expect(screen.getByTestId('loading-more')).toBeInTheDocument();
      expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
    });

    it('hides the load-more control and shows an end-of-history banner when hasMore is false', () => {
      render(() => (
        <ChatView
          messages={baseMessages}
          isLoading={false}
          hasMore={false}
          isLoadingMore={false}
          total={1}
          onLoadMore={() => {}}
        />
      ));
      expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
      expect(screen.getByTestId('end-of-history')).toHaveTextContent(
        /1 message/,
      );
    });

    it('auto-triggers onLoadMore when the user scrolls to the top', () => {
      const onLoadMore = vi.fn();
      const { container } = render(() => (
        <ChatView
          messages={baseMessages}
          isLoading={false}
          hasMore={true}
          isLoadingMore={false}
          total={75}
          onLoadMore={onLoadMore}
        />
      ));
      // The scroll container is the first child div with overflow classes.
      const scrollContainer = container.firstElementChild as HTMLElement;
      scrollContainer.scrollTop = 0;
      fireEvent.scroll(scrollContainer);
      expect(onLoadMore).toHaveBeenCalled();
    });

    it('preserves a date separator when messages cross day boundaries', () => {
      const messages: SessionMessage[] = [
        {
          id: 'm-yesterday',
          sessionId: 'session-1',
          role: 'user',
          content: 'Yesterday message',
          sequence: 1,
          createdAt: '2024-06-14T23:30:00Z',
        },
        {
          id: 'm-today',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Today message',
          sequence: 2,
          createdAt: '2024-06-15T10:00:00Z',
        },
      ];
      const { container } = render(() => (
        <ChatView messages={messages} isLoading={false} />
      ));
      // The first message always gets a separator (no previous message).
      // The second message gets a separator because it's on a different UTC day.
      const separators = container.querySelectorAll('[data-date-separator]');
      expect(separators).toHaveLength(2);
    });
  });
});
