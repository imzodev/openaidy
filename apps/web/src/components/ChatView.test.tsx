import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { ChatView } from './ChatView';
import type { SessionMessage } from '../lib/api';
import type { QueuedMessage } from '../lib/types';

// Mock lucide-solid
vi.mock('lucide-solid', () => {
  const icon = (label: string) => () => <span data-testid={`${label}-icon`} />;
  return {
    User: icon('user'),
    Bot: icon('bot'),
    AlertCircle: icon('alert'),
    Wrench: icon('wrench'),
    Server: icon('server'),
    Loader: icon('loader'),
    ChevronDown: icon('chevron-down'),
    ChevronRight: icon('chevron-right'),
    Clock: icon('clock'),
    Pencil: icon('pencil'),
    X: icon('x'),
    Check: icon('check'),
  };
});

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
});
