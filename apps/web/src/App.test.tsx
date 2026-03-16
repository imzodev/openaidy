import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import App from './App';

// Mock the API module
vi.mock('./lib/api', () => ({
  listSessions: vi.fn().mockResolvedValue({ items: [] }),
  createSession: vi.fn().mockResolvedValue({ id: '1', title: 'Test Session', createdAt: '2024-01-01T00:00:00Z' }),
  listMessages: vi.fn().mockResolvedValue({ items: [] }),
  submitMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock lucide-solid
vi.mock('lucide-solid', () => ({
  Plus: () => <span>+</span>,
  MessageSquare: () => <span>M</span>,
  Trash2: () => <span>T</span>,
  User: () => <span>U</span>,
  Bot: () => <span>B</span>,
  AlertCircle: () => <span>A</span>,
  Send: () => <span>S</span>,
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render welcome message when no session selected', async () => {
    render(() => <App />);
    
    // Should show welcome state initially
    expect(screen.getByText('Welcome to OpenAidy')).toBeInTheDocument();
  });
});
