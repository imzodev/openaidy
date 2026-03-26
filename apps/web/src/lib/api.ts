/**
 * API client for session endpoints
 */

/**
 * Get the API base URL
 *
 * Priority:
 * 1. VITE_API_URL environment variable
 * 2. In development: http://localhost:3001 (server default port)
 * 3. In production: throw error if not configured
 */
function getApiBase(): string {
  const envUrl = import.meta.env.VITE_API_URL;

  if (envUrl) {
    return envUrl;
  }

  // Check if we're in development mode
  if (import.meta.env.DEV) {
    return 'http://localhost:3001';
  }

  // Production without VITE_API_URL - throw clear error
  throw new Error(
    'VITE_API_URL environment variable is required in production. ' +
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
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/**
 * Agent configuration
 */
export type Agent = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  systemPrompt: string;
  defaults: {
    providerId?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
  };
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

// Export getApiBase for testing
export { getApiBase };
