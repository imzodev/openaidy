/**
 * Frontend type definitions
 *
 * Single source of truth for all web-client types.
 * API functions live in api.ts and ws-api.ts; no types should be declared there.
 */

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
  Session,
  MessageRole,
  SessionSearchResult,
  // Pulse types from shared-types — single source of truth.
  ScheduleInput,
  // Recurring task schedules (Phase 6). These mirror the
  // @openaidy/shared-types/task-schedules.ts DTOs — the web client
  // does NOT redeclare them.
  SchedulePreset,
  TaskScheduleStatus,
  ReplanPolicy,
  TaskScheduleDto,
  TaskExecutionHistoryStatus,
  TaskExecutionHistoryDto,
  ExecutionSubtaskSummary,
  ExecutionSubtaskSummaryItem,
  CreateTaskScheduleInput,
  UpdateTaskScheduleInput,
  ListTaskExecutionsFilters,
  PaginatedTaskExecutions,
  // Agent memory types from shared-types — single source of truth.
  Memory,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchResult,
  MemoryAgentSummary,
  // SKILL.md validation errors surfaced by GET /skills. Declared in
  // shared-types so the registry, the route, and this client agree on one
  // shape; re-exported here so existing './types' imports keep working.
  SkillLoadError,
} from '@openaidy/shared-types';

import type {
  SessionMessage as SharedSessionMessage,
  RunStatus as SharedRunStatus,
  SessionRun as SharedSessionRun,
  SessionMessageAttachment,
} from '@openaidy/shared-types';

// Attachment metadata on a session message. Declared in shared-types
// (single source of truth) and re-exported so existing './types' imports
// keep working. Bytes are fetched separately via GET /api/attachments/:id/raw
// (through the authenticated fetch).
export type { SessionMessageAttachment };

/**
 * Session message — extends shared type with UI-only reasoning content field
 */
export type SessionMessage = SharedSessionMessage & {
  reasoningContent?: string;
  attachments?: SessionMessageAttachment[];
};

/**
 * Run status — extends shared type with 'streaming' for WebSocket live state
 */
export type RunStatus = SharedRunStatus | 'streaming';

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
  mcpServers?: import('@openaidy/shared-types').McpServerRef[];
  defaults: {
    providerId?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
  };
  workspace?: AgentWorkspaceConfig;
  identity?: import('@openaidy/shared-types').AgentIdentity;
};

/**
 * Session run — extends shared type with optional agentId (API may omit it)
 * and the frontend-extended RunStatus (includes 'streaming')
 */
export type SessionRun = Omit<
  SharedSessionRun,
  'agentId' | 'status' | 'finishReason'
> & {
  agentId?: string;
  status: RunStatus;
  finishReason?: string;
};

/**
 * Builtin (native) tool info returned by GET /tools
 */
export type BuiltinToolInfo = {
  name: string;
  description: string;
  category?: string;
};

export type SkillSource = 'preinstalled' | 'modified' | 'user-global' | 'agent';

/** A single item that can be toggled on/off in a ToolToggleGrid. */
export type ToggleItem = {
  id: string;
  label: string;
  description?: string;
  category?: string;
  badge?: string;
  badgeVariant?: 'success' | 'neutral' | 'warning';
  disabled?: boolean;
  disabledReason?: string;
};

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
 * Input for creating a new agent
 */
export type CreateAgentInput = {
  id: string;
  name: string;
  enabled: boolean;
  systemPrompt: string;
  model: string;
  description?: string;
  tags?: string[];
  /** Prebuilt personality preset id; server writes its personality files. */
  personalityPresetId?: string;
};

/**
 * A user message held in the client-side send queue while the agent is
 * responding. Queued messages are sent automatically, one at a time, once
 * the active run completes. Owned/managed by the useMessageQueue hook and
 * rendered by the QueuedMessageCard component.
 */
export type QueuedMessage = {
  /** Stable client-generated id, used as the list key and for edit/remove. */
  id: string;
  /** The message body to send when this item is dequeued. */
  content: string;
  /** Agent selected at enqueue time, sent with the message. */
  agentId?: string;
  /** Attachments uploaded at enqueue time, linked when the message sends. */
  attachmentIds?: string[];
};

/**
 * Submit message input
 */
export type SubmitMessageInput = {
  role: 'user' | 'system';
  content: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
  /** Ids of previously-uploaded attachments to link to this message */
  attachmentIds?: string[];
};

/**
 * Cumulative token usage totals (per session or overall).
 */
export type UsageTotals = {
  runCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cost: number;
  hasCost: boolean;
};

export type UsageByDay = UsageTotals & { day: string };
export type UsageByProvider = UsageTotals & { providerId: string };
export type UsageByModel = UsageTotals & {
  providerId: string;
  modelId: string;
};
/**
 * Per-day × per-model rollup. Powers the stacked-bar usage chart on the
 * dashboard, which needs to know exactly how much each model contributed
 * on each day (not just the per-day total or the per-model total).
 *
 * Mirrors the server type in `apps/server/src/usage/aggregate.ts`.
 */
export type UsageByDayAndModel = UsageTotals & {
  day: string;
  providerId: string;
  modelId: string;
};

/** Aggregated usage report (GET /api/usage). */
export type UsageReport = {
  from?: string;
  to?: string;
  totals: UsageTotals;
  byDay: UsageByDay[];
  byProvider: UsageByProvider[];
  byModel: UsageByModel[];
  /**
   * Per-day × per-model breakdown. Empty when no rows in the selected
   * range. Powers the stacked-bar chart on the usage page.
   */
  byDayByModel: UsageByDayAndModel[];
};

/** Per-session usage response (GET /api/sessions/:id/usage). */
export type SessionUsageResponse = {
  sessionId: string;
  usage: UsageTotals;
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
  // Format: "providerId/modelId" e.g., "openai/gpt-4o-mini". Optional: a
  // model-less agent inherits the config default (set once the first provider
  // is connected during onboarding).
  model?: string;
  tools?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  version?: number;
};

/**
 * Application defaults
 */
export type AppDefaults = {
  // Optional to represent an unconfigured install (no providers yet). Both are
  // set once the first provider is connected during onboarding.
  providerId?: string;
  modelId?: string;
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
 * A configured messaging channel. Shapes mirror the channel schemas in
 * packages/config (`whatsappChannelConfigSchema` / `discordChannelConfigSchema`).
 */
export type WhatsAppChannelConfig = {
  type: 'whatsapp';
  id: string;
  agentId: string;
  allowlist?: string[];
  enabled?: boolean;
};

/** A secret value: env-var reference or inline (encrypted at rest server-side). */
export type ChannelSecretValue =
  | string
  | { kind: 'env' | 'inline'; value: string };

export type DiscordChannelConfig = {
  type: 'discord';
  id: string;
  agentId: string;
  botToken: ChannelSecretValue;
  dmAllowlist?: string[];
  channelAllowlist?: string[];
  respondToMentions?: boolean;
  enabled?: boolean;
};

export type ChannelConfig = WhatsAppChannelConfig | DiscordChannelConfig;

/**
 * Application configuration
 *
 * `channels` (and `mcpServers`, not modelled here) round-trip through the raw
 * config JSON; `channels` is typed so the UI can add/remove entries safely.
 */
export type AppConfig = {
  version: number;
  defaults: AppDefaults;
  providers: ProviderConfig[];
  agents: AgentConfig[];
  channels?: ChannelConfig[];
};

/**
 * Per-agent notice shown when the agent's `model` field was
 * rewritten to the project default because the provider it pointed
 * at was disconnected. The notice stays visible until the user
 * edits the agent or explicitly dismisses it, so the user always
 * understands *why* the model value changed.
 */
export type RewiredAgentNotice = {
  /** The agent whose `model` was auto-rewired. */
  agentId: string;
  /** The provider that was disconnected, for context in the UI. */
  fromProviderId: string;
  /** The model value the agent used before the rewire. */
  fromModel: string;
  /** The model value the agent was re-pointed to. */
  toModel: string;
  /** ISO timestamp of the rewire, for ordering / debugging. */
  rewiredAt: string;
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

export type {
  CreatePulseInput as CreatePulseBody,
  UpdatePulseInput as UpdatePulseBody,
} from '@openaidy/shared-types';

/**
 * Build / runtime info exposed by GET /api/info.
 * `version` is semver ("0.3.0", no "v"). The UI prepends "v" for display.
 */
export type AppInfo = {
  version: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  pid: number;
  startedAt: string;
  uptimeMs: number;
};
