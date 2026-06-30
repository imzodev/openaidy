import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@solidjs/testing-library';
import { AgentsPage } from './AgentsPage';

// Stub the icons the AgentsPage render tree imports from lucide-solid.
// Plain-object factory — a Proxy module mock hangs vitest collection here.
vi.mock('lucide-solid', () => ({
  Bot: () => <span data-testid="bot" />,
  Folder: () => <span data-testid="folder" />,
  FileText: () => <span data-testid="file-text" />,
  Wrench: () => <span data-testid="wrench" />,
  Power: () => <span data-testid="power" />,
  PowerOff: () => <span data-testid="power-off" />,
  Lightbulb: () => <span data-testid="lightbulb" />,
  Plus: () => <span data-testid="plus" />,
  MessageSquare: () => <span data-testid="message-square" />,
  Server: () => <span data-testid="server" />,
  UserCircle: () => <span data-testid="user-circle" />,
  Save: () => <span data-testid="save" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
  ChevronLeft: () => <span data-testid="chevron-left" />,
  Trash2: () => <span data-testid="trash-2" />,
  X: () => <span data-testid="x" />,
}));

// Mock workspace components
vi.mock('../workspace', () => ({
  FileExplorer: () => <div data-testid="file-explorer">FileExplorer</div>,
  WorkspaceEditor: () => (
    <div data-testid="workspace-editor">WorkspaceEditor</div>
  ),
}));

// Mock API functions
const mockListAgents = vi.fn();
const mockListBuiltinTools = vi.fn();
const mockUpdateAgentTools = vi.fn();
const mockListAgentSkills = vi.fn();
const mockUpdateAgentSkills = vi.fn();
const mockListMcpServers = vi.fn();
const mockUpdateAgentMcpServers = vi.fn();
const mockGetConfig = vi.fn();
const mockGetPersonalityFile = vi.fn();
const mockUpdatePersonalityFile = vi.fn();
const mockDeleteAgent = vi.fn();

vi.mock('../../lib/api', () => ({
  listAgents: (...args: unknown[]) => mockListAgents(...args),
  listBuiltinTools: (...args: unknown[]) => mockListBuiltinTools(...args),
  updateAgentTools: (...args: unknown[]) => mockUpdateAgentTools(...args),
  listAgentSkills: (...args: unknown[]) => mockListAgentSkills(...args),
  updateAgentSkills: (...args: unknown[]) => mockUpdateAgentSkills(...args),
  listMcpServers: (...args: unknown[]) => mockListMcpServers(...args),
  updateAgentMcpServers: (...args: unknown[]) =>
    mockUpdateAgentMcpServers(...args),
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  getPersonalityFile: (...args: unknown[]) => mockGetPersonalityFile(...args),
  updatePersonalityFile: (...args: unknown[]) =>
    mockUpdatePersonalityFile(...args),
  deleteAgent: (...args: unknown[]) => mockDeleteAgent(...args),
}));

const mockAgents = [
  {
    id: 'agent-1',
    name: 'Test Agent 1',
    description: 'First test agent',
    enabled: true,
    systemPrompt: 'You are helpful.',
    model: 'openai/gpt-4o-mini',
    defaults: { providerId: 'openai', modelId: 'gpt-4o-mini' },
    tags: ['test'],
  },
  {
    id: 'agent-2',
    name: 'Test Agent 2',
    description: 'Second test agent',
    enabled: true,
    systemPrompt: 'You are a coding assistant.',
    model: 'anthropic/claude-3',
    defaults: { providerId: 'anthropic', modelId: 'claude-3' },
    tags: ['coding'],
  },
];

describe('AgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const setupMocks = () => {
    mockListAgents.mockResolvedValue({ items: mockAgents });
    mockListBuiltinTools.mockResolvedValue({ items: [] });
    mockUpdateAgentTools.mockResolvedValue(undefined);
    mockListAgentSkills.mockResolvedValue({ items: [] });
    mockUpdateAgentSkills.mockResolvedValue(undefined);
    mockListMcpServers.mockResolvedValue({ servers: [] });
    mockGetConfig.mockResolvedValue({
      config: {
        version: 1,
        defaults: { providerId: 'openai', modelId: 'gpt-4o-mini' },
        providers: [],
      },
    });
    mockDeleteAgent.mockResolvedValue(undefined);
  };

  const waitForAgentsToRender = async (container: Element) => {
    await waitFor(
      () => {
        const hasAgentText = container.textContent?.includes('Test Agent');
        expect(hasAgentText).toBe(true);
      },
      { timeout: 5000 },
    );
  };

  describe('delete agent flow', () => {
    it('should show confirmation dialog when delete button is clicked', async () => {
      setupMocks();
      const { container } = render(() => <AgentsPage />);
      await waitForAgentsToRender(container);

      // Window.confirm should be defined before we test it
      const originalConfirm = window.confirm;
      const mockConfirm = vi.fn().mockReturnValue(false);
      window.confirm = mockConfirm;

      try {
        // Find and click the delete button
        const deleteButton = container.querySelector(
          'button[title="Delete agent"]',
        );
        expect(deleteButton).toBeTruthy();

        fireEvent.click(deleteButton!);

        // Verify confirmation dialog was shown
        expect(mockConfirm).toHaveBeenCalledWith(
          expect.stringContaining('Delete agent "Test Agent 1"'),
        );
      } finally {
        window.confirm = originalConfirm;
      }
    });

    it('should call deleteAgent when user confirms deletion', async () => {
      setupMocks();
      const { container } = render(() => <AgentsPage />);
      await waitForAgentsToRender(container);

      const originalConfirm = window.confirm;
      const mockConfirm = vi.fn().mockReturnValue(true);
      window.confirm = mockConfirm;

      try {
        // Find and click the delete button
        const deleteButton = container.querySelector(
          'button[title="Delete agent"]',
        );
        expect(deleteButton).toBeTruthy();

        fireEvent.click(deleteButton!);

        // Verify deleteAgent was called
        expect(mockDeleteAgent).toHaveBeenCalledWith('agent-1');
      } finally {
        window.confirm = originalConfirm;
      }
    });

    it('should display error message when deletion fails', async () => {
      setupMocks();
      mockDeleteAgent.mockRejectedValue(new Error('Failed to delete agent'));

      const { container } = render(() => <AgentsPage />);
      await waitForAgentsToRender(container);

      const originalConfirm = window.confirm;
      const mockConfirm = vi.fn().mockReturnValue(true);
      window.confirm = mockConfirm;

      try {
        // Find and click the delete button
        const deleteButton = container.querySelector(
          'button[title="Delete agent"]',
        );
        expect(deleteButton).toBeTruthy();

        fireEvent.click(deleteButton!);

        // Wait for error to appear
        await waitFor(
          () => {
            const errorDiv = container.querySelector('.bg-red-50');
            expect(errorDiv).toBeTruthy();
            expect(errorDiv!.textContent).toContain('Failed to delete agent');
          },
          { timeout: 3000 },
        );
      } finally {
        window.confirm = originalConfirm;
      }
    });

    it('should not call deleteAgent when user cancels confirmation', async () => {
      setupMocks();
      const { container } = render(() => <AgentsPage />);
      await waitForAgentsToRender(container);

      const originalConfirm = window.confirm;
      const mockConfirm = vi.fn().mockReturnValue(false);
      window.confirm = mockConfirm;

      try {
        // Find and click the delete button
        const deleteButton = container.querySelector(
          'button[title="Delete agent"]',
        );
        expect(deleteButton).toBeTruthy();

        fireEvent.click(deleteButton!);

        // deleteAgent should not have been called
        expect(mockDeleteAgent).not.toHaveBeenCalled();
      } finally {
        window.confirm = originalConfirm;
      }
    });
  });
});
