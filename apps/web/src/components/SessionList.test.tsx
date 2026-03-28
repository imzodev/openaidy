import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render empty state when no sessions', () => {
    render(() => (
      <SessionList
        sessions={[]}
        selectedId={undefined}
        onSelect={mockOnSelect}
        isCollapsed={false}
        isActiveView={true}
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
        isCollapsed={false}
        isActiveView={true}
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
        isLoading={true}
        isCollapsed={false}
        isActiveView={true}
      />
    ));

    expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
  });

  it('should render delete button for each session', () => {
    render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        isCollapsed={false}
        isActiveView={true}
      />
    ));

    // Each session has a delete button (with aria-label)
    const deleteButtons = screen.getAllByLabelText('Delete session');
    expect(deleteButtons.length).toBe(2);
  });
});
