import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import { AgentsPage } from './AgentsPage';

// AgentsPage calls useQueryClient() (to invalidate the shared ['agents']
// query on create — see handleAgentCreated), which throws without a
// QueryClientProvider ancestor. A fresh client per render keeps each test's
// cache isolated; retry: false keeps a mocked-rejection test from hanging.
function renderAgentsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(() => (
    <QueryClientProvider client={queryClient}>
      <AgentsPage />
    </QueryClientProvider>
  ));
  return { ...result, queryClient };
}

// The real form (name/model/provider fields) isn't this suite's concern —
// only that AgentsPage reacts correctly to onCreated. Stubbed to a single
// button that fires it with a fixed input once the modal is open.
const mockCreateAgentInput = {
  id: 'new-agent',
  name: 'New Agent',
  systemPrompt: 'Be helpful.',
  model: 'openai/gpt-4o-mini',
};

// Full-shape counterpart of mockCreateAgentInput — what `listAgents` would
// return for it after a successful create (the create-flow modal mock skips
// the createAgent round-trip and calls onCreated directly, but the
// post-create refresh in handleAgentCreated hits listAgents and the real
// server would include the just-created agent in that response).
const mockNewAgent = {
  id: 'new-agent',
  name: 'New Agent',
  description: '',
  enabled: true,
  systemPrompt: 'Be helpful.',
  model: 'openai/gpt-4o-mini',
  defaults: { providerId: 'openai', modelId: 'gpt-4o-mini' },
  tags: [],
};
vi.mock('./CreateAgentModal', () => ({
  CreateAgentModal: (props: {
    isOpen: boolean;
    onCreated: (agent: typeof mockCreateAgentInput) => void;
  }) => (
    // A plain `props.isOpen ? <A/> : null` ternary here would only
    // evaluate once at initial render (false, before any click) — it's not
    // inside a JSX child position Solid's compiler wraps reactively, so it
    // would never pick up showCreateModal() flipping true later. <Show>
    // is what actually re-evaluates when `isOpen` changes.
    <Show when={props.isOpen}>
      <button onClick={() => props.onCreated(mockCreateAgentInput)}>
        Submit new agent
      </button>
    </Show>
  ),
}));

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
    mockListAgents.mockResolvedValue({ items: [...mockAgents, mockNewAgent] });
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
      const { container } = renderAgentsPage();
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
      const { container } = renderAgentsPage();
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

      const { container } = renderAgentsPage();
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
      const { container } = renderAgentsPage();
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

  describe('create agent flow', () => {
    // Regression test: a freshly created agent used to not show up as
    // selected on the Chat page. Root cause was that handleAgentCreated
    // refreshed only this page's own local `agents` signal, never the
    // App.tsx-level ['agents'] query ChatComposer/AgentPicker actually
    // render from — so the new agent existed here but not there.
    //
    // Earlier fix attempts (#545, #547, #551) called `invalidateQueries`
    // after the create, which marked the shared query stale and refetched
    // in the background. A fast "Start Chat" click could navigate before
    // the refetch completed, so ChatComposer/AgentPicker mounted on stale
    // data and the new agent didn't appear in the picker. Calling
    // `setQueryData` instead updates the cache synchronously with the
    // data we just fetched, so any navigation after handleAgentCreated
    // resolves sees the new agent immediately, with no race window.
    // Asserting the setQueryData call directly (rather than re-deriving
    // App.tsx's whole query/picker chain in this file) is what pins the
    // fix.
    it('updates the shared agents query cache after creating an agent', async () => {
      setupMocks();
      const { container, queryClient } = renderAgentsPage();
      await waitForAgentsToRender(container);

      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

      const newAgentButton = container.querySelector(
        'button[title="New agent"]',
      );
      expect(newAgentButton).toBeTruthy();
      fireEvent.click(newAgentButton!);

      const submitButton = await waitFor(() => {
        const button = Array.from(container.querySelectorAll('button')).find(
          (b) => b.textContent === 'Submit new agent',
        );
        expect(button).toBeTruthy();
        return button!;
      });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(setQueryDataSpy).toHaveBeenCalledWith(
          ['agents'],
          expect.objectContaining({
            items: expect.arrayContaining([
              expect.objectContaining({ id: 'new-agent' }),
            ]),
          }),
        );
      });
    });
  });
});
