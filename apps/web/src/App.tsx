import { createSignal, Show } from 'solid-js';
import { QueryClient, QueryClientProvider, createQuery, createMutation } from '@tanstack/solid-query';
import { 
  listSessions, 
  createSession, 
  listMessages, 
  submitMessage, 
  listAgents,
  listRuns,
  type Session, 
  type SessionMessage,
  type Agent,
  type SessionRun
} from './lib/api';
import { SessionList } from './components/SessionList';
import { ChatView } from './components/ChatView';
import { ChatComposer } from './components/ChatComposer';
import { RunList } from './components/RunList';
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
  const [selectedSessionId, setSelectedSessionId] = createSignal<string | undefined>(undefined);
  const [submitError, setSubmitError] = createSignal<string | undefined>(undefined);
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | undefined>(undefined);

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
    queryFn: () => selectedSessionId() ? listMessages(selectedSessionId()!) : { items: [] },
    enabled: !!selectedSessionId(),
  }));

  // Runs query
  const runsQuery = createQuery(() => ({
    queryKey: ['runs', selectedSessionId()],
    queryFn: () => selectedSessionId() ? listRuns(selectedSessionId()!) : { items: [] },
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
    mutationFn: ({ content, agentId }: { content: string; agentId?: string }) => {
      const sessionId = selectedSessionId();
      if (!sessionId) throw new Error('No session selected');
      return submitMessage(sessionId, { role: 'user', content, agentId });
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ['messages', selectedSessionId()] });
        queryClient.invalidateQueries({ queryKey: ['runs', selectedSessionId()] });
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

  // Handle message submission
  const handleSubmit = async (content: string, agentId?: string) => {
    setSubmitError(undefined);
    await submitMessageMutation.mutateAsync({ content, agentId });
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

  return (
    <div class="h-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <SessionList
        sessions={sessionsQuery.data?.items || []}
        selectedId={selectedSessionId()}
        onSelect={setSelectedSessionId}
        onCreate={handleCreateSession}
        isLoading={sessionsQuery.isLoading}
      />

      {/* Main Content */}
      <main class="flex-1 flex flex-col min-w-0">
        <Show when={!selectedSessionId()}>
          {/* Empty state */}
          <div class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                Welcome to OpenAidy
              </h1>
              <p class="text-gray-600 dark:text-gray-400 mb-4">
                Select a session or create a new one to start chatting
              </p>
              <button
                onClick={handleCreateSession}
                disabled={createSessionMutation.isPending}
                class="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-400 text-white rounded-lg transition-colors"
              >
                {createSessionMutation.isPending ? 'Creating...' : 'Create New Session'}
              </button>
            </div>
          </div>
        </Show>

        <Show when={selectedSessionId()}>
          {/* Header */}
          <header class="border-b border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {sessionsQuery.data?.items.find(s => s.id === selectedSessionId())?.title || 'Chat'}
            </h2>
          </header>

          {/* Messages */}
          <ChatView
            messages={messages()}
            isLoading={messagesQuery.isLoading}
            error={messagesQuery.error?.message}
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
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
