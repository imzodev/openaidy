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
});
