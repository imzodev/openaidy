import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { ChatView } from './ChatView';
import type { SessionMessage } from '../lib/api';

// Mock lucide-solid
vi.mock('lucide-solid', () => ({
  User: () => <span data-testid="user-icon">U</span>,
  Bot: () => <span data-testid="bot-icon">B</span>,
  AlertCircle: () => <span data-testid="alert-icon">A</span>,
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
    expect(screen.getByText('Hello, user! How can I help?')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(() => <ChatView messages={[]} isLoading={true} />);
    expect(screen.getByText('Loading messages...')).toBeInTheDocument();
  });

  it('should show error state', () => {
    render(() => <ChatView messages={[]} isLoading={false} error="Failed to load" />);
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });
});
