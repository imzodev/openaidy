/**
 * REST API client — fetch functions only.
 * All type definitions live in ./types.ts
 */

import { ApiRequestError } from '@openaidy/shared-types';
import { getStoredToken } from './auth-token';

export type {
  Session,
  MessageRole,
  SessionMessage,
  RunStatus,
  AgentWorkspacePermission,
  AgentWorkspace,
  AgentWorkspaceConfig,
  Agent,
  SessionRun,
  BuiltinToolInfo,
  SkillSource,
  SkillInfo,
  CreateAgentInput,
  SubmitMessageInput,
  SubmitMessageResult,
  ModelCapability,
  ModelConfig,
  AgentDefaults,
  AgentConfig,
  AppDefaults,
  OpenAICompatibleProviderConfig,
  AnthropicProviderConfig,
  GeminiProviderConfig,
  ProviderConfig,
  AppConfig,
  ConfigIssue,
  ConfigStatus,
  RewiredAgentNotice,
  WorkspaceFileInfo,
  WorkspaceFileListResponse,
  WorkspaceFileContentResponse,
  WorkspaceWriteResponse,
  WorkspaceErrorResponse,
  AddonRecord,
  Pulse,
  PulseRun,
  ScheduleInput,
  CreatePulseBody,
  UpdatePulseBody,
} from './types';

export type {
  LogFilter,
  LogQueryResult,
  LogStats,
  ApiError,
  AccessTokenRecord,
  CreateAccessTokenRequest,
  CreateAccessTokenResponse,
  AuthVerifyResponse,
  McpServerRef,
  PersonalityFileId,
  PersonalityFileMeta,
  PersonalityFile,
  McpServerRecord,
  McpToolWithSchema,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  ChannelStatusResponse,
} from './types';

export { ApiRequestError } from '@openaidy/shared-types';

import type {
  Session,
  SessionMessage,
  SessionRun,
  Agent,
  BuiltinToolInfo,
  SkillInfo,
  CreateAgentInput,
  SubmitMessageInput,
  SubmitMessageResult,
  AppConfig,
  ConfigStatus,
  WorkspaceFileListResponse,
  WorkspaceFileContentResponse,
  WorkspaceWriteResponse,
  WorkspaceErrorResponse,
  AddonRecord,
  Pulse,
  PulseRun,
  CreatePulseBody,
  UpdatePulseBody,
} from './types';

import type {
  LogFilter,
  LogQueryResult,
  LogStats,
  ApiError,
  AccessTokenRecord,
  CreateAccessTokenRequest,
  CreateAccessTokenResponse,
  AuthVerifyResponse,
  McpServerRef,
  PersonalityFileId,
  PersonalityFileMeta,
  PersonalityFile,
  McpServerRecord,
  McpToolWithSchema,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  ChannelStatusResponse,
} from './types';

/**
 * Get the API base URL
 *
 * Priority:
 * 1. VITE_SERVER_URL environment variable
 * 2. In development: http://localhost:3001 (server default port)
 * 3. In production: throw error if not configured
 */
function getApiBase(): string {
  const envUrl = import.meta.env.VITE_SERVER_URL;

  if (envUrl) {
    return envUrl;
  }

  // Check if we're in development mode
  if (import.meta.env.DEV) {
    return 'http://localhost:3001';
  }

  // Production without VITE_SERVER_URL - throw clear error
  throw new Error(
    'VITE_SERVER_URL environment variable is required in production. ' +
      'Set it in your .env file or build environment.',
  );
}

/**
 * API base URL (computed once at module load)
 */
export const API_BASE = typeof window !== 'undefined' ? getApiBase() : '';

// Export getApiBase for testing
export { getApiBase };

/**
 * Fetch wrapper that automatically injects the stored auth token
 */
function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const authHeader: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  return fetch(input, {
    ...init,
    headers: {
      ...authHeader,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * List sessions
 */
export async function listSessions(): Promise<{ items: Session[] }> {
  const response = await apiFetch(`${API_BASE}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Search sessions by title or message content.
 * Falls back to title-only search if no DB backend.
 */
export async function searchSessions(
  query: string,
  options?: { limit?: number; currentSessionId?: string },
): Promise<{ items: import('@openaidy/shared-types').SessionSearchResult[] }> {
  const params = new URLSearchParams({ q: query });
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.currentSessionId)
    params.set('currentSessionId', options.currentSessionId);

  const response = await apiFetch(`${API_BASE}/sessions/search?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to search sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new session
 */
export async function createSession(title: string): Promise<Session> {
  const response = await apiFetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get a session by ID
 */
export async function getSession(id: string): Promise<Session | ApiError> {
  const response = await apiFetch(`${API_BASE}/sessions/${id}`);
  return response.json();
}

/**
 * List messages for a session
 */
export async function listMessages(
  sessionId: string,
): Promise<{ items: SessionMessage[] } | ApiError> {
  const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/messages`);
  return response.json();
}

/**
 * List runs for a session
 */
export async function listRuns(
  sessionId: string,
): Promise<{ items: SessionRun[] } | ApiError> {
  const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/runs`);
  return response.json();
}

/**
 * List all available builtin tools registered on the server
 */
export async function listBuiltinTools(): Promise<{
  items: BuiltinToolInfo[];
}> {
  const response = await apiFetch(`${API_BASE}/tools`);
  if (!response.ok) {
    throw new Error(`Failed to list builtin tools: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Update the builtin tools list for an agent
 */
export async function updateAgentTools(
  agentId: string,
  tools: string[],
): Promise<Agent> {
  const response = await apiFetch(`${API_BASE}/agents/${agentId}/tools`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tools }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update agent tools: ${response.statusText}`);
  }
  return response.json();
}

/**
 * List MCP server references configured for an agent
 */
export async function listAgentMcpServers(
  agentId: string,
): Promise<{ mcpServers: McpServerRef[] }> {
  const response = await apiFetch(`${API_BASE}/agents/${agentId}`);
  if (!response.ok) {
    throw new Error(`Failed to get agent: ${response.statusText}`);
  }
  const agent = (await response.json()) as { mcpServers?: McpServerRef[] };
  return { mcpServers: agent.mcpServers ?? [] };
}

/**
 * Update the MCP server references for an agent
 */
export async function updateAgentMcpServers(
  agentId: string,
  mcpServers: McpServerRef[],
): Promise<Agent> {
  const response = await apiFetch(`${API_BASE}/agents/${agentId}/mcp-servers`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcpServers }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to update agent MCP servers: ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * List all available skills registered on the server
 */
export async function listSkills(): Promise<{ items: SkillInfo[] }> {
  const response = await apiFetch(`${API_BASE}/skills`);
  if (!response.ok) {
    throw new Error(`Failed to list skills: ${response.statusText}`);
  }
  return response.json();
}

/**
 * List skills available to a specific agent (global skills + agent workspace skills)
 */
export async function listAgentSkills(
  agentId: string,
): Promise<{ items: SkillInfo[] }> {
  const response = await apiFetch(`${API_BASE}/agents/${agentId}/skills`);
  if (!response.ok) {
    throw new Error(`Failed to list agent skills: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Update the skills list for an agent
 */
export async function updateAgentSkills(
  agentId: string,
  skills: string[],
): Promise<Agent> {
  const response = await apiFetch(`${API_BASE}/agents/${agentId}/skills`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skills }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update agent skills: ${response.statusText}`);
  }
  return response.json();
}

/**
 * List all agents
 */
export async function listAgents(): Promise<{ items: Agent[] }> {
  const response = await apiFetch(`${API_BASE}/agents`);
  if (!response.ok) {
    throw new Error(`Failed to list agents: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get an agent by ID
 */
export async function getAgent(id: string): Promise<Agent | ApiError> {
  const response = await apiFetch(`${API_BASE}/agents/${id}`);
  return response.json();
}

/**
 * Create a new agent
 */
export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const response = await apiFetch(`${API_BASE}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
        `Failed to create agent: ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * Delete an agent by ID (also removes its workspace on the server)
 */
export async function deleteAgent(agentId: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/agents/${agentId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
        `Failed to delete agent: ${response.statusText}`,
    );
  }
}

/**
 * Get personality file metadata for an agent
 */
export async function listPersonalityFiles(
  agentId: string,
): Promise<{ files: PersonalityFileMeta[] }> {
  const response = await apiFetch(`${API_BASE}/agents/${agentId}/personality`);
  if (!response.ok) {
    throw new Error(`Failed to list personality files: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Read a single personality file for an agent
 */
export async function getPersonalityFile(
  agentId: string,
  fileId: PersonalityFileId,
): Promise<PersonalityFile> {
  const response = await apiFetch(
    `${API_BASE}/agents/${agentId}/personality/${fileId}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to get personality file: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Write (create or overwrite) a personality file for an agent
 */
export async function updatePersonalityFile(
  agentId: string,
  fileId: PersonalityFileId,
  content: string,
): Promise<{ ok: boolean }> {
  const response = await apiFetch(
    `${API_BASE}/agents/${agentId}/personality/${fileId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to update personality file: ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * Submit a message to a session
 */
export async function submitMessage(
  sessionId: string,
  input: SubmitMessageInput,
): Promise<SubmitMessageResult> {
  const response = await apiFetch(
    `${API_BASE}/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

/**
 * Get application configuration
 */
export async function getConfig(): Promise<
  { config: AppConfig; status: ConfigStatus } | ApiError
> {
  const response = await apiFetch(`${API_BASE}/config`);
  return response.json();
}

/**
 * Update application configuration
 */
export async function updateConfig(
  config: AppConfig,
): Promise<{ config: AppConfig; status: ConfigStatus } | ApiError> {
  const response = await apiFetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      error: 'request.failed',
    }))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

// ============================================================================
// Workspace API Functions
// ============================================================================

/**
 * List files in an agent's workspace
 */
export async function listWorkspaceFiles(
  agentId: string,
  requestingAgentId: string,
  path?: string,
): Promise<WorkspaceFileListResponse | WorkspaceErrorResponse> {
  const url = path
    ? `${API_BASE}/workspace/${agentId}/files/${path}`
    : `${API_BASE}/workspace/${agentId}/files`;
  const response = await apiFetch(url, {
    headers: { 'X-Agent-Id': requestingAgentId },
  });
  return response.json();
}

/**
 * Read a file from an agent's workspace
 */
export async function readWorkspaceFile(
  agentId: string,
  filePath: string,
  requestingAgentId: string,
): Promise<WorkspaceFileContentResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/workspace/${agentId}/files/${filePath}`,
    {
      headers: { 'X-Agent-Id': requestingAgentId },
    },
  );
  return response.json();
}

/**
 * Write a file to an agent's workspace
 */
export async function writeWorkspaceFile(
  agentId: string,
  filePath: string,
  content: string,
  requestingAgentId: string,
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/workspace/${agentId}/files/${filePath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': requestingAgentId,
      },
      body: JSON.stringify({ content }),
    },
  );
  return response.json();
}

/**
 * Rename a file in an agent's workspace
 */
export async function renameWorkspaceFile(
  agentId: string,
  sourcePath: string,
  destinationPath: string,
  requestingAgentId: string,
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(`${API_BASE}/workspace/${agentId}/rename`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': requestingAgentId,
    },
    body: JSON.stringify({ sourcePath, destinationPath }),
  });
  return response.json();
}

/**
 * Update an existing file in an agent's workspace
 */
export async function updateWorkspaceFile(
  agentId: string,
  filePath: string,
  content: string,
  requestingAgentId: string,
  expectedModifiedAt?: string,
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/workspace/${agentId}/files/${filePath}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Id': requestingAgentId,
      },
      body: JSON.stringify({ content, expectedModifiedAt }),
    },
  );
  return response.json();
}

/**
 * Delete a file from an agent's workspace
 */
export async function deleteWorkspaceFile(
  agentId: string,
  filePath: string,
  requestingAgentId: string,
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/workspace/${agentId}/files/${filePath}`,
    {
      method: 'DELETE',
      headers: { 'X-Agent-Id': requestingAgentId },
    },
  );
  return response.json();
}

/**
 * Query logs with filters
 */
export async function queryLogs(filter: LogFilter): Promise<LogQueryResult> {
  const params = new URLSearchParams();
  if (filter.levels?.length) params.set('levels', filter.levels.join(','));
  if (filter.contexts?.length)
    params.set('contexts', filter.contexts.join(','));
  if (filter.search) params.set('search', filter.search);
  if (filter.since) params.set('since', filter.since);
  if (filter.until) params.set('until', filter.until);
  if (filter.requestId) params.set('requestId', filter.requestId);
  if (filter.sessionId) params.set('sessionId', filter.sessionId);
  if (filter.runId) params.set('runId', filter.runId);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));

  const response = await apiFetch(`${API_BASE}/logs?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to query logs: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get log statistics
 */
export async function getLogStats(): Promise<LogStats> {
  const response = await apiFetch(`${API_BASE}/logs/stats`);
  if (!response.ok) {
    throw new Error(`Failed to get log stats: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Clear log buffer
 */
export async function clearLogs(): Promise<{
  success: boolean;
  cleared: boolean;
}> {
  const response = await apiFetch(`${API_BASE}/logs`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to clear logs: ${response.statusText}`);
  }
  return response.json();
}

/**
 * List all configured MCP servers and their live runtime status.
 */
export async function listMcpServers(): Promise<{
  servers: McpServerRecord[];
}> {
  const response = await apiFetch(`${API_BASE}/mcp/servers`);
  if (!response.ok) {
    throw new Error(`Failed to list MCP servers: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new MCP server config and connect to it.
 */
export async function createMcpServer(
  config: CreateMcpServerRequest,
): Promise<{ server: McpServerRecord }> {
  const response = await apiFetch(`${API_BASE}/mcp/servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

/**
 * Update an existing MCP server config (requires restart to take effect).
 */
export async function updateMcpServer(
  id: string,
  patch: UpdateMcpServerRequest,
): Promise<{ server: McpServerRecord }> {
  const response = await apiFetch(`${API_BASE}/mcp/servers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

/**
 * Delete an MCP server config and disconnect it if connected.
 */
export async function deleteMcpServer(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/mcp/servers/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 204) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
}

/**
 * Manually connect to an MCP server.
 */
export async function connectMcpServer(
  id: string,
): Promise<{ serverId: string; connected: boolean }> {
  const response = await apiFetch(`${API_BASE}/mcp/servers/${id}/connect`, {
    method: 'POST',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

/**
 * Manually disconnect from an MCP server.
 */
export async function disconnectMcpServer(
  id: string,
): Promise<{ serverId: string; disconnected: boolean }> {
  const response = await apiFetch(`${API_BASE}/mcp/servers/${id}/disconnect`, {
    method: 'POST',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

/**
 * Get the full tool schema for an MCP server (useful for tooling UIs).
 */
export async function getMcpServerTools(
  id: string,
): Promise<{ tools: McpToolWithSchema[] }> {
  const response = await apiFetch(`${API_BASE}/mcp/servers/${id}/tools`);
  if (!response.ok) {
    throw new Error(`Failed to get MCP server tools: ${response.statusText}`);
  }
  return response.json();
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * List all access tokens (requires admin token)
 */
export async function listAccessTokens(
  token: string,
): Promise<{ keys: AccessTokenRecord[] }> {
  const response = await fetch(`${API_BASE}/api/access-tokens`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json() as Promise<{ keys: AccessTokenRecord[] }>;
}

/**
 * Create a new access token (requires admin token)
 */
export async function createAccessToken(
  token: string,
  input: CreateAccessTokenRequest,
): Promise<CreateAccessTokenResponse> {
  const response = await fetch(`${API_BASE}/api/access-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json() as Promise<CreateAccessTokenResponse>;
}

/**
 * Revoke an access token by ID (requires admin token)
 */
export async function revokeAccessToken(
  token: string,
  id: string,
): Promise<AccessTokenRecord> {
  const response = await fetch(`${API_BASE}/api/access-tokens/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  const result = (await response.json()) as { key: AccessTokenRecord };
  return result.key;
}

/**
 * List all installed addons
 */
export async function listAddons(
  token: string,
): Promise<{ addons: AddonRecord[]; total: number }> {
  const response = await fetch(`${API_BASE}/api/addons`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json() as Promise<{ addons: AddonRecord[]; total: number }>;
}

export async function enableAddon(
  token: string,
  addonId: string,
  approvedPermissions: string[],
): Promise<{ addon: AddonRecord; accessToken: string }> {
  const response = await fetch(`${API_BASE}/api/addons/${addonId}/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ approvedPermissions }),
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json() as Promise<{
    addon: AddonRecord;
    accessToken: string;
  }>;
}

export async function refreshAddonToken(
  token: string,
  addonId: string,
): Promise<{ accessToken: string }> {
  const response = await fetch(
    `${API_BASE}/api/addons/${addonId}/refresh-token`,
    {
      method: 'POST',
      headers: authHeaders(token),
    },
  );
  if (!response.ok) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json() as Promise<{ accessToken: string }>;
}

export async function disableAddon(
  token: string,
  addonId: string,
): Promise<{ addon: AddonRecord }> {
  const response = await fetch(`${API_BASE}/api/addons/${addonId}/disable`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json() as Promise<{ addon: AddonRecord }>;
}

export async function uninstallAddon(
  token: string,
  addonId: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/addons/${addonId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok && response.status !== 204) {
    const body = (await response.json()) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
}

// ============================================================================
// Pulse API functions
// ============================================================================

/**
 * List all pulses
 */
export async function listPulses(
  token: string,
): Promise<{ pulses: Pulse[]; total: number }> {
  const response = await apiFetch(`${API_BASE}/api/pulses`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to list pulses: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new pulse
 */
export async function createPulse(
  token: string,
  body: CreatePulseBody,
): Promise<{ pulse: Pulse }> {
  const response = await apiFetch(`${API_BASE}/api/pulses`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to create pulse: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get a pulse by ID
 */
export async function getPulse(
  token: string,
  id: string,
): Promise<{ pulse: Pulse }> {
  const response = await apiFetch(`${API_BASE}/api/pulses/${id}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to get pulse: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Update a pulse
 */
export async function updatePulse(
  token: string,
  id: string,
  body: UpdatePulseBody,
): Promise<{ pulse: Pulse }> {
  const response = await apiFetch(`${API_BASE}/api/pulses/${id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to update pulse: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Delete a pulse
 */
export async function deletePulse(token: string, id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/pulses/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete pulse: ${response.statusText}`);
  }
}

/**
 * Trigger a pulse manually
 */
export async function triggerPulse(
  token: string,
  id: string,
): Promise<{ run: PulseRun }> {
  const response = await apiFetch(`${API_BASE}/api/pulses/${id}/trigger`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to trigger pulse: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get pulse execution history
 */
export async function getPulseHistory(
  token: string,
  id: string,
  limit?: number,
): Promise<{ runs: PulseRun[]; total: number }> {
  const url = limit
    ? `${API_BASE}/api/pulses/${id}/history?limit=${limit}`
    : `${API_BASE}/api/pulses/${id}/history`;
  const response = await apiFetch(url, {
    headers: authHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`Failed to get pulse history: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Verify an auth token against the server
 */
export async function verifyToken(token: string): Promise<AuthVerifyResponse> {
  const response = await fetch(`${API_BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return response.json() as Promise<AuthVerifyResponse>;
}

// ============================================================================
// Channel API functions
// ============================================================================

/**
 * List all channels with their current connection status.
 */
export async function listChannels(): Promise<ChannelStatusResponse[]> {
  const res = await apiFetch(`${API_BASE}/channels`);
  if (!res.ok) throw new Error(`listChannels: ${res.status}`);
  return res.json();
}

/**
 * Get the connection status of a single channel.
 */
export async function getChannelStatus(
  id: string,
): Promise<ChannelStatusResponse> {
  const res = await apiFetch(`${API_BASE}/channels/${id}/status`);
  if (!res.ok) throw new Error(`getChannelStatus: ${res.status}`);
  return res.json();
}

/**
 * Trigger a channel connection (initiates QR flow for WhatsApp).
 */
export async function connectChannel(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/channels/${id}/connect`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`connectChannel: ${res.status}`);
}

/**
 * Disconnect a channel.
 */
export async function disconnectChannel(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/channels/${id}/disconnect`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`disconnectChannel: ${res.status}`);
}

// ============================================================================
// Provider API functions
// ============================================================================

export type ConnectProviderResponse =
  | { success: true; providerId: string }
  | { success: false; error: string };

export type OAuthStartResponse = {
  success: boolean;
  /** URL the user should open in a browser to complete OAuth. */
  authorizationUrl?: string;
  /** Internal flow id, used to poll for completion. */
  flowId?: string;
  error?: string;
};

/** Poll the server for the status of an in-flight OAuth flow. */
export async function getOAuthStatus(flowId: string): Promise<
  | {
      ok: true;
      status: 'pending' | 'authorized' | 'failed';
      verificationUrl?: string;
      userCode?: string;
      error?: string;
    }
  | { ok: false; error: 'not_found' | 'expired' }
> {
  const res = await apiFetch(
    `${API_BASE}/providers/minimax/connect/oauth/status?flowId=${encodeURIComponent(flowId)}`,
  );
  return res.json();
}

/**
 * Connect a provider using an API key.
 */
export async function connectProviderWithApiKey(
  providerId: string,
  apiKey: string,
): Promise<ConnectProviderResponse> {
  const res = await apiFetch(
    `${API_BASE}/providers/${providerId}/connect/api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    },
  );
  return res.json();
}

/**
 * Start OAuth flow for a provider.
 *
 * For MiniMax (the only OAuth-enabled provider in this phase): the
 * server returns an authorizationUrl the frontend opens in a popup.
 */
export async function startProviderOAuth(
  providerId: string,
  options: { region?: 'global' | 'cn' },
): Promise<OAuthStartResponse> {
  const body: Record<string, string> = {};
  if (options.region) body.region = options.region;

  const res = await apiFetch(
    `${API_BASE}/providers/${providerId}/connect/oauth/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return res.json();
}

/**
 * Disconnect a provider.
 *
 * Clears the encrypted credential row server-side (DELETE
 * /providers/:providerId/connection). Throws on non-2xx so callers
 * can use a try/catch for the error path. Use `useQueryClient`'s
 * `invalidateQueries({ queryKey: ['config'] })` afterwards to
 * refresh any UI that reads `AppConfig.providers[]`.
 */
export async function disconnectProvider(providerId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/providers/${providerId}/connection`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`disconnectProvider: ${res.status}`);
}
