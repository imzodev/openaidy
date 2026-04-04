import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import App from './App';

// Mock the API module
vi.mock('./lib/ws-api', () => ({
  listSessions: vi.fn().mockResolvedValue({ items: [] }),
  createSession: vi.fn().mockResolvedValue({
    id: '1',
    title: 'Test Session',
    createdAt: '2024-01-01T00:00:00Z',
  }),
  listMessages: vi.fn().mockResolvedValue({ items: [] }),
  submitMessage: vi.fn().mockResolvedValue({ ok: true }),
  listAgents: vi.fn().mockResolvedValue({ items: [] }),
  listRuns: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock('./lib/ws-provider', () => ({
  WebSocketProvider: (props: { children: unknown }) => props.children,
  useWebSocketContext: () => ({
    client: () => null,
    state: () => 'disconnected',
    isConnected: () => false,
    error: () => undefined,
    presence: () => [],
    updatePresence: async () => {},
  }),
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
  Clock: () => <span>C</span>,
  CheckCircle: () => <span>CC</span>,
  XCircle: () => <span>XC</span>,
  Loader: () => <span>L</span>,
  ChevronDown: () => <span>CD</span>,
  ChevronLeft: () => <span>CL</span>,
  ChevronRight: () => <span>CR</span>,
  Settings: () => <span>SE</span>,
  CheckSquare: () => <span>CS</span>,
  Zap: () => <span>Z</span>,
  Link: () => <span>LI</span>,
  Webhook: () => <span>WH</span>,
  Wrench: () => <span>WR</span>,
  Server: () => <span>SV</span>,
  FileText: () => <span>FT</span>,
  Save: () => <span>SA</span>,
  Puzzle: () => <span>PZ</span>,
  Layers: () => <span>LA</span>,
  Sun: () => <span>Sun</span>,
  Moon: () => <span>Moon</span>,
  Monitor: () => <span>Monitor</span>,
  Menu: () => <span>Menu</span>,
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the app with sidebar', async () => {
    render(() => <App />);

    // Should show the sidebar with navigation (use getAllByText since 'Sessions' appears multiple times)
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
  });
});
