import {
  type LogFilter,
  type LogQueryResult,
  type LogStats,
  type ApiError,
  type AccessTokenRecord,
  type CreateAccessTokenRequest,
  type CreateAccessTokenResponse,
  type AuthVerifyResponse,
  ApiRequestError,
} from '@openaidy/shared-types';
import { getStoredToken } from './auth-token';
export type { AccessTokenRecord, CreateAccessTokenResponse };

/**
 * API client for session endpoints
 */

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
 * Session record
 */
export type Session = {
  id: string;
  title: string;
  createdAt: string;
};

/**
 * Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Session message record
 */
export type SessionMessage = {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  sequence: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

/**
 * Run status
 */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/**
 * Agent configuration
 */
export type AgentWorkspacePermission = {
  read: boolean;
  write: boolean;
  delete: boolean;
  list: boolean;
};

export type AgentWorkspace = {
  path: string;
  permissions: AgentWorkspacePermission;
};

export type AgentWorkspaceConfig = {
  enabled: boolean;
  defaultPermissions?: AgentWorkspacePermission;
  workspaces: AgentWorkspace[];
};

export type Agent = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  systemPrompt: string;
  model: string; // Format: "providerId/modelId" e.g., "openai/gpt-4o-mini"
  tags?: string[];
  tools?: string[];
  skills?: string[];
  defaults: {
    providerId?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
  };
  workspace?: AgentWorkspaceConfig;
};

/**
 * Session run record
 */
export type SessionRun = {
  id: string;
  sessionId: string;
  agentId?: string;
  providerId: string;
  modelId: string;
  status: RunStatus;
  finishReason?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
};

export type { ApiError, ApiRequestError } from '@openaidy/shared-types';

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
 * Builtin (native) tool info returned by GET /tools
 */
export type BuiltinToolInfo = {
  name: string;
  description: string;
};

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

export type SkillSource = 'preinstalled' | 'modified' | 'user-global' | 'agent';

/**
 * Skill info returned by GET /skills
 */
export type SkillInfo = {
  id: string;
  name: string;
  description: string;
  source?: SkillSource;
  agentId?: string;
};

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
 * Submit message input
 */
export type SubmitMessageInput = {
  role: 'user' | 'system';
  content: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
};

/**
 * Submit message result
 */
export type SubmitMessageResult =
  | {
      ok: true;
      userMessage: SessionMessage;
      assistantMessage: SessionMessage;
      run: SessionRun;
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

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
 * Model capability
 */
export type ModelCapability =
  | 'text_generation'
  | 'streaming'
  | 'tool_calls'
  | 'vision'
  | 'audio_input'
  | 'audio_output'
  | 'embedding';

/**
 * Model configuration within a provider
 */
export type ModelConfig = {
  id: string;
  name: string;
  enabled?: boolean;
  description?: string;
  capabilities?: ModelCapability[];
  contextWindow?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
};

/**
 * Agent defaults
 */
export type AgentDefaults = {
  providerId?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Agent configuration
 */
export type AgentConfig = {
  id: string;
  name: string;
  enabled?: boolean;
  description?: string;
  systemPrompt: string;
  model: string; // Format: "providerId/modelId" e.g., "openai/gpt-4o-mini"
  tools?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  version?: number;
};

/**
 * Application defaults
 */
export type AppDefaults = {
  providerId: string;
  modelId: string;
  agentId: string;
};

/**
 * Provider configuration (discriminated union by vendorFamily)
 */
export type OpenAICompatibleProviderConfig = {
  id: string;
  name: string;
  vendorFamily: 'openai-compatible';
  enabled?: boolean;
  baseUrl?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  organizationId?: string;
  timeout?: { connect?: number; read?: number; write?: number };
  retry?: { maxAttempts?: number; baseDelay?: number; maxDelay?: number };
  headers?: Record<string, string>;
  priority?: number;
  metadata?: Record<string, unknown>;
  models: ModelConfig[];
  chatModel?: string;
  embeddingModel?: string;
  audioModel?: string;
  imageModel?: string;
  useResponsesApi?: boolean;
  enableTools?: boolean;
  enableVision?: boolean;
  enableStreaming?: boolean;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
};

export type AnthropicProviderConfig = {
  id: string;
  name: string;
  vendorFamily: 'anthropic';
  enabled?: boolean;
  baseUrl?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  organizationId?: string;
  timeout?: { connect?: number; read?: number; write?: number };
  retry?: { maxAttempts?: number; baseDelay?: number; maxDelay?: number };
  headers?: Record<string, string>;
  priority?: number;
  metadata?: Record<string, unknown>;
  models: ModelConfig[];
  apiVersion?: string;
  messagesModel?: string;
  betas?: string[];
  enableExtendedThinking?: boolean;
  maxThinkingTokens?: number;
  enableTools?: boolean;
  enableVision?: boolean;
  enableStreaming?: boolean;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  systemPrompt?: string;
};

export type GeminiProviderConfig = {
  id: string;
  name: string;
  vendorFamily: 'gemini';
  enabled?: boolean;
  baseUrl?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  organizationId?: string;
  timeout?: { connect?: number; read?: number; write?: number };
  retry?: { maxAttempts?: number; baseDelay?: number; maxDelay?: number };
  headers?: Record<string, string>;
  priority?: number;
  metadata?: Record<string, unknown>;
  models: ModelConfig[];
  projectId?: string;
  region?: string;
  useVertexAI?: boolean;
  embeddingModel?: string;
  safetySettings?: Array<{
    category:
      | 'HARM_CATEGORY_HARASSMENT'
      | 'HARM_CATEGORY_HATE_SPEECH'
      | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
      | 'HARM_CATEGORY_DANGEROUS_CONTENT'
      | 'HARM_CATEGORY_CIVIC_INTEGRITY';
    threshold:
      | 'BLOCK_NONE'
      | 'BLOCK_LOW_AND_ABOVE'
      | 'BLOCK_MEDIUM_AND_ABOVE'
      | 'BLOCK_ONLY_HIGH';
  }>;
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    candidateCount?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    responseMimeType?: 'text/plain' | 'application/json';
  };
  enableTools?: boolean;
  enableVision?: boolean;
  enableAudioInput?: boolean;
  enableStreaming?: boolean;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  systemInstruction?: string;
};

export type ProviderConfig =
  | OpenAICompatibleProviderConfig
  | AnthropicProviderConfig
  | GeminiProviderConfig;

/**
 * Application configuration
 */
export type AppConfig = {
  version: number;
  defaults: AppDefaults;
  providers: ProviderConfig[];
  agents: AgentConfig[];
};

/**
 * Configuration issue
 */
export type ConfigIssue = {
  scope: 'provider';
  id: string;
  code: string;
  message: string;
};

/**
 * Configuration status
 */
export type ConfigStatus = {
  issues: ConfigIssue[];
};

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
// Workspace Types and API Functions
// ============================================================================

/**
 * Workspace file metadata
 */
export type WorkspaceFileInfo = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
};

/**
 * Workspace file list response
 */
export type WorkspaceFileListResponse = {
  items: WorkspaceFileInfo[];
  path?: string;
};

/**
 * Workspace file content response
 */
export type WorkspaceFileContentResponse = {
  content: string;
  path: string;
  isText: boolean;
  mimeType: string;
  size: number;
  modifiedAt: string;
  isTooLarge: boolean;
  maxEditableBytes?: number;
};

/**
 * Workspace write response
 */
export type WorkspaceWriteResponse = {
  success: boolean;
  path: string;
};

/**
 * Workspace error response
 */
export type WorkspaceErrorResponse = {
  error: string;
  code: string;
};

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

// Export getApiBase for testing
export { getApiBase };

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

import type {
  McpServerRecord,
  McpToolWithSchema,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
} from '@openaidy/shared-types';
export type {
  McpServerRecord,
  McpToolWithSchema,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
};

/**
 * List all configured MCP servers and their live runtime status.
 * Returns both persisted config fields and current connection state.
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

export interface AddonRecord {
  id: string;
  addonId: string;
  name: string;
  version: string;
  description?: string;
  status: 'installed' | 'enabled' | 'disabled' | 'error';
  installedAt: string;
  installedBy: string;
  manifest: Record<string, unknown>;
  permissions?: string[];
  approvedPermissions?: string[];
}

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
// Pulse API types
// ============================================================================

export type Pulse = {
  id: string;
  name: string;
  prompt: string;
  scheduleHuman: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  agentId: string | null;
  sessionId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
};

export type PulseRun = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attemptNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type ScheduleInput =
  | { every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }
  | { daily: { hour: number; minute: number } }
  | { cron: string; tz?: string }
  | { at: string };

export type CreatePulseBody = {
  name: string;
  prompt: string;
  schedule: ScheduleInput;
  agentId?: string;
  sessionId?: string;
};

export type UpdatePulseBody = {
  name?: string;
  prompt?: string;
  schedule?: ScheduleInput;
  status?: 'active' | 'paused' | 'completed' | 'failed';
  agentId?: string;
  sessionId?: string;
};

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
