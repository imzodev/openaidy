import { Layout } from './Layout';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { useQueryClient } from '@tanstack/solid-query';
import {
  Bot,
  Folder,
  FileText,
  Wrench,
  Power,
  PowerOff,
  Lightbulb,
  Plus,
  MessageSquare,
  Server,
  UserCircle,
  Save,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Trash2,
} from 'lucide-solid';
import {
  listAgents,
  listBuiltinTools,
  updateAgentTools,
  listAgentSkills,
  updateAgentSkills,
  listMcpServers,
  updateAgentMcpServers,
  getConfig,
  getPersonalityFile,
  updatePersonalityFile,
  deleteAgent,
  type Agent,
  type BuiltinToolInfo,
  type SkillInfo,
  type ProviderConfig,
  type CreateAgentInput,
  type McpServerRef,
  type McpServerRecord,
  type PersonalityFileId,
  type PersonalityFile,
} from '../../lib/api';
import { CreateAgentModal } from './CreateAgentModal';
import {
  FileExplorer,
  WorkspaceEditor,
  type WorkspaceFileInfo,
} from '../workspace';
import { ToolToggleGrid, type ToggleItem } from '../common/ToolToggleGrid';

type AgentsPageProps = {
  onStartChat?: (agentId: string) => void;
};

/** Workspace permission keys rendered as compact single-letter chips. */
const WORKSPACE_PERMISSION_KEYS = ['read', 'write', 'delete', 'list'] as const;
const WORKSPACE_PERMISSION_LABELS: Record<
  (typeof WORKSPACE_PERMISSION_KEYS)[number],
  string
> = {
  read: 'Read',
  write: 'Write',
  delete: 'Delete',
  list: 'List',
};

export function AgentsPage(props: AgentsPageProps) {
  // Shared with App.tsx's `agentsQuery` (queryKey: ['agents']) — that's what
  // ChatComposer/AgentPicker actually render their agent list from. Without
  // invalidating it here, a freshly created agent exists in this page's own
  // local `agents` signal but not in App.tsx's, so "Start Chat" navigates to
  // a chat that can't find/select the new agent (AgentPicker falls back to
  // "Default agent" since it's not in `props.agents`).
  const queryClient = useQueryClient();
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = createSignal<
    'overview' | 'workspace' | 'tools' | 'skills' | 'mcp' | 'personality'
  >('overview');
  const [error, setError] = createSignal<string | null>(null);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] =
    createSignal<WorkspaceFileInfo | null>(null);
  const [hasUnsavedWorkspaceChanges, setHasUnsavedWorkspaceChanges] =
    createSignal(false);
  const [allBuiltinTools, setAllBuiltinTools] = createSignal<BuiltinToolInfo[]>(
    [],
  );
  const [toolsUpdating, setToolsUpdating] = createSignal<Set<string>>(
    new Set(),
  );
  const [allSkills, setAllSkills] = createSignal<SkillInfo[]>([]);
  const [skillsUpdating, setSkillsUpdating] = createSignal<Set<string>>(
    new Set(),
  );
  const [allMcpServers, setAllMcpServers] = createSignal<McpServerRecord[]>([]);
  const [mcpUpdating, setMcpUpdating] = createSignal<Set<string>>(new Set());
  const [providers, setProviders] = createSignal<ProviderConfig[]>([]);
  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [mobileShowDetail, setMobileShowDetail] = createSignal(false);

  const selectedAgent = () => agents().find((a) => a.id === selectedAgentId());

  const workspaceCanWrite = () => {
    const workspace = selectedAgent()?.workspace;
    if (!workspace?.enabled) {
      return false;
    }

    const hasWorkspaceWritePermission = workspace.workspaces.some(
      (item) => item.permissions.write,
    );

    return (
      hasWorkspaceWritePermission ||
      workspace.defaultPermissions?.write === true
    );
  };

  const confirmDiscardWorkspaceChanges = () => {
    if (!hasUnsavedWorkspaceChanges()) {
      return true;
    }

    return window.confirm(
      'You have unsaved workspace changes. Discard them and continue?',
    );
  };

  const handleAgentSelection = (agentId: string) => {
    if (selectedAgentId() === agentId) {
      setMobileShowDetail(true);
      return;
    }

    if (!confirmDiscardWorkspaceChanges()) {
      return;
    }

    setSelectedAgentId(agentId);
    setSelectedWorkspaceFile(null);
    setHasUnsavedWorkspaceChanges(false);
    setMobileShowDetail(true);
  };

  // Personality tab state
  const PERSONALITY_FILE_IDS: PersonalityFileId[] = [
    'AGENT',
    'USER',
    'MISSION',
    'RULES',
  ];
  const PERSONALITY_LABELS: Record<
    PersonalityFileId,
    { label: string; emoji: string; description: string }
  > = {
    AGENT: {
      label: 'Agent Identity',
      emoji: '🤖',
      description: 'Who the agent is — its name, emoji, personality, and tone.',
    },
    USER: {
      label: 'User Profile',
      emoji: '👤',
      description:
        'Who the user is — name, language, expertise, and communication style.',
    },
    MISSION: {
      label: 'Mission',
      emoji: '🚀',
      description:
        "Why we're here — the project, goals, stack, and current focus.",
    },
    RULES: {
      label: 'Rules',
      emoji: '📋',
      description: 'Hard constraints — always enforced, no exceptions.',
    },
  };

  const [personalityFiles, setPersonalityFiles] = createSignal<
    Record<PersonalityFileId, PersonalityFile>
  >({} as Record<PersonalityFileId, PersonalityFile>);
  const [personalityDraft, setPersonalityDraft] = createSignal<
    Record<PersonalityFileId, string>
  >({} as Record<PersonalityFileId, string>);
  const [personalityLoading, setPersonalityLoading] = createSignal(false);
  const [personalitySaving, setPersonalitySaving] =
    createSignal<PersonalityFileId | null>(null);
  const [personalityError, setPersonalityError] = createSignal<string | null>(
    null,
  );
  const [expandedPersonalityFile, setExpandedPersonalityFile] =
    createSignal<PersonalityFileId | null>('AGENT');

  const loadPersonalityFiles = async (agentId: string) => {
    setPersonalityLoading(true);
    setPersonalityError(null);
    try {
      const results = await Promise.all(
        PERSONALITY_FILE_IDS.map((id) => getPersonalityFile(agentId, id)),
      );
      const filesMap = {} as Record<PersonalityFileId, PersonalityFile>;
      const draftMap = {} as Record<PersonalityFileId, string>;
      results.forEach((f) => {
        filesMap[f.id] = f;
        draftMap[f.id] = f.content;
      });
      setPersonalityFiles(filesMap);
      setPersonalityDraft(draftMap);
    } catch (err) {
      setPersonalityError(
        err instanceof Error ? err.message : 'Failed to load personality files',
      );
    } finally {
      setPersonalityLoading(false);
    }
  };

  const handlePersonalitySave = async (fileId: PersonalityFileId) => {
    const agentId = selectedAgentId();
    if (!agentId) return;
    setPersonalitySaving(fileId);
    try {
      await updatePersonalityFile(
        agentId,
        fileId,
        personalityDraft()[fileId] ?? '',
      );
      setPersonalityFiles((prev) => ({
        ...prev,
        [fileId]: {
          ...prev[fileId],
          content: personalityDraft()[fileId] ?? '',
          exists: true,
        },
      }));
    } catch (err) {
      setPersonalityError(
        err instanceof Error ? err.message : 'Failed to save',
      );
    } finally {
      setPersonalitySaving(null);
    }
  };

  const handleTabChange = (
    tab: 'overview' | 'workspace' | 'tools' | 'skills' | 'mcp' | 'personality',
  ) => {
    if (activeTab() === tab) {
      return;
    }

    if (activeTab() === 'workspace' && !confirmDiscardWorkspaceChanges()) {
      return;
    }

    setActiveTab(tab);
  };

  const handleWorkspaceFileSelect = (file: WorkspaceFileInfo) => {
    if (selectedWorkspaceFile()?.path === file.path) {
      return;
    }

    if (!confirmDiscardWorkspaceChanges()) {
      return;
    }

    setSelectedWorkspaceFile(file);
    setHasUnsavedWorkspaceChanges(false);
  };

  const handleWorkspaceFileDelete = (deletedPath: string) => {
    if (selectedWorkspaceFile()?.path !== deletedPath) {
      return;
    }
    setSelectedWorkspaceFile(null);
    setHasUnsavedWorkspaceChanges(false);
  };

  const handleWorkspaceFileRename = (fromPath: string, toPath: string) => {
    const currentFile = selectedWorkspaceFile();
    if (!currentFile || currentFile.path !== fromPath) {
      return;
    }

    const pathParts = toPath.split('/');
    const nextName = pathParts[pathParts.length - 1] || currentFile.name;
    setSelectedWorkspaceFile({
      ...currentFile,
      name: nextName,
      path: toPath,
    });
  };

  createEffect(() => {
    if (!hasUnsavedWorkspaceChanges()) {
      return;
    }

    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', beforeUnloadHandler);
    onCleanup(() => {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
    });
  });

  onMount(async () => {
    try {
      const [agentsResponse, toolsResponse, configResponse] = await Promise.all(
        [
          listAgents(),
          listBuiltinTools().catch(() => ({ items: [] as BuiltinToolInfo[] })),
          getConfig().catch(() => null),
        ],
      );
      setAgents(agentsResponse.items);
      setAllBuiltinTools(toolsResponse.items);
      if (agentsResponse.items.length > 0) {
        setSelectedAgentId(agentsResponse.items[0].id);
      }
      if (configResponse && 'config' in configResponse) {
        setProviders(configResponse.config.providers ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setIsLoading(false);
    }
  });

  const handleAgentCreated = async (input: CreateAgentInput) => {
    setShowCreateModal(false);
    try {
      const response = await listAgents();
      setAgents(response.items);
      setSelectedAgentId(input.id);
      // Update the shared ['agents'] cache synchronously -- invalidateQueries
      // would only refetch in the background, opening a race window where
      // "Start Chat" can navigate before the refetch completes.
      queryClient.setQueryData(['agents'], response);
    } catch {
      // ignore refresh error
    }
  };

  const handleDeleteAgent = async () => {
    const agent = selectedAgent();
    if (!agent) return;
    const confirmed = window.confirm(
      `Delete agent "${agent.name}"?\n\nThis will permanently remove the agent and its entire workspace directory. This cannot be undone.`,
    );
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      await deleteAgent(agent.id);
      const remaining = agents().filter((a) => a.id !== agent.id);
      setAgents(remaining);
      setSelectedAgentId(remaining.length > 0 ? remaining[0].id : null);
      setSelectedWorkspaceFile(null);
      setHasUnsavedWorkspaceChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete agent');
    } finally {
      setIsDeleting(false);
    }
  };

  createEffect(() => {
    const agentId = selectedAgentId();
    if (!agentId) return;
    listAgentSkills(agentId)
      .then((res) => setAllSkills(res.items))
      .catch(() => setAllSkills([]));
  });

  createEffect(() => {
    const agentId = selectedAgentId();
    if (!agentId || activeTab() !== 'personality') return;
    void loadPersonalityFiles(agentId);
  });

  onMount(() => {
    listMcpServers()
      .then((res) => setAllMcpServers(res.servers))
      .catch(() => setAllMcpServers([]));
  });

  const handleToggleTool = async (toolName: string) => {
    const agent = selectedAgent();
    if (!agent) return;

    setToolsUpdating((prev) => new Set([...prev, toolName]));
    try {
      const currentTools = agent.tools ?? [];
      const nextTools = currentTools.includes(toolName)
        ? currentTools.filter((t) => t !== toolName)
        : [...currentTools, toolName];

      await updateAgentTools(agent.id, nextTools);

      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, tools: nextTools } : a)),
      );
    } catch {
      // leave state unchanged on error
    } finally {
      setToolsUpdating((prev) => {
        const next = new Set(prev);
        next.delete(toolName);
        return next;
      });
    }
  };

  const handleToggleMcpServer = async (serverId: string) => {
    const agent = selectedAgent();
    if (!agent) return;

    setMcpUpdating((prev) => new Set([...prev, serverId]));
    try {
      const currentRefs = agent.mcpServers ?? [];
      const isEnabled = currentRefs.some((r) => r.id === serverId);
      const nextRefs: McpServerRef[] = isEnabled
        ? currentRefs.filter((r) => r.id !== serverId)
        : [...currentRefs, { id: serverId }];

      await updateAgentMcpServers(agent.id, nextRefs);

      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id ? { ...a, mcpServers: nextRefs } : a,
        ),
      );
    } catch {
      // leave state unchanged on error
    } finally {
      setMcpUpdating((prev) => {
        const next = new Set(prev);
        next.delete(serverId);
        return next;
      });
    }
  };

  const handleToggleSkill = async (skillId: string) => {
    const agent = selectedAgent();
    if (!agent) return;

    setSkillsUpdating((prev) => new Set([...prev, skillId]));
    try {
      const currentSkills = agent.skills ?? [];
      const nextSkills = currentSkills.includes(skillId)
        ? currentSkills.filter((s) => s !== skillId)
        : [...currentSkills, skillId];

      await updateAgentSkills(agent.id, nextSkills);

      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, skills: nextSkills } : a)),
      );
    } catch {
      // leave state unchanged on error
    } finally {
      setSkillsUpdating((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  };

  const getModelDisplay = (model: string) => {
    const parts = model.split('/');
    return parts.length === 2 ? `${parts[1]} (${parts[0]})` : model;
  };

  return (
    <Layout title="Agents" description="Manage AI agent configurations">
      {/* Error Display */}
      <Show when={error()}>
        <div class="mb-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg">
          {error()}
        </div>
      </Show>

      {/* Loading State */}
      <Show when={isLoading()}>
        <div class="flex items-center justify-center h-64">
          <p class="text-text-tertiary">Loading agents...</p>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!isLoading() && agents().length === 0}>
        <div class="flex items-center justify-center h-64">
          <div class="text-center">
            <Bot class="w-12 h-12 mx-auto mb-4 text-text-tertiary" />
            <p class="text-text-tertiary mb-2">No agents configured</p>
            <button
              onClick={() => setShowCreateModal(true)}
              class="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus class="w-4 h-4" />
              Create your first agent
            </button>
          </div>
        </div>
      </Show>

      {/* Main Content - Split View */}
      <Show when={!isLoading() && agents().length > 0}>
        <div class="flex flex-col lg:flex-row lg:h-[calc(100vh-200px)] gap-4">
          {/* Agent List - Left Panel (hidden on mobile when detail is open) */}
          <div
            class={`${mobileShowDetail() ? 'hidden lg:flex' : 'flex'} lg:w-72 xl:w-80 w-full flex-shrink-0 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden flex-col`}
          >
            <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Agents
              </h2>
              <button
                onClick={() => setShowCreateModal(true)}
                class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
                title="New agent"
              >
                <Plus class="w-3.5 h-3.5" />
                New
              </button>
            </div>

            <div class="flex-1 overflow-y-auto">
              <For each={agents()}>
                {(agent) => (
                  <button
                    class={`w-full text-left p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                      selectedAgentId() === agent.id
                        ? 'bg-primary/10 border-l-4 border-l-primary'
                        : 'border-l-4 border-l-transparent'
                    }`}
                    onClick={() => handleAgentSelection(agent.id)}
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class={`p-2 rounded-lg flex-shrink-0 ${agent.enabled ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}
                      >
                        <Bot
                          class={`w-4 h-4 ${agent.enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}
                        />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="font-medium text-gray-900 dark:text-gray-100 truncate">
                          {agent.name}
                        </div>
                        <div class="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {getModelDisplay(agent.model)}
                        </div>
                      </div>
                      <ChevronLeft class="w-4 h-4 text-gray-400 rotate-180 flex-shrink-0 lg:hidden" />
                    </div>

                    {/* Workspace indicator */}
                    <Show when={agent.workspace?.enabled}>
                      <div class="mt-2 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                        <Folder class="w-3 h-3" />
                        <span>Workspace enabled</span>
                      </div>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Agent Detail - Right Panel (full width on mobile) */}
          <div
            class={`${!mobileShowDetail() ? 'hidden lg:flex' : 'flex'} flex-1 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden flex-col min-w-0`}
          >
            <Show when={selectedAgent()}>
              {/* Header */}
              <div class="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
                {/* Mobile back button */}
                <button
                  class="lg:hidden flex items-center gap-1.5 text-sm text-primary mb-3 hover:text-primary/80 transition-colors"
                  onClick={() => setMobileShowDetail(false)}
                >
                  <ChevronLeft class="w-4 h-4" />
                  All Agents
                </button>

                <div class="flex flex-col sm:flex-row sm:items-start gap-3 sm:justify-between">
                  <div class="min-w-0">
                    <h2 class="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                      {selectedAgent()!.name}
                    </h2>
                    <Show when={selectedAgent()!.description}>
                      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                        {selectedAgent()!.description}
                      </p>
                    </Show>
                  </div>

                  <div class="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {/* Status Badge */}
                    <div
                      class={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                        selectedAgent()!.enabled
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <Show
                        when={selectedAgent()!.enabled}
                        fallback={
                          <>
                            <PowerOff class="w-3.5 h-3.5" />
                            <span>Disabled</span>
                          </>
                        }
                      >
                        <Power class="w-3.5 h-3.5" />
                        <span>Active</span>
                      </Show>
                    </div>

                    {/* Start Chat button */}
                    <Show when={props.onStartChat && selectedAgent()!.enabled}>
                      <button
                        onClick={() => props.onStartChat!(selectedAgent()!.id)}
                        class="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
                      >
                        <MessageSquare class="w-3.5 h-3.5" />
                        <span class="hidden xs:inline">Start Chat</span>
                        <span class="xs:hidden">Chat</span>
                      </button>
                    </Show>

                    {/* Delete Agent button */}
                    <button
                      onClick={handleDeleteAgent}
                      disabled={isDeleting()}
                      class="flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Delete agent"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                      {isDeleting() ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>

                {/* Model info */}
                <div class="mt-3 flex items-center gap-2 text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                  <span class="font-medium">Model:</span>
                  <code class="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs truncate max-w-[200px] sm:max-w-none">
                    {selectedAgent()!.model}
                  </code>
                </div>
              </div>

              {/* Tabs — horizontally scrollable on small screens */}
              <div class="border-b border-gray-200 dark:border-gray-700">
                <nav
                  class="flex gap-0.5 px-2 sm:px-4 overflow-x-auto scrollbar-none"
                  aria-label="Tabs"
                >
                  <button
                    class={`flex-shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                      activeTab() === 'overview'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    onClick={() => handleTabChange('overview')}
                  >
                    <FileText class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Overview
                  </button>

                  <Show when={selectedAgent()!.workspace?.enabled}>
                    <button
                      class={`flex-shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                        activeTab() === 'workspace'
                          ? 'border-primary text-primary'
                          : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                      onClick={() => handleTabChange('workspace')}
                    >
                      <Folder class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      Workspace
                    </button>
                  </Show>

                  <button
                    class={`flex-shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                      activeTab() === 'tools'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    onClick={() => handleTabChange('tools')}
                  >
                    <Wrench class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Tools
                  </button>

                  <button
                    class={`flex-shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                      activeTab() === 'skills'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    onClick={() => handleTabChange('skills')}
                  >
                    <Lightbulb class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Skills
                  </button>

                  <button
                    class={`flex-shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                      activeTab() === 'mcp'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    onClick={() => handleTabChange('mcp')}
                  >
                    <Server class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    MCP
                  </button>

                  <button
                    class={`flex-shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                      activeTab() === 'personality'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                    onClick={() => handleTabChange('personality')}
                  >
                    <UserCircle class="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Personality
                  </button>
                </nav>
              </div>

              {/* Tab Content */}
              <div class="flex-1 overflow-y-auto p-6">
                {/* Overview Tab */}
                <Show when={activeTab() === 'overview'}>
                  <div class="space-y-6">
                    {/* System Prompt */}
                    <div>
                      <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                        System Prompt
                      </h3>
                      <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                        <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {selectedAgent()!.systemPrompt}
                        </p>
                      </div>
                    </div>

                    {/* Defaults */}
                    <Show when={selectedAgent()!.defaults}>
                      <div>
                        <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                          Default Settings
                        </h3>
                        <div class="grid grid-cols-2 gap-4">
                          <Show when={selectedAgent()!.defaults!.providerId}>
                            <div>
                              <span class="text-xs text-gray-500 dark:text-gray-400">
                                Provider
                              </span>
                              <p class="text-sm text-gray-900 dark:text-gray-100">
                                {selectedAgent()!.defaults!.providerId}
                              </p>
                            </div>
                          </Show>
                          <Show when={selectedAgent()!.defaults!.modelId}>
                            <div>
                              <span class="text-xs text-gray-500 dark:text-gray-400">
                                Model
                              </span>
                              <p class="text-sm text-gray-900 dark:text-gray-100">
                                {selectedAgent()!.defaults!.modelId}
                              </p>
                            </div>
                          </Show>
                          <Show
                            when={
                              selectedAgent()!.defaults!.temperature !==
                              undefined
                            }
                          >
                            <div>
                              <span class="text-xs text-gray-500 dark:text-gray-400">
                                Temperature
                              </span>
                              <p class="text-sm text-gray-900 dark:text-gray-100">
                                {selectedAgent()!.defaults!.temperature}
                              </p>
                            </div>
                          </Show>
                          <Show
                            when={
                              selectedAgent()!.defaults!.maxTokens !== undefined
                            }
                          >
                            <div>
                              <span class="text-xs text-gray-500 dark:text-gray-400">
                                Max Tokens
                              </span>
                              <p class="text-sm text-gray-900 dark:text-gray-100">
                                {selectedAgent()!.defaults!.maxTokens}
                              </p>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </Show>

                    {/* Tags */}
                    <Show
                      when={
                        selectedAgent()!.tags &&
                        selectedAgent()!.tags!.length > 0
                      }
                    >
                      <div>
                        <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                          Tags
                        </h3>
                        <div class="flex flex-wrap gap-2">
                          <For each={selectedAgent()!.tags}>
                            {(tag) => (
                              <span class="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-sm text-gray-600 dark:text-gray-300 rounded">
                                {tag}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>

                {/* Workspace Tab */}
                <Show
                  when={
                    activeTab() === 'workspace' &&
                    selectedAgent()!.workspace?.enabled
                  }
                >
                  <Show
                    when={selectedAgent()!.workspace!.workspaces.length > 0}
                    fallback={
                      <p class="text-sm text-text-tertiary">
                        No workspaces configured for this agent.
                      </p>
                    }
                  >
                    <div class="space-y-4">
                      {/* Primary: Files & preview — the main focus of this tab */}
                      <div class="grid grid-cols-1 lg:grid-cols-5 gap-4">
                        <div class="lg:col-span-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <FileExplorer
                            agentId={selectedAgent()!.id}
                            canWrite={workspaceCanWrite()}
                            selectedFilePath={
                              selectedWorkspaceFile()?.path ?? null
                            }
                            onFileSelect={handleWorkspaceFileSelect}
                            onFileDelete={handleWorkspaceFileDelete}
                            onFileRename={handleWorkspaceFileRename}
                            class="h-56 sm:h-72 lg:h-[34rem]"
                          />
                        </div>
                        <div class="lg:col-span-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <WorkspaceEditor
                            agentId={selectedAgent()!.id}
                            selectedFile={selectedWorkspaceFile()}
                            canWrite={workspaceCanWrite()}
                            onDirtyChange={setHasUnsavedWorkspaceChanges}
                            class="h-72 sm:h-80 lg:h-[34rem]"
                          />
                        </div>
                      </div>

                      {/* Secondary: available workspaces — compact panel */}
                      <div class="border border-gray-200 dark:border-gray-700 rounded-lg">
                        <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">
                            Available workspaces
                          </h3>
                          <span class="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-text-secondary">
                            {selectedAgent()!.workspace!.workspaces.length}
                          </span>
                        </div>
                        <div class="space-y-1 p-2">
                          <For each={selectedAgent()!.workspace!.workspaces}>
                            {(workspace) => (
                              <div class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <div class="flex items-center gap-2 min-w-0">
                                  <Folder class="w-4 h-4 text-blue-500 shrink-0" />
                                  <span class="font-mono text-xs sm:text-sm text-gray-900 dark:text-gray-100 truncate">
                                    {workspace.path}
                                  </span>
                                </div>
                                <div class="flex items-center gap-1 shrink-0">
                                  <For each={WORKSPACE_PERMISSION_KEYS}>
                                    {(key) => {
                                      const active = () =>
                                        !!workspace.permissions?.[key];
                                      return (
                                        <span
                                          title={`${WORKSPACE_PERMISSION_LABELS[key]}${
                                            active() ? '' : ' (off)'
                                          }`}
                                          class={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold ${
                                            active()
                                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                              : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                                          }`}
                                        >
                                          {WORKSPACE_PERMISSION_LABELS[
                                            key
                                          ].charAt(0)}
                                        </span>
                                      );
                                    }}
                                  </For>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </div>
                  </Show>
                </Show>

                {/* Tools Tab */}
                <Show when={activeTab() === 'tools'}>
                  <ToolToggleGrid
                    items={createMemo(() =>
                      allBuiltinTools().map(
                        (t): ToggleItem => ({
                          id: t.name,
                          label: t.name,
                          description: t.description,
                          category: t.category,
                        }),
                      ),
                    )()}
                    enabledIds={createMemo(
                      () => new Set(selectedAgent()?.tools ?? []),
                    )()}
                    updatingIds={toolsUpdating()}
                    onToggle={handleToggleTool}
                    icon={(enabled) => (
                      <Wrench
                        class={`w-3.5 h-3.5 ${enabled ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
                      />
                    )}
                    categoryOrder={[
                      'Agents',
                      'Sessions',
                      'Memory',
                      'Tasks',
                      'Workspace',
                      'Media',
                      'Code',
                      'Execution',
                      'Skills',
                      'Pulses',
                      'Web',
                      'Addons',
                      'UI',
                    ]}
                    emptyMessage="No builtin tools available"
                  />
                </Show>

                {/* Skills Tab */}
                <Show when={activeTab() === 'skills'}>
                  <ToolToggleGrid
                    items={createMemo(() =>
                      allSkills().map(
                        (s): ToggleItem => ({
                          id: s.id,
                          label: s.name,
                          description: s.description,
                          category: s.source ?? 'General',
                        }),
                      ),
                    )()}
                    enabledIds={createMemo(
                      () => new Set(selectedAgent()?.skills ?? []),
                    )()}
                    updatingIds={skillsUpdating()}
                    onToggle={handleToggleSkill}
                    icon={(enabled) => (
                      <Lightbulb
                        class={`w-3.5 h-3.5 ${enabled ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
                      />
                    )}
                    emptyMessage="No skills available"
                  />
                </Show>
                {/* Personality Tab */}
                <Show when={activeTab() === 'personality'}>
                  <div class="space-y-4">
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      Define who this agent is, who it's talking to, its
                      mission, and its rules. These are injected into the system
                      prompt on every conversation.
                    </p>

                    <Show when={personalityError()}>
                      <p class="text-sm text-red-500">{personalityError()}</p>
                    </Show>

                    <Show when={personalityLoading()}>
                      <div class="flex items-center justify-center h-32">
                        <p class="text-text-tertiary text-sm">Loading…</p>
                      </div>
                    </Show>

                    <Show when={!personalityLoading()}>
                      <For each={PERSONALITY_FILE_IDS}>
                        {(fileId) => {
                          const meta = PERSONALITY_LABELS[fileId];
                          const isExpanded = () =>
                            expandedPersonalityFile() === fileId;
                          const isSaving = () => personalitySaving() === fileId;
                          const isDirty = () =>
                            personalityDraft()[fileId] !==
                            personalityFiles()[fileId]?.content;
                          return (
                            <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                              <button
                                class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                onClick={() =>
                                  setExpandedPersonalityFile(
                                    isExpanded() ? null : fileId,
                                  )
                                }
                              >
                                <span class="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                                  <span class="text-base">{meta.emoji}</span>
                                  {meta.label}
                                  <Show when={isDirty()}>
                                    <span class="text-xs px-1.5 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                                      unsaved
                                    </span>
                                  </Show>
                                </span>
                                <Show
                                  when={isExpanded()}
                                  fallback={
                                    <ChevronDown class="w-4 h-4 text-gray-400" />
                                  }
                                >
                                  <ChevronUp class="w-4 h-4 text-gray-400" />
                                </Show>
                              </button>

                              <Show when={isExpanded()}>
                                <div class="p-4 space-y-3">
                                  <p class="text-xs text-gray-500 dark:text-gray-400">
                                    {meta.description}
                                  </p>
                                  <textarea
                                    class="w-full h-56 text-sm font-mono p-3 border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={personalityDraft()[fileId] ?? ''}
                                    onInput={(e) =>
                                      setPersonalityDraft((prev) => ({
                                        ...prev,
                                        [fileId]: e.currentTarget.value,
                                      }))
                                    }
                                    disabled={isSaving()}
                                  />
                                  <div class="flex justify-end">
                                    <button
                                      class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                      onClick={() =>
                                        void handlePersonalitySave(fileId)
                                      }
                                      disabled={isSaving() || !isDirty()}
                                    >
                                      <Save class="w-3.5 h-3.5" />
                                      {isSaving() ? 'Saving…' : 'Save'}
                                    </button>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </Show>
                  </div>
                </Show>

                {/* MCP Servers Tab */}
                <Show when={activeTab() === 'mcp'}>
                  <div class="space-y-3">
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      Enable MCP servers to give this agent access to their
                      tools. Servers must be configured and connected globally
                      first.
                    </p>
                    <ToolToggleGrid
                      items={createMemo(() =>
                        allMcpServers().map(
                          (s): ToggleItem => ({
                            id: s.id,
                            label: s.name ?? s.id,
                            description: `${s.toolCount} tool${s.toolCount === 1 ? '' : 's'} · ${s.transport}`,
                            category: s.transport ?? 'MCP',
                            badge: s.connected ? 'connected' : 'disconnected',
                            badgeVariant: s.connected ? 'success' : 'neutral',
                            disabled: !s.connected,
                            disabledReason: 'Server is not connected',
                          }),
                        ),
                      )()}
                      enabledIds={createMemo(
                        () =>
                          new Set(
                            selectedAgent()?.mcpServers?.map((r) => r.id) ?? [],
                          ),
                      )()}
                      updatingIds={mcpUpdating()}
                      onToggle={handleToggleMcpServer}
                      icon={(enabled) => (
                        <Server
                          class={`w-3.5 h-3.5 ${enabled ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
                        />
                      )}
                      emptyMessage="No MCP servers configured"
                    />
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={!selectedAgent()}>
              <div class="flex-1 flex flex-col items-center justify-center gap-3 p-8">
                <Bot class="w-10 h-10 text-text-tertiary" />
                <p class="text-text-tertiary text-sm">
                  Select an agent to view details
                </p>
              </div>
            </Show>
          </div>
        </div>
      </Show>
      <CreateAgentModal
        isOpen={showCreateModal()}
        providers={providers()}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleAgentCreated}
      />
    </Layout>
  );
}
