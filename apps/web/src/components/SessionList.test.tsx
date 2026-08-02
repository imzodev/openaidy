import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@solidjs/testing-library';
import { SessionList } from './SessionList';
import type { Session } from '../lib/api';

// Stub the icons SessionList renders. Plain-object factory
// (a Proxy module mock hangs vitest collection here).
vi.mock('lucide-solid', () => ({
  MessageSquare: () => <span data-testid="message-square" />,
  Star: () => <span data-testid="star" />,
}));

describe('SessionList', () => {
  const mockSessions: Session[] = [
    { id: '1', title: 'Recent Session 1', createdAt: '2024-01-01T00:00:00Z' },
    { id: '2', title: 'Recent Session 2', createdAt: '2024-01-02T00:00:00Z' },
    {
      id: '3',
      title: 'Pinned Session',
      createdAt: '2024-01-03T00:00:00Z',
      favoritedAt: '2024-01-04T00:00:00Z',
    },
  ];

  const mockOnSelect = vi.fn();
  const mockOnToggleFavorite = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders recent (non-favorite) sessions under Recent', () => {
    render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        isCollapsed={false}
        isActiveView={true}
      />
    ));

    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Recent Session 1')).toBeInTheDocument();
    expect(screen.getByText('Recent Session 2')).toBeInTheDocument();
  });

  it('renders favorited sessions under a Favorites heading', () => {
    render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        isCollapsed={false}
        isActiveView={true}
      />
    ));

    expect(screen.getByText('Favorites')).toBeInTheDocument();
    expect(screen.getByText('Pinned Session')).toBeInTheDocument();
  });

  it('renders nothing when collapsed', () => {
    const { container } = render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        isCollapsed={true}
        isActiveView={true}
      />
    ));

    expect(container.textContent).toBe('');
  });

  it('shows loading state', () => {
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

  it('calls onSelect when a session is clicked', () => {
    render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        isCollapsed={false}
        isActiveView={true}
      />
    ));

    fireEvent.click(screen.getByText('Recent Session 1'));
    expect(mockOnSelect).toHaveBeenCalledWith('1');
  });

  it('calls onToggleFavorite when the star button is clicked', () => {
    render(() => (
      <SessionList
        sessions={mockSessions}
        selectedId={undefined}
        onSelect={mockOnSelect}
        onToggleFavorite={mockOnToggleFavorite}
        isCollapsed={false}
        isActiveView={true}
      />
    ));

    // The favorited session's star toggle should unfavorite it.
    const unfavBtn = screen.getByLabelText('Remove from favorites');
    fireEvent.click(unfavBtn);
    expect(mockOnToggleFavorite).toHaveBeenCalledWith('3', false);
  });
});
