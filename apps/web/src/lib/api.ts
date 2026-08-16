/**
 * REST API client — fetch functions only.
 * All type definitions live in ./types.ts
 */

import { ApiRequestError } from '@openaidy/shared-types';
import type { UpdateCheckResult, UpdateState } from '@openaidy/shared-types';
import { getStoredToken } from './auth-token';

export type {
  Session,
  MessageRole,
  SessionMessage,
  SessionMessageAttachment,
  RunStatus,
  AgentWorkspacePermission,
  AgentWorkspace,
  AgentWorkspaceConfig,
  Agent,
  AgentIdentity,
  AgentIdentityAsset,
  SessionRun,
  BuiltinToolInfo,
  SkillSource,
  SkillInfo,
  SkillLoadError,
  CreateAgentInput,
  SubmitMessageInput,
  SubmitMessageResult,
  UsageTotals,
  UsageReport,
  SessionUsageResponse,
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
  AppInfo,
  Memory,
  MemorySearchResult,
  MemoryAgentSummary,
  CreateMemoryInput,
  UpdateMemoryInput,
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
  McpSecretKind,
  McpSecretField,
  McpSecretValue,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  ImportMcpServersRequest,
  ChannelStatusResponse,
  ChannelConfig,
} from './types';

export { ApiRequestError } from '@openaidy/shared-types';
export type { UpdateCheckResult, UpdateState } from '@openaidy/shared-types';

import type {
  Session,
  SessionMessage,
  SessionRun,
  Agent,
  BuiltinToolInfo,
  SkillInfo,
  SkillLoadError,
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
  AppInfo,
  Memory,
  MemorySearchResult,
  MemoryAgentSummary,
  CreateMemoryInput,
  UpdateMemoryInput,
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
  ImportMcpServersRequest,
  ChannelStatusResponse,
  ChannelConfig,
} from './types';

/**
 * Get the API base URL.
 *
 * Resolved once from OPENAIDY_VITE_SERVER_URL. Empty string (the default
 * when the env var is unset) means same-origin — the browser resolves
 * relative URLs against the current host. The Vite dev proxy (see
 * vite.config.ts) forwards same-origin `/api` and `/ws` requests to the
 * backend, and `--integrated` mode serves the built bundle from the
 * server on the same origin.
 */
function getApiBase(): string {
  return import.meta.env.OPENAIDY_VITE_SERVER_URL ?? '';
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
 * List active sessions.
 *
 * Arg-less by design so it can be passed straight to a query's `queryFn`
 * (the query context arg would otherwise leak into a query string). Use
 * {@link listArchivedSessions} for the archived view.
 */
export async function listSessions(): Promise<{ items: Session[] }> {
  const response = await apiFetch(`${API_BASE}/api/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * List archived sessions (status=archived).
 */
export async function listArchivedSessions(): Promise<{ items: Session[] }> {
  const response = await apiFetch(`${API_BASE}/api/sessions?status=archived`);
  if (!response.ok) {
    throw new Error(`Failed to list archived sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Update a session: rename (title), archive/unarchive (status), and/or
 * favorite/unfavorite (favorited). Only the provided fields change.
 */
export async function updateSession(
  id: string,
  patch: {
    title?: string;
    status?: 'active' | 'archived';
    favorited?: boolean;
  },
): Promise<Session> {
  const response = await apiFetch(`${API_BASE}/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string; error?: string }).message ??
        (err as { error?: string }).error ??
        `Failed to update session: ${response.statusText}`,
    );
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

  const response = await apiFetch(`${API_BASE}/api/sessions/search?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to search sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new session
 */
export async function createSession(
  title: string,
  options?: { ephemeral?: boolean },
): Promise<Session> {
  const response = await apiFetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, ...options }),
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
  const response = await apiFetch(`${API_BASE}/api/sessions/${id}`);
  return response.json();
}

/**
 * Delete a session.
 *
 * Cascades to messages and runs on the server. The caller (typically
 * a confirmation modal) is responsible for the UX — this just fires
 * the request and throws on a non-2xx response.
 */
export async function deleteSession(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/sessions/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.statusText}`);
  }
}

/**
 * List messages for a session
 */
export async function listMessages(
  sessionId: string,
): Promise<{ items: SessionMessage[] } | ApiError> {
  const response = await apiFetch(
    `${API_BASE}/api/sessions/${sessionId}/messages`,
  );
  return response.json();
}

/**
 * List runs for a session
 */
export async function listRuns(
  sessionId: string,
): Promise<{ items: SessionRun[] } | ApiError> {
  const response = await apiFetch(`${API_BASE}/api/sessions/${sessionId}/runs`);
  return response.json();
}

/**
 * List all available builtin tools registered on the server
 */
export async function listBuiltinTools(): Promise<{
  items: BuiltinToolInfo[];
}> {
  const response = await apiFetch(`${API_BASE}/api/tools`);
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
  const response = await apiFetch(`${API_BASE}/api/agents/${agentId}/tools`, {
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
  const response = await apiFetch(`${API_BASE}/api/agents/${agentId}`);
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
  const response = await apiFetch(
    `${API_BASE}/api/agents/${agentId}/mcp-servers`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpServers }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to update agent MCP servers: ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * List all available skills registered on the server.
 * `loadErrors` lists SKILL.md files the registry rejected (e.g. missing
 * frontmatter). Those files exist on disk but are NOT included in `items`,
 * so without this field operators have no way to see why a listed skill
 * silently does not work.
 */
export async function listSkills(): Promise<{
  items: SkillInfo[];
  loadErrors: SkillLoadError[];
}> {
  const response = await apiFetch(`${API_BASE}/api/skills`);
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
  const response = await apiFetch(`${API_BASE}/api/agents/${agentId}/skills`);
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
  const response = await apiFetch(`${API_BASE}/api/agents/${agentId}/skills`, {
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
  const response = await apiFetch(`${API_BASE}/api/agents`);
  if (!response.ok) {
    throw new Error(`Failed to list agents: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get an agent by ID
 */
export async function getAgent(id: string): Promise<Agent | ApiError> {
  const response = await apiFetch(`${API_BASE}/api/agents/${id}`);
  return response.json();
}

/**
 * Create a new agent
 */
export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const response = await apiFetch(`${API_BASE}/api/agents`, {
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
  const response = await apiFetch(`${API_BASE}/api/agents/${agentId}`, {
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
  const response = await apiFetch(
    `${API_BASE}/api/agents/${agentId}/personality`,
  );
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
    `${API_BASE}/api/agents/${agentId}/personality/${fileId}`,
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
    `${API_BASE}/api/agents/${agentId}/personality/${fileId}`,
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
    `${API_BASE}/api/sessions/${sessionId}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return response.json();
}

/**
 * Upload an image/audio file as a pending attachment for a session.
 * Returns the attachment metadata; pass its id in `attachmentIds` when
 * submitting the message.
 */
export async function uploadAttachment(
  sessionId: string,
  file: File,
): Promise<import('./types').SessionMessageAttachment> {
  const data = await fileToBase64(file);
  const response = await apiFetch(
    `${API_BASE}/api/sessions/${sessionId}/attachments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mimeType: file.type,
        name: file.name,
        data,
      }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: string;
    };
    throw new Error(
      body.message ?? body.error ?? `Upload failed (${response.status})`,
    );
  }
  return response.json();
}

/** Read a File's bytes as a bare base64 string (no data: URI prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Fetch an attachment's raw bytes (authenticated) and return an object URL
 * suitable for <img src> / <audio src>. Callers must revoke the URL when
 * done (URL.revokeObjectURL).
 */
export async function fetchAttachmentObjectUrl(
  attachmentId: string,
): Promise<string> {
  const response = await apiFetch(
    `${API_BASE}/api/attachments/${attachmentId}/raw`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load attachment (${response.status})`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Fetch cumulative token usage + cost for a single session.
 */
export async function getSessionUsage(
  sessionId: string,
): Promise<import('./types').SessionUsageResponse | ApiError> {
  const response = await apiFetch(
    `${API_BASE}/api/sessions/${sessionId}/usage`,
  );
  return response.json();
}

/**
 * Fetch per-session usage totals for every session with usage, in one request
 * (keyed by session id). Powers the usage shown on the sessions list without
 * an N+1 fan-out of getSessionUsage. Returns an empty map on error so the list
 * still renders.
 */
export async function getUsageBySession(): Promise<
  Record<string, import('./types').UsageTotals>
> {
  const response = await apiFetch(`${API_BASE}/api/usage/sessions`);
  if (!response.ok) return {};
  const body = (await response.json()) as {
    usageBySession?: Record<string, import('./types').UsageTotals>;
  };
  return body.usageBySession ?? {};
}

/**
 * Fetch usage totals for a specific set of session IDs. Avoids fetching
 * the full usage map when only a few sessions are needed (e.g. for task
 * execution history rows). Gracefully degrades to an empty map on error.
 */
export async function getUsageBySessionIds(
  sessionIds: string[],
): Promise<Record<string, import('./types').UsageTotals>> {
  if (sessionIds.length === 0) return {};
  const params = new URLSearchParams();
  params.set('sessionIds', sessionIds.join(','));
  const response = await apiFetch(
    `${API_BASE}/api/usage/sessions?${params.toString()}`,
  );
  if (!response.ok) return {};
  const body = (await response.json()) as {
    usageBySession?: Record<string, import('./types').UsageTotals>;
  };
  return body.usageBySession ?? {};
}

/**
 * Fetch aggregated usage across all sessions, optionally within a date
 * range (ISO strings; `to` exclusive).
 */
export async function getUsage(options?: {
  from?: string;
  to?: string;
}): Promise<import('./types').UsageReport | ApiError> {
  const params = new URLSearchParams();
  if (options?.from) params.set('from', options.from);
  if (options?.to) params.set('to', options.to);
  const qs = params.toString();
  const response = await apiFetch(`${API_BASE}/api/usage${qs ? `?${qs}` : ''}`);
  return response.json();
}

/**
 * Get application configuration
 */
export async function getConfig(): Promise<
  { config: AppConfig; status: ConfigStatus } | ApiError
> {
  const response = await apiFetch(`${API_BASE}/api/config`);
  return response.json();
}

/**
 * Update application configuration
 */
export async function updateConfig(
  config: AppConfig,
): Promise<{ config: AppConfig; status: ConfigStatus } | ApiError> {
  const response = await apiFetch(`${API_BASE}/api/config`, {
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
  path?: string,
): Promise<WorkspaceFileListResponse | WorkspaceErrorResponse> {
  const url = path
    ? `${API_BASE}/api/workspace/${agentId}/files/${path}`
    : `${API_BASE}/api/workspace/${agentId}/files`;
  const response = await apiFetch(url);
  return response.json();
}

/**
 * Read a file from an agent's workspace
 */
export async function readWorkspaceFile(
  agentId: string,
  filePath: string,
): Promise<WorkspaceFileContentResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/api/workspace/${agentId}/files/${filePath}`,
  );
  return response.json();
}

/**
 * Fetch a workspace file's raw bytes as a Blob (e.g. for image preview).
 *
 * Goes through the authenticated fetch wrapper, so the caller should turn the
 * result into an object URL (`URL.createObjectURL`) for an <img> src — a plain
 * <img src="/api/..."> can't send the Bearer token.
 */
export async function fetchWorkspaceFileBlob(
  agentId: string,
  filePath: string,
): Promise<Blob> {
  const response = await apiFetch(
    `${API_BASE}/api/workspace/${agentId}/raw/${filePath}`,
  );
  if (!response.ok) {
    let message = `Failed to load file (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }
  return response.blob();
}

/**
 * Download a workspace file to the user's machine. Streams the file via
 * the authenticated raw endpoint, then triggers a browser save dialog
 * with `fileName` as the suggested filename.
 *
 * The fetch goes through the Bearer-token wrapper, so a plain
 * `<a href="/api/...">` won't work (the browser can't attach the auth
 * header). We pull the bytes, build an object URL, click an anchor
 * programmatically, and revoke the URL once the save has been kicked
 * off — keeping the blob alive long enough for the download to start.
 */
export async function downloadWorkspaceFile(
  agentId: string,
  filePath: string,
  fileName: string,
): Promise<void> {
  const blob = await fetchWorkspaceFileBlob(agentId, filePath);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    // Firefox requires the anchor to be in the DOM for the click to
    // be honored; appending/cleaning keeps the side effect invisible.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Write a file to an agent's workspace
 */
export async function writeWorkspaceFile(
  agentId: string,
  filePath: string,
  content: string,
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/api/workspace/${agentId}/files/${filePath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/api/workspace/${agentId}/rename`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sourcePath, destinationPath }),
    },
  );
  return response.json();
}

/**
 * Update an existing file in an agent's workspace
 */
export async function updateWorkspaceFile(
  agentId: string,
  filePath: string,
  content: string,
  expectedModifiedAt?: string,
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/api/workspace/${agentId}/files/${filePath}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
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
): Promise<WorkspaceWriteResponse | WorkspaceErrorResponse> {
  const response = await apiFetch(
    `${API_BASE}/api/workspace/${agentId}/files/${filePath}`,
    {
      method: 'DELETE',
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

  const response = await apiFetch(`${API_BASE}/api/logs?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to query logs: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get log statistics
 */
export async function getLogStats(): Promise<LogStats> {
  const response = await apiFetch(`${API_BASE}/api/logs/stats`);
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
  const response = await apiFetch(`${API_BASE}/api/logs`, {
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
  const response = await apiFetch(`${API_BASE}/api/mcp/servers`);
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
  const response = await apiFetch(`${API_BASE}/api/mcp/servers`, {
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
 * Import one or more MCP servers from the standard keyed-map config format
 * (Claude Desktop / VS Code / Cursor). Atomic on the server: nothing is
 * imported if any entry is invalid or any id already exists.
 */
export async function importMcpServers(
  body: ImportMcpServersRequest,
): Promise<{ servers: McpServerRecord[] }> {
  const response = await apiFetch(`${API_BASE}/api/mcp/servers/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as ApiError;
    throw new ApiRequestError(response.status, errBody);
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
  const response = await apiFetch(`${API_BASE}/api/mcp/servers/${id}`, {
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
  const response = await apiFetch(`${API_BASE}/api/mcp/servers/${id}`, {
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
  const response = await apiFetch(`${API_BASE}/api/mcp/servers/${id}/connect`, {
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
  const response = await apiFetch(
    `${API_BASE}/api/mcp/servers/${id}/disconnect`,
    {
      method: 'POST',
    },
  );
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
  const response = await apiFetch(`${API_BASE}/api/mcp/servers/${id}/tools`);
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

/**
 * Mint a short-lived, addon-scoped asset token. The sandboxed addon iframe
 * loads its static assets at an opaque origin (no Authorization header or
 * cookie possible), so this token is placed on the iframe/asset URLs (`?at=`)
 * to authenticate those loads.
 */
export async function getAddonAssetToken(
  addonId: string,
): Promise<{ token: string; expiresIn: number }> {
  const response = await apiFetch(
    `${API_BASE}/api/addons/${addonId}/asset-token`,
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      error: 'request.failed',
    }))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json() as Promise<{ token: string; expiresIn: number }>;
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
  const res = await apiFetch(`${API_BASE}/api/channels`);
  if (!res.ok) throw new Error(`listChannels: ${res.status}`);
  return res.json();
}

/**
 * Get the connection status of a single channel.
 */
export async function getChannelStatus(
  id: string,
): Promise<ChannelStatusResponse> {
  const res = await apiFetch(`${API_BASE}/api/channels/${id}/status`);
  if (!res.ok) throw new Error(`getChannelStatus: ${res.status}`);
  return res.json();
}

/**
 * Trigger a channel connection (initiates QR flow for WhatsApp).
 */
export async function connectChannel(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/channels/${id}/connect`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`connectChannel: ${res.status}`);
}

/**
 * Disconnect a channel.
 */
export async function disconnectChannel(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/channels/${id}/disconnect`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`disconnectChannel: ${res.status}`);
}

/**
 * Add a WhatsApp channel to the config. Reads the current config, appends the
 * new channel entry, and persists it via the config PUT — the server then
 * reconciles it into the live channel registry, so the caller can immediately
 * `connectChannel(id)` to start the QR pairing flow without a restart.
 *
 * Throws if the id already exists or the config write fails.
 */
export async function addWhatsAppChannel(input: {
  id: string;
  agentId: string;
  allowlist?: string[];
  stripThinking?: boolean;
}): Promise<void> {
  const current = await getConfig();
  if (!('config' in current)) {
    throw new Error('Failed to load config');
  }
  const config = current.config;
  const channels = config.channels ?? [];
  if (channels.some((c) => c.id === input.id)) {
    throw new Error(`A channel with id "${input.id}" already exists`);
  }
  const entry: ChannelConfig = {
    type: 'whatsapp',
    id: input.id,
    agentId: input.agentId,
    enabled: true,
    stripThinking: input.stripThinking ?? true,
    ...(input.allowlist && input.allowlist.length > 0
      ? { allowlist: input.allowlist }
      : {}),
  };
  const result = await updateConfig({
    ...config,
    channels: [...channels, entry],
  });
  if ('error' in result) {
    throw new Error(`Failed to save channel: ${result.error}`);
  }
}

/**
 * Add a Discord channel to the config. Like {@link addWhatsAppChannel}, this
 * reads the current config, appends the entry, and persists it via the config
 * PUT; the server encrypts the inline bot token at rest and reconciles the
 * channel into the live registry so the caller can immediately connect it.
 *
 * Throws if the id already exists or the config write fails.
 */
export async function addDiscordChannel(input: {
  id: string;
  agentId: string;
  botToken: string;
  dmAllowlist?: string[];
  channelAllowlist?: string[];
  respondToMentions?: boolean;
  stripThinking?: boolean;
}): Promise<void> {
  const current = await getConfig();
  if (!('config' in current)) {
    throw new Error('Failed to load config');
  }
  const config = current.config;
  const channels = config.channels ?? [];
  if (channels.some((c) => c.id === input.id)) {
    throw new Error(`A channel with id "${input.id}" already exists`);
  }
  const entry: ChannelConfig = {
    type: 'discord',
    id: input.id,
    agentId: input.agentId,
    // Sent as plaintext inline; the server encrypts it to enc:v1: on save.
    botToken: { kind: 'inline', value: input.botToken },
    enabled: true,
    respondToMentions: input.respondToMentions ?? true,
    stripThinking: input.stripThinking ?? true,
    ...(input.dmAllowlist && input.dmAllowlist.length > 0
      ? { dmAllowlist: input.dmAllowlist }
      : {}),
    ...(input.channelAllowlist && input.channelAllowlist.length > 0
      ? { channelAllowlist: input.channelAllowlist }
      : {}),
  };
  const result = await updateConfig({
    ...config,
    channels: [...channels, entry],
  });
  if ('error' in result) {
    throw new Error(`Failed to save channel: ${result.error}`);
  }
}

/**
 * Remove a channel from the config by id. The server reconciles the live
 * registry, disconnecting and dropping the channel.
 */
export async function removeChannel(id: string): Promise<void> {
  const current = await getConfig();
  if (!('config' in current)) {
    throw new Error('Failed to load config');
  }
  const config = current.config;
  const channels = (config.channels ?? []).filter((c) => c.id !== id);
  const result = await updateConfig({ ...config, channels });
  if ('error' in result) {
    throw new Error(`Failed to remove channel: ${result.error}`);
  }
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
    `${API_BASE}/api/providers/minimax/connect/oauth/status?flowId=${encodeURIComponent(flowId)}`,
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
    `${API_BASE}/api/providers/${providerId}/connect/api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    },
  );
  return res.json();
}

/**
 * Discover the models a local provider currently serves. Takes the provider's
 * preset id (e.g. `"ollama"`); the server resolves the localhost base URL and
 * probes its `/models` endpoint. Used to auto-populate a local provider's
 * (Ollama / LM Studio) model list before it is saved to config. Throws with a
 * readable message when the server can't be reached so the modal can surface it.
 */
export async function discoverProviderModels(
  id: string,
): Promise<{ id: string; name: string }[]> {
  const res = await apiFetch(`${API_BASE}/api/providers/discover-models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body = (await res.json()) as {
    models?: { id: string; name: string }[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(
      body.message || body.error || `Discovery failed (${res.status})`,
    );
  }
  return body.models ?? [];
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
    `${API_BASE}/api/providers/${providerId}/connect/oauth/start`,
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
  const res = await apiFetch(
    `${API_BASE}/api/providers/${providerId}/connection`,
    {
      method: 'DELETE',
    },
  );
  if (!res.ok) throw new Error(`disconnectProvider: ${res.status}`);
}

/**
 * Fetch build / runtime info (version, node, platform, uptime).
 * Returns the raw AppInfo shape — `version` is semver ("0.3.0", no "v");
 * callers that want the GitHub-tag display format must prepend "v".
 */
export async function fetchAppInfo(): Promise<AppInfo> {
  const response = await apiFetch(`${API_BASE}/api/info`);
  if (!response.ok) {
    throw new Error(`Failed to fetch app info: ${response.statusText}`);
  }
  return response.json();
}

// ============================================================================
// Self-update API Functions (issue #456)
// ============================================================================

/**
 * Check the npm registry for a newer version. Throws on network/registry
 * failure (the server returns 502) so callers can show "Unable to check".
 * Requires admin scope; a non-admin token yields a 401/403 (also a throw).
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const response = await apiFetch(`${API_BASE}/api/update/check`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      error: 'request.failed',
    }))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

/**
 * Trigger a self-update (admin-only). The server installs the latest version
 * and restarts; this resolves with the initial `installing` state (HTTP 202).
 * Throws `ApiRequestError` on 400/409/502 (e.g. dev install can't self-update,
 * already up to date, or an update is already running).
 */
export async function triggerUpdate(): Promise<UpdateState> {
  const response = await apiFetch(`${API_BASE}/api/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      error: 'request.failed',
    }))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

/**
 * Poll the in-memory state of any in-flight update. Callers should expect
 * this to reject with a network error while the server is mid-restart —
 * that's the expected signal to keep polling, not a real failure.
 */
export async function fetchUpdateStatus(): Promise<UpdateState> {
  const response = await apiFetch(`${API_BASE}/api/update/status`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      error: 'request.failed',
    }))) as ApiError;
    throw new ApiRequestError(response.status, body);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Agent memories
// ---------------------------------------------------------------------------

/**
 * List agents paired with their memory counts (for the memory page's
 * left-rail selector), plus the grand total across all agents.
 */
export async function listMemoryAgents(): Promise<{
  items: MemoryAgentSummary[];
  total: number;
}> {
  const response = await apiFetch(`${API_BASE}/api/memories/agents`);
  if (!response.ok) {
    throw new Error(`Failed to list memory agents: ${response.statusText}`);
  }
  return response.json();
}

/**
 * List memories, optionally scoped to an agent. When `q` is provided the
 * server runs a full-text search instead of a plain listing.
 */
export async function listMemories(params?: {
  agentId?: string;
  q?: string;
  limit?: number;
}): Promise<{ items: Memory[] }> {
  const query = new URLSearchParams();
  if (params?.agentId) query.set('agentId', params.agentId);
  if (params?.q) query.set('q', params.q);
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  const qs = query.toString();
  const response = await apiFetch(
    `${API_BASE}/api/memories${qs ? `?${qs}` : ''}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to list memories: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Full-text search memories, optionally scoped to a single agent.
 * Results carry a BM25 `rank` (lower = better match).
 */
export async function searchMemories(
  q: string,
  agentId?: string,
  limit?: number,
): Promise<{ items: MemorySearchResult[] }> {
  const query = new URLSearchParams({ q });
  if (agentId) query.set('agentId', agentId);
  if (limit !== undefined) query.set('limit', String(limit));
  const response = await apiFetch(
    `${API_BASE}/api/memories?${query.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to search memories: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a memory for the given agent.
 */
export async function createMemory(
  input: CreateMemoryInput & { agentId: string },
): Promise<Memory> {
  const response = await apiFetch(`${API_BASE}/api/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
        `Failed to create memory: ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * Update an existing memory. `patch` is a partial — only provided fields change.
 */
export async function updateMemory(
  id: string,
  patch: UpdateMemoryInput,
): Promise<Memory> {
  const response = await apiFetch(`${API_BASE}/api/memories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
        `Failed to update memory: ${response.statusText}`,
    );
  }
  return response.json();
}

/**
 * Delete a memory by ID.
 */
export async function deleteMemory(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/api/memories/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ??
        `Failed to delete memory: ${response.statusText}`,
    );
  }
}
