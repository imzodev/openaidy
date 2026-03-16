import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { SessionList } from './SessionList';
import type { Session } from '../lib/api';

// Mock lucide-solid
vi.mock('lucide-solid', () => ({
  Plus: () => <span data-testid="plus-icon">+</span>,
  MessageSquare: () => <span data-testid="msg-icon">M</span>,
  Trash2: () => <span data-testid="trash-icon">T</span>,
}));

describe('SessionList', () => {
  const mockSessions: Session[] = [
    { id: '1', title: 'Test Session 1', createdAt: '2024-01-01T00:00:00Z' },
    { id: '2', title: 'Test Session 2', createdAt: '2024-01-02T00:00:00Z' },
  ];

  const mockOnSelect = vi.fn();
  const mockOnCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render empty state when no sessions', () => {
    render(() => (
      <SessionList
        sessions={[]}
        selectedId={undefined}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
      />
    ));

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
  });

  it('should render list of sessions', () => {
    render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
      />
    ));

    expect(screen.getByText('Test Session 1')).toBeInTheDocument();
    expect(screen.getByText('Test Session 2')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    render(() => (
      <SessionList
        sessions={[]}
        selectedId={undefined}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
        isLoading={true}
      />
    ));

    expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
  });

  it('should render new session button', () => {
    render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        onCreate={mockOnCreate}
      />
    ));

    const buttons = screen.getAllByRole('button');
    const newSessionBtn = buttons.find(btn => btn.textContent?.includes('New Session'));
    expect(newSessionBtn).toBeDefined();
  });
});
