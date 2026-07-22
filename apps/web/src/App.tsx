import { createSignal, createEffect, Show, onCleanup, onMount } from 'solid-js';
import {
  QueryClient,
  QueryClientProvider,
  createQuery,
  createMutation,
} from '@tanstack/solid-query';
import { Menu, Settings, MessageSquare, LogOut } from 'lucide-solid';
import {
  listSessions,
  createSession,
  listMessages,
  submitMessageStreaming,
  resumeSessionStream,
  listAgents,
  listRuns,
  getSession,
  type Session,
  type SessionMessage,
  type Agent,
  type SessionRun,
} from './lib/ws-api';
import { ThemeProvider, useTheme } from './lib/theme';
import { WebSocketProvider, useWebSocketContext } from './lib/ws-provider';
import { ConnectionStatus } from './components/ConnectionStatus';
import { PresenceIndicator } from './components/PresenceIndicator';
import { Sidebar } from './components/Sidebar';
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
import { UsagePage } from './components/pages/UsagePage';
import { BackupsPage } from './components/pages/BackupsPage';
import { AddonsPage } from './components/pages/AddonsPage';
import { AddonViewPage } from './components/pages/AddonViewPage';
import { AccessTokensPage } from './components/pages/AccessTokensPage';
import { createRouter } from './lib/router';
import { useMessageQueue } from './lib/use-message-queue';
import { LoginScreen } from './components/LoginScreen';
import { getStoredToken, resolveToken, clearToken } from './lib/auth-token';
import {
  listAddons,
  deleteSession,
  uploadAttachment,
  getConfig,
  getUsageBySession,
  checkForUpdates,
  type AddonRecord,
} from './lib/api';
import { ProviderOnboarding } from './components/onboarding/ProviderOnboarding';
import type { ChoicesEvent } from '@openaidy/shared-types';
import { ChoicesCard } from './components/ChoicesCard';
import { PausedRunNotice } from './components/PausedRunNotice';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import {
  CommandPalette,
  useCommandPaletteHotkey,
} from './components/ui/CommandPalette';
import type { CommandContext } from './components/ui/command-registry';
import {
  initRecentItems,
  recordRecentSession,
  recordRecentAgent,
} from './stores/recent-items';
import { initUpdateNotice, recordUpdateCheck } from './stores/update-notice';
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

type AppContentProps = {
  onLogout: () => void;
};

function AppContent(props: AppContentProps) {
  // Load recent-items once on mount so the command palette can render
  // persisted recents before the user types anything.
  initRecentItems();

  // Hydrate the dismissed-update marker, then run a best-effort update check so
  // the Settings sidebar badge can show without the user opening Settings.
  // Fails silently offline or for non-admin tokens (the check is admin-scoped).
  initUpdateNotice();
  void checkForUpdates()
    .then(recordUpdateCheck)
    .catch(() => {
      /* offline / non-admin — no badge */
    });

  // Use the router hook
  const { currentView, currentAddonId, navigate, navigateToAddon } =
    createRouter();

  // Get WebSocket client for streaming events
  const { client, isConnected } = useWebSocketContext();

  const [selectedSessionId, setSelectedSessionId] = createSignal<
    string | undefined
  >(undefined);
  const [enabledAddons, setEnabledAddons] = createSignal<AddonRecord[]>([]);
  const activeAddon = () =>
    enabledAddons().find((a) => a.addonId === currentAddonId());

  const loadEnabledAddons = async () => {
    const token = resolveToken() ?? '';
    try {
      const data = await listAddons(token);
      setEnabledAddons(data.addons.filter((a) => a.status === 'enabled'));
    } catch {
      // non-fatal
    }
  };

  void loadEnabledAddons();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [submitError, setSubmitError] = createSignal<string | undefined>(
    undefined,
  );
  const [focusChatInput, setFocusChatInput] = createSignal<
    (() => void) | undefined
  >(undefined);
  const [selectedAgentId, setSelectedAgentId] = createSignal<
    string | undefined
  >(undefined);
  const [streamingContent, setStreamingContent] = createSignal('');
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingToolCalls, setStreamingToolCalls] = createSignal<
    Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
      /** Live stdout/stderr accumulated from run.exec_output (e.g. exec_run). */
      output?: string;
      /** Set once the user cancels this tool call. */
      cancelled?: boolean;
    }>
  >([]);
  // The active run's id (from stream events), needed to address a tool cancel.
  const [currentRunId, setCurrentRunId] = createSignal<string | undefined>(
    undefined,
  );
  // Server-driven activity heartbeat for the current run (#378).
  const [runActivity, setRunActivity] = createSignal<
    | {
        phase: 'thinking' | 'running_tool' | 'cancelled' | 'failed';
        toolName?: string;
        elapsedMs: number;
      }
    | undefined
  >(undefined);
  // Client-side queue of messages typed while the agent is responding.
  const messageQueue = useMessageQueue();
  const [pendingUserMessage, setPendingUserMessage] = createSignal<
    SessionMessage | undefined
  >(undefined);
  const [currentChoices, setCurrentChoices] = createSignal<ChoicesEvent | null>(
    null,
  );
  /** Message ID to scroll to in ChatView (set when user clicks a run) */
  const [scrollToMessageId, setScrollToMessageId] = createSignal<
    string | undefined
  >(undefined);
  const [sessionToDelete, setSessionToDelete] = createSignal<Session | null>(
    null,
  );
  const [isDeletingSession, setIsDeletingSession] = createSignal(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = createSignal(false);

  // Theme context for the "Toggle Theme" command.
  const { theme, setTheme } = useTheme();

  // ⌘K / Ctrl+K opens the palette.
  useCommandPaletteHotkey(setIsCommandPaletteOpen);

  // ── Stream watchdog ────────────────────────────────────────────────────────
  // `isStreaming` is a single app-wide flag that gates ALL sends and is only
  // cleared by a `session.stream.end` event. If a run hangs server-side, or an
  // `end` is lost (e.g. a reconnect after a network blip / server restart), the
  // flag would stay `true` forever — silently queueing every future message in
  // every session and never refetching messages. This watchdog recovers the UI
  // if the stream goes idle (no start/delta/tool_call/end) for too long.
  const STREAM_IDLE_TIMEOUT_MS = 120_000;
  let streamWatchdog: ReturnType<typeof setTimeout> | undefined;
  const clearStreamWatchdog = () => {
    if (streamWatchdog !== undefined) {
      clearTimeout(streamWatchdog);
      streamWatchdog = undefined;
    }
  };
  const armStreamWatchdog = () => {
    clearStreamWatchdog();
    streamWatchdog = setTimeout(() => {
      streamWatchdog = undefined;
      if (!isStreaming()) return;
      // Assume the stream is dead — recover so the UI isn't permanently stuck.
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingToolCalls([]);
      setRunActivity(undefined);
      setPendingUserMessage(undefined);
      const sid = selectedSessionId();
      if (sid) {
        queryClient.invalidateQueries({ queryKey: ['messages', sid] });
        queryClient.invalidateQueries({ queryKey: ['runs', sid] });
      }
      processQueue();
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  // Subscribe to streaming events when a session is selected
  createEffect(() => {
    const sessionId = selectedSessionId();
    const wsClient = client();

    if (!sessionId || !wsClient || !isConnected()) return;

    // Subscribe to session stream events
    const handleStreamStart = () => {
      setIsStreaming(true);
      setStreamingContent('');
      setStreamingToolCalls([]);
      setRunActivity({ phase: 'thinking', elapsedMs: 0 });
      armStreamWatchdog();
    };

    // Server-driven activity heartbeat — what the agent is doing between
    // events, with a run-elapsed counter the badge ticks locally (#378).
    const handleActivity = (event: {
      payload: {
        phase: 'thinking' | 'running_tool';
        toolName?: string;
        elapsedMs: number;
      };
    }) => {
      const { phase, toolName, elapsedMs } = event.payload;
      setRunActivity({ phase, elapsedMs, ...(toolName ? { toolName } : {}) });
      armStreamWatchdog();
    };

    const handleStreamDelta = (event: { payload: { content: string } }) => {
      setStreamingContent((prev) => prev + event.payload.content);
      armStreamWatchdog();
    };

    const handleStreamToolCall = (event: {
      payload: {
        runId?: string;
        toolCall: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
      };
    }) => {
      const tc = event.payload.toolCall;
      if (event.payload.runId) setCurrentRunId(event.payload.runId);
      setStreamingToolCalls((prev) => [
        ...prev,
        { id: tc.id, name: tc.name, input: tc.arguments, output: '' },
      ]);
      armStreamWatchdog();
    };

    // Live stdout/stderr from an in-flight tool (e.g. exec_run) — append to the
    // matching tool call, keeping the most recent 50 KB (matches server cap).
    const handleExecOutput = (event: {
      payload: {
        runId: string;
        toolCallId: string;
        stream: 'stdout' | 'stderr';
        data: string;
      };
    }) => {
      setCurrentRunId(event.payload.runId);
      const { toolCallId, data } = event.payload;
      setStreamingToolCalls((prev) =>
        prev.map((tc) =>
          tc.id === toolCallId
            ? { ...tc, output: ((tc.output ?? '') + data).slice(-51_200) }
            : tc,
        ),
      );
      armStreamWatchdog();
    };

    const handleToolCancelled = (event: {
      payload: { toolCallId: string };
    }) => {
      const { toolCallId } = event.payload;
      setStreamingToolCalls((prev) =>
        prev.map((tc) =>
          tc.id === toolCallId ? { ...tc, cancelled: true } : tc,
        ),
      );
    };

    const handleRunCancelled = () => {
      // User hit "Stop agent": tear down the streaming UI, drop any partial
      // content, and refresh so the run shows its cancelled status (#376).
      clearStreamWatchdog();
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingToolCalls([]);
      setRunActivity(undefined);
      setPendingUserMessage(undefined);
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['runs', sessionId] });
      processQueue();
    };

    const handleStreamEnd = () => {
      clearStreamWatchdog();
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingToolCalls([]);
      setRunActivity(undefined);
      setPendingUserMessage(undefined);
      // Refresh messages to show the completed response
      queryClient.invalidateQueries({
        queryKey: ['messages', sessionId],
      });
      queryClient.invalidateQueries({
        queryKey: ['runs', sessionId],
      });
      // A completed run adds tokens/cost — refresh the per-session usage that
      // the sessions cards display.
      queryClient.invalidateQueries({ queryKey: ['session-usage'] });
      // Drain the next queued message, if any, now that the run is idle.
      processQueue();
      // Focus the chat input after streaming completes
      setTimeout(() => focusChatInput()?.(), 50);
    };

    const handleStreamError = (event: {
      payload: { error: { message: string } };
    }) => {
      clearStreamWatchdog();
      setSubmitError(event.payload.error.message);
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingToolCalls([]);
      setRunActivity(undefined);
      setPendingUserMessage(undefined);
    };

    const handleSessionUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    };

    const handleChoicesEvent = (event: { payload: ChoicesEvent }) => {
      clearStreamWatchdog();
      setCurrentChoices(event.payload);
      // Clear streaming state so input becomes enabled for user to type their own answer
      setIsStreaming(false);
      setStreamingContent('');
    };

    const unsubStart = wsClient.on('session.stream.start', handleStreamStart);
    const unsubDelta = wsClient.on('session.stream.delta', handleStreamDelta);
    const unsubToolCall = wsClient.on(
      'session.stream.tool_call',
      handleStreamToolCall,
    );
    const unsubEnd = wsClient.on('session.stream.end', handleStreamEnd);
    const unsubError = wsClient.on('session.stream.error', handleStreamError);
    const unsubUpdated = wsClient.on('session.updated', handleSessionUpdated);
    const unsubChoices = wsClient.on('session.run.choices', handleChoicesEvent);
    const unsubExecOutput = wsClient.on(
      'session.stream.exec_output',
      handleExecOutput,
    );
    const unsubToolCancelled = wsClient.on(
      'session.stream.tool_cancelled',
      handleToolCancelled,
    );
    const unsubRunCancelled = wsClient.on(
      'session.stream.run_cancelled',
      handleRunCancelled,
    );
    const unsubActivity = wsClient.on(
      'session.stream.activity',
      handleActivity,
    );

    // Subscribe to the session. A successful (re)subscribe means we have a
    // live connection but may have missed events while disconnected, so
    // reconcile any stale streaming state right away instead of waiting on
    // the watchdog.
    wsClient
      .subscribeToSession(sessionId)
      .then(() => void resumeOrReconcile())
      .catch((err: Error) => {
        console.error('Failed to subscribe to session:', err);
        setSubmitError(err.message);
      });

    onCleanup(() => {
      unsubStart();
      unsubDelta();
      unsubToolCall();
      unsubEnd();
      unsubError();
      unsubUpdated();
      unsubChoices();
      unsubExecOutput();
      unsubToolCancelled();
      unsubRunCancelled();
      unsubActivity();
      setFocusChatInput(undefined); // Clear stale focus function
    });
  });

  // Handle sessionId from URL params on initial load
  onMount(() => {
    const sessionIdFromUrl = new URL(window.location.href).searchParams.get(
      'sessionId',
    );
    if (sessionIdFromUrl) {
      setSelectedSessionId(sessionIdFromUrl);
    }
  });

  // Backgrounding a tab/app can leave the socket looking "connected" while it
  // has actually stopped delivering events (throttled timers, suspended
  // heartbeat). Reconcile as soon as the app is foregrounded again rather
  // than waiting for the socket to notice and the watchdog to fire.
  onMount(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void resumeOrReconcile();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    onCleanup(() =>
      document.removeEventListener('visibilitychange', handleVisibility),
    );
  });

  // Note: We do NOT clear selectedAgentId when session changes.
  // This allows the "Start Chat with Agent" flow to preserve the selected agent.
  // If user wants to use session's stored agent, they can deselect explicitly.

  // Sessions query
  const sessionsQuery = createQuery(() => ({
    queryKey: ['sessions'],
    queryFn: listSessions,
  }));

  // Per-session usage totals (tokens + cost), keyed by session id, for the
  // usage shown on session cards. One batched request rather than per-card.
  const sessionUsageQuery = createQuery(() => ({
    queryKey: ['session-usage'],
    queryFn: getUsageBySession,
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

  // Session query - to get session.agentId for agent selection
  const sessionQuery = createQuery(() => ({
    queryKey: ['session', selectedSessionId()],
    queryFn: async () => {
      const sessionId = selectedSessionId();
      if (!sessionId) return null;
      return getSession(sessionId);
    },
    enabled: !!selectedSessionId(),
  }));

  // Drives the first-run onboarding gate. A fresh install has no provider
  // configured; we show the onboarding screen until the user sets one up.
  // The ['config'] key is shared with the settings `useConfig` hook, so saving
  // a provider during onboarding invalidates and refreshes this automatically.
  const configGateQuery = createQuery(() => ({
    queryKey: ['config'],
    queryFn: getConfig,
  }));

  // True once config has loaded and the install is still unconfigured: there
  // is no usable default provider. We key off `config.defaults.providerId`
  // (which onboarding sets when it configures the first provider — local or
  // remote) rather than credential connection status, because a credential can
  // exist in the DB for a provider that is not in `config.providers` (e.g. a
  // leftover from earlier testing); such a provider is "connected" but not
  // usable for chat. Requiring the default to actually exist in the provider
  // list is the correct "can the user chat?" signal. While loading we return
  // false so a configured user isn't shown a flash of onboarding.
  const needsProviderSetup = () => {
    const data = configGateQuery.data;
    const cfg = data && 'config' in data ? data.config : undefined;
    if (!cfg) return false;
    const defaultProviderId = cfg.defaults?.providerId;
    if (!defaultProviderId) return true;
    const configured = cfg.providers?.some((p) => p.id === defaultProviderId);
    return !configured;
  };

  // Effective model ("providerId/modelId") for the active agent: the agent's
  // own model, or the project default when the agent is model-less. Shown in
  // the RunList header next to the session's usage totals.
  const effectiveModel = (): string | undefined => {
    const agent = agents().find((a) => a.id === effectiveAgentId());
    if (agent?.model) return agent.model;
    const data = configGateQuery.data;
    const cfg = data && 'config' in data ? data.config : undefined;
    const d = cfg?.defaults;
    return d?.providerId && d?.modelId
      ? `${d.providerId}/${d.modelId}`
      : undefined;
  };

  // Create session mutation
  const createSessionMutation = createMutation(() => ({
    mutationFn: (title: string) => createSession(title),
    onSuccess: (session: Session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSelectedSessionId(session.id);
      navigate('chat');
    },
  }));

  // Handlers
  const handleCreateSession = async () => {
    const title = `Session ${new Date().toISOString()}`;
    await createSessionMutation.mutateAsync(title);
  };

  const handleStartChatWithAgent = async (agentId: string) => {
    setSelectedAgentId(agentId);
    const title = `Session ${new Date().toISOString()}`;
    await createSessionMutation.mutateAsync(title);
  };

  const handleDeleteSession = (id: string) => {
    const session = sessionsQuery.data?.items.find((s) => s.id === id) ?? null;
    setSessionToDelete(session);
  };

  const handleConfirmDelete = async () => {
    const session = sessionToDelete();
    if (!session) return;
    setIsDeletingSession(true);
    try {
      await deleteSession(session.id);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (selectedSessionId() === session.id) {
        setSelectedSessionId(undefined);
      }
      setSessionToDelete(null);
    } catch {
      // non-fatal — modal stays open so user can retry
    } finally {
      setIsDeletingSession(false);
    }
  };

  // Queue-aware entry point used by the composer and the choices card.
  // While a run is in flight the message is queued; otherwise it is sent now.
  // Files are uploaded immediately (they don't need the run to be idle) and
  // travel as attachment ids from then on.
  const handleSubmit = async (
    content: string,
    agentId?: string,
    files?: File[],
  ) => {
    const sessionId = selectedSessionId();
    if (!sessionId) {
      setSubmitError('No session selected');
      return;
    }

    let attachmentIds: string[] | undefined;
    if (files?.length) {
      try {
        const uploaded = await Promise.all(
          files.map((file) => uploadAttachment(sessionId, file)),
        );
        attachmentIds = uploaded.map((a) => a.id);
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to upload attachment',
        );
        throw err instanceof Error
          ? err
          : new Error('Failed to upload attachment');
      }
    }

    if (isStreaming()) {
      messageQueue.enqueue(content, agentId, attachmentIds);
      return;
    }
    await sendMessage(content, agentId, attachmentIds);
  };

  // User hit Stop on an in-flight tool call — ask the server to cancel it.
  const handleCancelTool = (toolCallId: string) => {
    const wsClient = client();
    const sid = selectedSessionId();
    const rid = currentRunId();
    if (wsClient && sid && rid) {
      wsClient.cancelTool(sid, rid, toolCallId);
    }
  };

  // User hit "Stop agent" — ask the server to cancel the whole run (#376).
  const handleCancelRun = () => {
    const wsClient = client();
    const sid = selectedSessionId();
    const rid = currentRunId();
    if (wsClient && sid && rid) {
      wsClient.cancelRun(sid, rid);
    }
  };

  // Drain the next queued message once the run is idle and the user is not
  // being asked to answer a choices prompt (pause-on-interruption). No-op
  // otherwise, so it is safe to call opportunistically.
  const processQueue = () => {
    if (isStreaming() || currentChoices()) return;
    const next = messageQueue.dequeue();
    if (next) {
      void sendMessage(next.content, next.agentId, next.attachmentIds);
    }
  };

  // Force-refresh messages/runs and drop any stuck streaming state. There is
  // no server-side mechanism to resume a run's live stream after a dropped
  // connection, so once we're (re)connected the only reliable signal is a
  // fresh fetch. Called after every successful session subscribe (covers
  // reconnect) and on tab/app visibility regain (covers a connection that
  // silently stopped delivering events without actually closing).
  const reconcileStreamState = () => {
    const sessionId = selectedSessionId();
    if (!sessionId) return;
    if (isStreaming()) {
      clearStreamWatchdog();
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingToolCalls([]);
      setRunActivity(undefined);
      setPendingUserMessage(undefined);
    }
    queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['runs', sessionId] });
    processQueue();
  };

  // On reconnect / tab-foreground, first ask the server whether a run is still
  // streaming for this session (issue #450). If so, rehydrate the live UI from
  // the server's snapshot — content, tool calls, activity — instead of clearing
  // to a stalled state; live `session.stream.*` events then continue on the
  // resubscribed run. Only when there's nothing to resume do we fall back to
  // the plain clear-and-refetch of `reconcileStreamState`.
  const resumeOrReconcile = async () => {
    const sessionId = selectedSessionId();
    if (!sessionId) return;

    const resume = await resumeSessionStream(sessionId).catch(() => null);

    // Bail if the user switched sessions while we awaited.
    if (selectedSessionId() !== sessionId) return;

    if (resume?.active && resume.runId) {
      clearStreamWatchdog();
      setCurrentRunId(resume.runId);
      setIsStreaming(true);
      setStreamingContent(resume.content ?? '');
      setStreamingToolCalls(
        (resume.toolCalls ?? []).map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
          output: '',
        })),
      );
      setRunActivity(resume.activity ? { ...resume.activity } : undefined);
      setPendingUserMessage(undefined);
      // Pull the persisted user message (and any finished prior runs) without
      // disturbing the live streaming state we just restored; the assistant
      // message is not persisted until the run ends.
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['runs', sessionId] });
      // Re-arm the idle guard in case we also missed the end event.
      armStreamWatchdog();
      return;
    }

    reconcileStreamState();
  };

  // Actually dispatch a message and begin a streaming run.
  const sendMessage = async (
    content: string,
    agentId?: string,
    attachmentIds?: string[],
  ) => {
    const sessionId = selectedSessionId();
    if (!sessionId) {
      setSubmitError('No session selected');
      return;
    }

    setSubmitError(undefined);
    setCurrentChoices(null);
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingToolCalls([]);
    // Guard against a `start`/`end` that never arrives (hung run, lost event).
    armStreamWatchdog();
    setPendingUserMessage({
      id: `pending-${Date.now()}`,
      sessionId,
      role: 'user',
      content,
      sequence: -1,
      createdAt: new Date().toISOString(),
    });

    // Find agent and extract provider/model from model field
    let providerId: string | undefined;
    let modelId: string | undefined;

    if (agentId) {
      const agent = agents().find((a) => a.id === agentId);
      if (agent?.model) {
        const parts = agent.model.split('/');
        if (parts.length === 2) {
          providerId = parts[0];
          modelId = parts[1];
        }
      }
    }

    try {
      const result = await submitMessageStreaming(sessionId, {
        role: 'user',
        content,
        agentId,
        providerId,
        modelId,
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      });

      if (!result.ok) {
        setSubmitError(result.error.message);
        setIsStreaming(false);
        setPendingUserMessage(undefined);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to submit message';
      setSubmitError(errorMessage);
      setIsStreaming(false);
      setPendingUserMessage(undefined);
    }
  };

  // Effective agentId - user selection takes precedence, then session, then fallback
  const effectiveAgentId = (): string | undefined => {
    // If user has explicitly selected an agent (via dropdown), use it
    const explicitSelection = selectedAgentId();
    if (explicitSelection) {
      return explicitSelection;
    }

    // Otherwise, derive from session's stored agentId
    const sessionData = sessionQuery.data;
    const sessionAgentId =
      !sessionData || 'error' in sessionData ? null : sessionData?.agentId;
    if (sessionAgentId) {
      return sessionAgentId;
    }

    // Fallback to first available agent
    const agentList = agents();
    return agentList.length > 0 ? agentList[0].id : undefined;
  };

  // Handle agent selection - update local state for immediate UI feedback
  const handleAgentSelect = (agentId: string | undefined) => {
    setSelectedAgentId(agentId);
  };

  // Data accessors
  const messages = (): SessionMessage[] => {
    const data = messagesQuery.data;
    const fetched = !data || 'error' in data ? [] : data.items || [];
    const pending = pendingUserMessage();
    if (!pending) return fetched;
    // Show pending message only if it's not already in the fetched list
    const alreadySaved = fetched.some(
      (m) => m.role === 'user' && m.content === pending.content,
    );
    return alreadySaved ? fetched : [...fetched, pending];
  };

  const runs = (): SessionRun[] => {
    const data = runsQuery.data;
    if (!data || 'error' in data) return [];
    return data.items || [];
  };

  // The latest run "paused" mid-task: it succeeded but with finish_reason
  // `tool_calls`, meaning the agent wanted to keep going (hit its step limit
  // or a degenerate empty turn). Surface a resume affordance instead of
  // letting it look complete. Runs come back newest-first. Hidden while
  // streaming or when a choices prompt is pending (mutually exclusive UIs).
  const isPausedMidTask = (): boolean => {
    if (isStreaming() || currentChoices()) return false;
    const latest = runs()[0];
    return (
      latest?.status === 'succeeded' && latest?.finishReason === 'tool_calls'
    );
  };

  const agents = (): Agent[] => {
    return agentsQuery.data?.items || [];
  };

  // Auto-select most recent session when on chat view with no session selected
  createEffect(() => {
    const sessionList = sessionsQuery.data?.items || [];
    const currentView = view();
    const currentSelectedId = selectedSessionId();

    if (
      currentView === 'chat' &&
      !currentSelectedId &&
      sessionList.length > 0
    ) {
      // Sort by updatedAt (last activity) descending, falling back to createdAt.
      // The server bumps updatedAt on every successful run (via
      // updateSessionAgentId) and broadcasts session.updated, so a session the
      // user just chatted with floats to the top.
      const activityMs = (s: (typeof sessionList)[number]) =>
        new Date(s.updatedAt ?? s.createdAt ?? 0).getTime();
      const sorted = [...sessionList].sort(
        (a, b) => activityMs(b) - activityMs(a),
      );
      setSelectedSessionId(sorted[0].id);
    }
  });

  // Refetch sessions when navigating to the sessions view
  createEffect(() => {
    if (currentView() === 'sessions') {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
  });

  // Reset transient chat state when switching sessions. Critically, this clears
  // `isStreaming` — otherwise a hung or lost stream in the previous session
  // would leave the app-wide flag stuck `true`, freezing composing and message
  // rendering in every session you switch to afterwards.
  createEffect(() => {
    const sessionId = selectedSessionId();
    if (sessionId) {
      clearStreamWatchdog();
      setCurrentChoices(null);
      setIsStreaming(false);
      setStreamingContent('');
      setStreamingToolCalls([]);
      setPendingUserMessage(undefined);
    }
  });

  // Current view for conditional rendering
  const view = () => currentView();

  // Record a session visit for the command palette "Recent" section.
  // Lookup the session title from the cached list so the palette can show
  // human-readable labels instead of bare ids.
  const rememberSession = (id: string) => {
    const session = sessionsQuery.data?.items.find((s) => s.id === id);
    recordRecentSession({
      id,
      title: session?.title ?? `Session ${id.slice(0, 6)}`,
    });
  };

  const rememberAgent = (id: string) => {
    const agent = agents().find((a) => a.id === id);
    recordRecentAgent({ id, name: agent?.name ?? id });
  };

  // Re-run recent-tracking whenever the selected session changes. Effect
  // intentionally runs only when the id actually changes; reading
  // `selectedSessionId()` is the trigger.
  createEffect(() => {
    const sid = selectedSessionId();
    if (sid) rememberSession(sid);
  });

  createEffect(() => {
    const aid = effectiveAgentId();
    if (aid) rememberAgent(aid);
  });

  // Command palette context. Built inline so each callback closes over the
  // freshest signal values when the user invokes a command.
  const commandCtx: CommandContext = {
    navigate,
    navigateToAddon,
    newSession: handleCreateSession,
    toggleTheme: () => {
      // Cycle light → dark → system → light, matching ThemeToggle.
      const next =
        theme() === 'light' ? 'dark' : theme() === 'dark' ? 'system' : 'light';
      setTheme(next);
    },
    toggleSidebar: () => setIsSidebarCollapsed((prev) => !prev),
    stopAgent: isStreaming() ? handleCancelRun : undefined,
    focusChatInput: () => focusChatInput()?.(),
    getCurrentMessages: () => messages(),
    notify: (message) => setSubmitError(message),
    openRecentSession: (id) => {
      setSelectedSessionId(id);
      navigate('chat');
    },
    openRecentAgent: (id) => {
      void handleStartChatWithAgent(id);
    },
  };

  return (
    <div class="h-dvh flex overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <Sidebar
        sessions={sessionsQuery.data?.items || []}
        selectedSessionId={selectedSessionId()}
        onSelectSession={setSelectedSessionId}
        onClearSession={() => setSelectedSessionId(undefined)}
        onCreateSession={handleCreateSession}
        isLoadingSessions={sessionsQuery.isLoading}
        currentView={view()}
        onNavigate={navigate}
        isCollapsed={isSidebarCollapsed()}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onCollapse={() => setIsSidebarCollapsed(true)}
        enabledAddons={enabledAddons()}
        activeAddonId={currentAddonId() ?? undefined}
        onAddonSelect={(addon) => navigateToAddon(addon.addonId)}
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
                      when={view() === 'settings'}
                      fallback={<MessageSquare class="w-3.5 h-3.5" />}
                    >
                      <Settings class="w-3.5 h-3.5" />
                    </Show>
                    {view() === 'settings' ? 'Settings' : 'Chat'}
                  </span>
                </div>
              </div>
            </div>

            <div class="hidden sm:flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-text-tertiary shadow-sm">
              <span class="truncate max-w-[220px]">
                {view() === 'settings'
                  ? 'Manage configuration'
                  : selectedSessionId()
                    ? 'Active conversation'
                    : 'No session selected'}
              </span>
            </div>

            <ConnectionStatus />
            <PresenceIndicator class="hidden md:flex" />
            <button
              type="button"
              onClick={props.onLogout}
              title="Log out"
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <LogOut class="w-4 h-4" />
            </button>
          </div>
        </header>

        <Show when={view() === 'settings'}>
          <SettingsView />
        </Show>

        <Show when={view() === 'sessions'}>
          <SessionsPage
            sessions={sessionsQuery.data?.items || []}
            usageBySession={sessionUsageQuery.data ?? {}}
            selectedSessionId={selectedSessionId()}
            onSelectSession={(id) => {
              setSelectedSessionId(id);
              navigate('chat');
            }}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            isLoading={sessionsQuery.isLoading}
          />
        </Show>

        <Show when={view() === 'tasks'}>
          <TasksPage
            onOpenSession={(sessionId) => {
              setSelectedSessionId(sessionId);
              navigate('chat');
            }}
          />
        </Show>

        <Show when={view() === 'pulses'}>
          <PulsesPage />
        </Show>

        <Show when={view() === 'channels'}>
          <ChannelsPage />
        </Show>

        <Show when={view() === 'webhooks'}>
          <WebhooksPage />
        </Show>

        <Show when={view() === 'agents'}>
          <AgentsPage onStartChat={handleStartChatWithAgent} />
        </Show>

        <Show when={view() === 'skills'}>
          <SkillsPage />
        </Show>

        <Show when={view() === 'mcps'}>
          <McpsPage />
        </Show>

        <Show when={view() === 'logs'}>
          <LogsPage />
        </Show>

        <Show when={view() === 'usage'}>
          <UsagePage />
        </Show>

        <Show when={view() === 'backups'}>
          <BackupsPage />
        </Show>

        <Show when={view() === 'addons'}>
          <AddonsPage onAddonChange={() => void loadEnabledAddons()} />
        </Show>

        <Show when={view() === 'addon-view' && activeAddon() !== undefined}>
          <AddonViewPage addon={activeAddon()!} />
        </Show>
        <Show when={view() === 'addon-view' && activeAddon() === undefined}>
          <div class="flex-1 flex items-center justify-center text-text-tertiary text-sm">
            Addon not found or not enabled.
          </div>
        </Show>

        <Show when={view() === 'api-keys'}>
          <AccessTokensPage />
        </Show>

        <Show when={view() === 'chat'}>
          {/* First-run gate: on a fresh install with no provider configured,
              the chat landing view is replaced by the provider onboarding
              screen. The sidebar and logout stay reachable (not a modal). */}
          <Show when={needsProviderSetup()}>
            <ProviderOnboarding
              onConfigured={() => void configGateQuery.refetch()}
            />
          </Show>

          <Show when={!needsProviderSetup()}>
            <Show when={!selectedSessionId()}>
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
              <ChatView
                messages={messages()}
                isLoading={messagesQuery.isLoading}
                error={messagesQuery.error?.message}
                isStreaming={isStreaming()}
                streamingContent={
                  isStreaming() ? streamingContent() : undefined
                }
                streamingToolCalls={
                  isStreaming() ? streamingToolCalls() : undefined
                }
                onCancelTool={handleCancelTool}
                onCancelRun={handleCancelRun}
                runActivity={isStreaming() ? runActivity() : undefined}
                queuedMessages={messageQueue.items()}
                onEditQueued={messageQueue.edit}
                onRemoveQueued={messageQueue.remove}
                scrollToMessageId={scrollToMessageId()}
              />
              <Show when={currentChoices()}>
                {(c) => (
                  <ChoicesCard
                    question={c().question}
                    choices={c().choices}
                    onSelect={(choice) => {
                      setCurrentChoices(null);
                      handleSubmit(choice, selectedAgentId());
                    }}
                    onDismiss={() => {
                      setCurrentChoices(null);
                      // Resume draining the queue now that the prompt is gone.
                      processQueue();
                      setTimeout(() => focusChatInput()?.(), 50);
                    }}
                  />
                )}
              </Show>
              <Show when={isPausedMidTask()}>
                <PausedRunNotice
                  onContinue={() => handleSubmit('continue', selectedAgentId())}
                />
              </Show>
              <RunList
                runs={runs()}
                isLoading={runsQuery.isLoading}
                error={runsQuery.error?.message}
                sessionId={selectedSessionId()}
                model={effectiveModel()}
                onRunClick={(firstMessageId) => {
                  if (firstMessageId) {
                    setScrollToMessageId(firstMessageId);
                  }
                }}
              />
              <ChatComposer
                onSend={handleSubmit}
                isStreaming={isStreaming()}
                placeholder="Type your message..."
                agents={agents()}
                selectedAgentId={effectiveAgentId()}
                onAgentSelect={handleAgentSelect}
                onInputReady={(focus) => setFocusChatInput(() => focus)}
              />
              <Show when={submitError()}>
                <div class="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
                  {submitError()}
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </main>

      <ConfirmDialog
        isOpen={sessionToDelete() !== null}
        title="Delete session?"
        body={
          <p>
            This will permanently delete{' '}
            <strong>{sessionToDelete()?.title ?? 'this session'}</strong> and
            all of its messages. This action cannot be undone.
          </p>
        }
        tone="danger"
        confirmLabel="Delete"
        isPending={isDeletingSession()}
        onConfirm={handleConfirmDelete}
        onCancel={() => setSessionToDelete(null)}
      />

      {/* Command palette (⌘K / Ctrl+K). Mounted at the top of the tree so
          the modal overlay covers everything and its keyboard handlers
          stay focused regardless of which sub-view is active. */}
      <CommandPalette
        ctx={commandCtx}
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  );
}

function AuthGate() {
  // Only an already-persisted (localStorage) token auto-bypasses the login
  // screen. A ?token=... deep link from the installer is left for the
  // LoginScreen to consume so the user always gets a single explicit
  // "Connect" click instead of silently being logged in.
  const [authenticated, setAuthenticated] = createSignal(
    Boolean(getStoredToken()),
  );

  return (
    <Show
      when={authenticated()}
      fallback={<LoginScreen onAuthenticated={() => setAuthenticated(true)} />}
    >
      <WebSocketProvider>
        <QueryClientProvider client={queryClient}>
          <AppContent
            onLogout={() => {
              clearToken();
              setAuthenticated(false);
            }}
          />
        </QueryClientProvider>
      </WebSocketProvider>
    </Show>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthGate />
    </ThemeProvider>
  );
}

export default App;
