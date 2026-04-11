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

/**
 * API error response
 */
export type ApiError = {
  error: string;
  message?: string;
  sessionId?: string;
};

/**
 * List sessions
 */
export async function listSessions(): Promise<{ items: Session[] }> {
  const response = await fetch(`${API_BASE}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a new session
 */
export async function createSession(title: string): Promise<Session> {
  const response = await fetch(`${API_BASE}/sessions`, {
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
  const response = await fetch(`${API_BASE}/sessions/${id}`);
  return response.json();
}

/**
 * List messages for a session
 */
export async function listMessages(
  sessionId: string,
): Promise<{ items: SessionMessage[] } | ApiError> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`);
  return response.json();
}

/**
 * List runs for a session
 */
export async function listRuns(
  sessionId: string,
): Promise<{ items: SessionRun[] } | ApiError> {
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/runs`);
  return response.json();
}

/**
 * List all agents
 */
export async function listAgents(): Promise<{ items: Agent[] }> {
  const response = await fetch(`${API_BASE}/agents`);
  if (!response.ok) {
    throw new Error(`Failed to list agents: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get an agent by ID
 */
export async function getAgent(id: string): Promise<Agent | ApiError> {
  const response = await fetch(`${API_BASE}/agents/${id}`);
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
  const response = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
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
  const response = await fetch(`${API_BASE}/config`);
  return response.json();
}

/**
 * Update application configuration
 */
export async function updateConfig(
  config: AppConfig,
): Promise<{ config: AppConfig; status: ConfigStatus } | ApiError> {
  const response = await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
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
  const response = await fetch(url, {
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
  const response = await fetch(
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
  const response = await fetch(
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
  const response = await fetch(`${API_BASE}/workspace/${agentId}/rename`, {
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
  const response = await fetch(
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
  const response = await fetch(
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

import type { McpServer } from '@openaidy/config';

/**
 * List all configured MCP servers and their status
 */
export async function listMcpServers(): Promise<{ servers: McpServer[] }> {
  const response = await fetch(`${API_BASE}/mcp/servers`);
  if (!response.ok) {
    throw new Error(`Failed to list MCP servers: ${response.statusText}`);
  }
  return response.json();
}
