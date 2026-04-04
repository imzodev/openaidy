import { createSignal, createEffect, Show } from 'solid-js';
import {
  QueryClient,
  QueryClientProvider,
  createQuery,
  createMutation,
} from '@tanstack/solid-query';
import { Menu, Settings, MessageSquare } from 'lucide-solid';
import {
  listSessions,
  createSession,
  listMessages,
  submitMessage,
  submitMessageStreaming,
  listAgents,
  listRuns,
  type Session,
  type SessionMessage,
  type Agent,
  type SessionRun,
} from './lib/ws-api';
import { ThemeProvider } from './lib/theme';
import { WebSocketProvider } from './lib/ws-provider';
import { Sidebar } from './components/Sidebar';
import type { ViewType } from './components/Sidebar';
import { SettingsView } from './components/settings/SettingsView';
import { ChatView } from './components/ChatView';
import { ChatComposer } from './components/ChatComposer';
import { RunList } from './components/RunList';
import { SessionsPage } from './components/pages/SessionsPage';
import { TasksPage } from './components/pages/TasksPage';
import { PulsesPage } from './components/pages/PulsesPage';
import { ChannelsPage } from './components/pages/ChannelsPage';
import { WebhooksPage } from './components/pages/WebhooksPage';
import { AgentsPage } from './components/pages/AgentsPage';
import { SkillsPage } from './components/pages/SkillsPage';
import { McpsPage } from './components/pages/McpsPage';
import { LogsPage } from './components/pages/LogsPage';
import { BackupsPage } from './components/pages/BackupsPage';
import { AddonsPage } from './components/pages/AddonsPage';
import './index.css';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const [selectedSessionId, setSelectedSessionId] = createSignal<
    string | undefined
  >(undefined);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [submitError, setSubmitError] = createSignal<string | undefined>(
    undefined,
  );
  const [selectedAgentId, setSelectedAgentId] = createSignal<
    string | undefined
  >(undefined);
  const [currentView, setCurrentView] = createSignal<ViewType>('sessions');
  const [streamingContent, setStreamingContent] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);

  // Sessions query
  const sessionsQuery = createQuery(() => ({
    queryKey: ['sessions'],
    queryFn: listSessions,
  }));

  // Agents query
  const agentsQuery = createQuery(() => ({
    queryKey: ['agents'],
    queryFn: listAgents,
  }));

  // Messages query
  const messagesQuery = createQuery(() => ({
    queryKey: ['messages', selectedSessionId()],
    queryFn: () =>
      selectedSessionId() ? listMessages(selectedSessionId()!) : { items: [] },
    enabled: !!selectedSessionId(),
  }));

  // Runs query
  const runsQuery = createQuery(() => ({
    queryKey: ['runs', selectedSessionId()],
    queryFn: () =>
      selectedSessionId() ? listRuns(selectedSessionId()!) : { items: [] },
    enabled: !!selectedSessionId(),
  }));

  // Create session mutation
  const createSessionMutation = createMutation(() => ({
    mutationFn: (title: string) => createSession(title),
    onSuccess: (session: Session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSelectedSessionId(session.id);
    },
  }));

  // Submit message mutation
  const submitMessageMutation = createMutation(() => ({
    mutationFn: ({
      content,
      agentId,
      providerId,
      modelId,
    }: {
      content: string;
      agentId?: string;
      providerId?: string;
      modelId?: string;
    }) => {
      const sessionId = selectedSessionId();
      if (!sessionId) throw new Error('No session selected');
      return submitMessage(sessionId, {
        role: 'user',
        content,
        agentId,
        providerId,
        modelId,
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({
          queryKey: ['messages', selectedSessionId()],
        });
        queryClient.invalidateQueries({
          queryKey: ['runs', selectedSessionId()],
        });
        setSubmitError(undefined);
      } else {
        setSubmitError(result.error.message);
      }
    },
    onError: (error: Error) => {
      setSubmitError(error.message);
    },
  }));

  // Handle session creation with default title
  const handleCreateSession = async () => {
    const title = `Session ${new Date().toLocaleString()}`;
    await createSessionMutation.mutateAsync(title);
  };

  // Handle message submission with streaming
  const handleSubmit = async (content: string, agentId?: string) => {
    const sessionId = selectedSessionId();
    if (!sessionId) {
      setSubmitError('No session selected');
      return;
    }

    setSubmitError(undefined);
    setIsStreaming(true);
    setStreamingContent('');

    // Find agent and extract provider/model from model field
    let providerId: string | undefined;
    let modelId: string | undefined;

    if (agentId) {
      const agent = agents().find((a) => a.id === agentId);
      console.log('[DEBUG] Found agent:', agent);
      if (agent?.model) {
        const parts = agent.model.split('/');
        console.log('[DEBUG] Model parts:', parts);
        if (parts.length === 2) {
          providerId = parts[0];
          modelId = parts[1];
        }
      }
    }

    console.log('[DEBUG] Submitting with streaming:', {
      agentId,
      providerId,
      modelId,
      content,
    });

    try {
      // Call the submitMessageStreaming to get initial response
      const result = await submitMessageStreaming(sessionId, {
        role: 'user',
        content,
        agentId,
        providerId,
        modelId,
      });

      if (!result.ok) {
        setSubmitError(result.error.message);
        setIsStreaming(false);
        return;
      }

      // Start listening to streaming events
      // The streaming hook will handle the events
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to submit message';
      setSubmitError(errorMessage);
      setIsStreaming(false);
    }
  };

  // Get messages array
  const messages = (): SessionMessage[] => {
    const data = messagesQuery.data;
    if (!data || 'error' in data) return [];
    return data.items || [];
  };

  // Get runs array
  const runs = (): SessionRun[] => {
    const data = runsQuery.data;
    if (!data || 'error' in data) return [];
    return data.items || [];
  };

  // Get agents array
  const agents = (): Agent[] => {
    return agentsQuery.data?.items || [];
  };

  // Auto-select first agent when agents load
  createEffect(() => {
    const agentList = agents();
    if (agentList.length > 0 && !selectedAgentId()) {
      setSelectedAgentId(agentList[0].id);
    }
  });

  return (
    <div class="h-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <Sidebar
        sessions={sessionsQuery.data?.items || []}
        selectedSessionId={selectedSessionId()}
        onSelectSession={setSelectedSessionId}
        onCreateSession={handleCreateSession}
        isLoadingSessions={sessionsQuery.isLoading}
        currentView={currentView()}
        onNavigate={setCurrentView}
        isCollapsed={isSidebarCollapsed()}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onCollapse={() => setIsSidebarCollapsed(true)}
      />

      {/* Main Content */}
      <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header class="sticky top-0 z-20 border-b border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-gray-900/80">
          <div class="flex items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <div class="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 shadow-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 md:hidden"
                aria-label="Toggle sidebar"
              >
                <Menu class="w-5 h-5" />
              </button>

              <div class="min-w-0">
                <div class="flex items-center gap-2 text-xs font-medium text-text-tertiary">
                  <span class="hidden sm:inline">OpenAidy</span>
                  <span class="hidden sm:inline">/</span>
                  <span class="inline-flex items-center gap-1.5">
                    <Show
                      when={currentView() === 'settings'}
                      fallback={<MessageSquare class="w-3.5 h-3.5" />}
                    >
                      <Settings class="w-3.5 h-3.5" />
                    </Show>
                    {currentView() === 'settings' ? 'Settings' : 'Chat'}
                  </span>
                </div>
              </div>
            </div>

            <div class="hidden sm:flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-text-tertiary shadow-sm">
              <span class="truncate max-w-[220px]">
                {currentView() === 'settings'
                  ? 'Manage configuration'
                  : selectedSessionId()
                    ? 'Active conversation'
                    : 'No session selected'}
              </span>
            </div>
          </div>
        </header>

        <Show when={currentView() === 'settings'}>
          <SettingsView />
        </Show>

        <Show when={currentView() === 'sessions'}>
          <SessionsPage
            sessions={sessionsQuery.data?.items || []}
            selectedSessionId={selectedSessionId()}
            onSelectSession={(id) => {
              setSelectedSessionId(id);
              setCurrentView('chat');
            }}
            onCreateSession={handleCreateSession}
            isLoading={sessionsQuery.isLoading}
          />
        </Show>

        <Show when={currentView() === 'tasks'}>
          <TasksPage />
        </Show>

        <Show when={currentView() === 'pulses'}>
          <PulsesPage />
        </Show>

        <Show when={currentView() === 'channels'}>
          <ChannelsPage />
        </Show>

        <Show when={currentView() === 'webhooks'}>
          <WebhooksPage />
        </Show>

        <Show when={currentView() === 'agents'}>
          <AgentsPage />
        </Show>

        <Show when={currentView() === 'skills'}>
          <SkillsPage />
        </Show>

        <Show when={currentView() === 'mcps'}>
          <McpsPage />
        </Show>

        <Show when={currentView() === 'logs'}>
          <LogsPage />
        </Show>

        <Show when={currentView() === 'backups'}>
          <BackupsPage />
        </Show>

        <Show when={currentView() === 'addons'}>
          <AddonsPage />
        </Show>

        <Show when={currentView() === 'chat'}>
          <Show when={!selectedSessionId()}>
            {/* Empty state */}
            <div class="flex-1 flex items-center justify-center">
              <div class="text-center">
                <h1 class="text-2xl font-bold text-text-primary mb-2">
                  Welcome to OpenAidy
                </h1>
                <p class="text-text-secondary mb-4">
                  Select a session or create a new one to start chatting
                </p>
                <button
                  onClick={handleCreateSession}
                  disabled={createSessionMutation.isPending}
                  class="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white rounded-lg transition-colors"
                >
                  {createSessionMutation.isPending
                    ? 'Creating...'
                    : 'Create New Session'}
                </button>
              </div>
            </div>
          </Show>

          <Show when={selectedSessionId()}>
            {/* Messages */}
            <ChatView
              messages={messages()}
              isLoading={messagesQuery.isLoading}
              error={messagesQuery.error?.message}
              streamingContent={isStreaming() ? streamingContent() : undefined}
            />

            {/* Runs panel */}
            <RunList
              runs={runs()}
              isLoading={runsQuery.isLoading}
              error={runsQuery.error?.message}
            />

            {/* Composer */}
            <ChatComposer
              onSend={handleSubmit}
              disabled={submitMessageMutation.isPending}
              placeholder="Type your message..."
              agents={agents()}
              selectedAgentId={selectedAgentId()}
              onAgentSelect={setSelectedAgentId}
            />

            {/* Error toast */}
            <Show when={submitError()}>
              <div class="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
                {submitError()}
              </div>
            </Show>
          </Show>
        </Show>
      </main>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <WebSocketProvider>
        <QueryClientProvider client={queryClient}>
          <AppContent />
        </QueryClientProvider>
      </WebSocketProvider>
    </ThemeProvider>
  );
}

export default App;
