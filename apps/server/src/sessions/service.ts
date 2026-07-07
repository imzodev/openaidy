import type { FastifyBaseLogger } from 'fastify';
import type { ProviderServices } from '../providers';
import type { AgentRegistry } from '../agents';
import type { McpClientService, McpToolResult } from '../mcp/client';
import type { WorkspaceService } from '../workspace/service';
import {
  isScreenshotTool,
  stripScreenshotFilename,
  persistScreenshotImages,
} from '../mcp/screenshot-capture';
import type { BuiltinToolRegistry } from '../tools';
import type {
  ToolDefinition,
  Message,
  ModelRequest,
  ModelResponse,
  ToolCallRequest,
} from '@openaidy/runtime';
import {
  type SessionsStore,
  type SessionMessagesStore,
  type SessionRunsStore,
  type Session,
  type SessionMessage,
  type SessionRun,
  type MessageRole as DbMessageRole,
  type FinishReason as DbFinishReason,
} from '@openaidy/db';
import type { SessionType } from '@openaidy/shared-types';
import {
  findSessionRecord,
  createSessionRecord,
  listSessionRecords,
  updateSessionTitleRecord,
  appendMessageRecord,
  listSessionMessageRecords,
  createRunRecord,
  markRunRunning,
  markRunSucceeded,
  markRunFailed,
  listSessionRunRecords,
  deleteSessionRecord,
} from './store';
import type {
  SubmitMessageInput,
  SubmitMessageStreamingInput,
  SubmitMessageResult,
  SessionMessageServiceOptions,
} from './types';
import { buildSystemPrompt } from '../prompts/build-system-prompt';
import type { AgentPersonalityService } from '../agents/personality-service';
import type {
  WorkspacePermissionsInfo,
  AppendMessageInput,
  SessionMessageRecord,
  SessionRunRecord,
  SessionRecord,
  FinishReason,
} from '../types';
import type { RunEventEmitter } from '../dispatch/events';

/**
 * Session message service
 *
 * Orchestrates the message submission flow:
 * 1. Validate session exists
 * 2. Persist user message
 * 3. Create run record
 * 4. Invoke provider
 * 5. Persist assistant message
 * 6. Update run with result
 *
 * Supports both in-memory (for testing) and DB-backed persistence.
 */
export class SessionMessageService {
  private readonly providers: ProviderServices;
  private readonly logger: FastifyBaseLogger | undefined;
  private readonly agents: AgentRegistry | undefined;
  private readonly mcp: McpClientService | undefined;
  private readonly workspace: WorkspaceService | undefined;
  private readonly builtinTools: BuiltinToolRegistry | undefined;
  private readonly getDefaultAgentId: (() => string | undefined) | undefined;
  private readonly sessionsRepo: SessionsStore | undefined;
  private readonly messagesRepo: SessionMessagesStore | undefined;
  private readonly runsRepo: SessionRunsStore | undefined;
  private readonly skillRegistry: import('../skills').SkillRegistry | undefined;
  private readonly personalityService: AgentPersonalityService | undefined;
  private readonly runEvents: RunEventEmitter | undefined;
  private readonly workspaceBaseDir: string | undefined;
  // In-memory counter for ONBOARDING messages per session
  // Key: sessionId, Value: remaining count (2 = first message + first response)
  private readonly onboardingCounter = new Map<string, number>();

  constructor(options: SessionMessageServiceOptions) {
    this.providers = options.providers;
    this.logger = options.logger;
    this.agents = options.agents;
    this.mcp = options.mcp;
    this.workspace = options.workspace;
    this.builtinTools = options.builtinTools;
    this.getDefaultAgentId = options.getDefaultAgentId;
    this.skillRegistry = options.skills;
    this.personalityService = options.personality;
    this.runEvents = options.runEvents;
    this.workspaceBaseDir = options.workspaceBaseDir;

    if (options.repositories) {
      this.sessionsRepo = options.repositories.sessions;
      this.messagesRepo = options.repositories.messages;
      this.runsRepo = options.repositories.runs;
    }
  }

  /**
   * Check if using DB-backed storage
   */
  get isDbBacked(): boolean {
    return !!this.sessionsRepo;
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionRecord[] | Session[]> {
    if (this.sessionsRepo) {
      return this.sessionsRepo.list('active');
    }
    return listSessionRecords();
  }

  /**
   * Get a session by ID
   */
  async getSession(id: string): Promise<SessionRecord | Session | null> {
    if (this.sessionsRepo) {
      return this.sessionsRepo.findById(id);
    }
    return findSessionRecord(id) ?? null;
  }

  /**
   * Create a new session
   */
  async createSession(
    title: string,
    type?: SessionType,
  ): Promise<SessionRecord | Session> {
    if (this.sessionsRepo) {
      return this.sessionsRepo.create({
        title,
        ...(type !== undefined && { type: type as SessionType }),
      });
    }
    return createSessionRecord(title, type);
  }

  /**
   * Update a session's title
   */
  async updateSessionTitle(
    id: string,
    title: string,
  ): Promise<SessionRecord | Session | null> {
    if (this.sessionsRepo) {
      return this.sessionsRepo.updateTitle(id, title);
    }
    return updateSessionTitleRecord(id, title) ?? null;
  }

  /**
   * Update a session's agentId (set to the agent of the latest run)
   */
  async updateSessionAgentId(
    id: string,
    agentId: string,
  ): Promise<SessionRecord | Session | null> {
    if (this.sessionsRepo) {
      return this.sessionsRepo.updateAgentId(id, agentId);
    }
    // In-memory store doesn't persist agentId - just return the session
    return (await this.getSession(id)) ?? null;
  }

  /**
   * Generate a short title for a session from the first user message.
   *
   * Makes a single non-streaming provider call with max 12 tokens.
   * Returns null if generation fails — callers should degrade gracefully.
   */
  async generateTitle(
    userMessage: string,
    providerId: string,
    modelId: string,
  ): Promise<string | null> {
    try {
      const result = await this.providers.invocation.invoke(
        {
          model: modelId,
          maxTokens: 300,
          messages: [
            {
              role: 'system',
              content:
                'You generate ultra-short conversation titles. ' +
                'Respond with ONLY valid JSON in this exact format: {"title":"3-6 word title here"} ' +
                'Keep any reasoning very brief. No other text outside the JSON.',
            },
            {
              role: 'user',
              content: `Generate a title for: "${userMessage.slice(0, 300)}"`,
            },
          ],
        },
        { providerId },
      );

      if (!result.ok) {
        this.logger?.error(
          { error: result.error },
          '[generateTitle] provider error',
        );
        return null;
      }

      const raw = result.value.content;

      // Extract JSON object from the response — handles reasoning text before/after
      const jsonMatch = raw.match(
        /\{[\s\S]*?"title"\s*:\s*"([^"]+)"[\s\S]*?\}/,
      );
      if (!jsonMatch?.[1]) {
        this.logger?.error(
          { raw },
          `[generateTitle] no JSON title found in response ${raw}`,
        );
        return null;
      }

      const title = jsonMatch[1].trim();
      return title || null;
    } catch (err) {
      this.logger?.error({ err }, '[generateTitle] threw');
      return null;
    }
  }

  /**
   * Delete a session
   *
   * Performs a soft delete by setting status to 'deleted' (when using DB repo),
   * or removes from in-memory store.
   *
   * @returns true if session was deleted, false if not found
   */
  async deleteSession(id: string): Promise<boolean> {
    // Check if session exists first
    const session = await this.getSession(id);
    if (!session) {
      return false;
    }

    if (this.sessionsRepo) {
      const result = await this.sessionsRepo.delete(id);
      return result !== null;
    }

    // In-memory store: actually remove the session (and its messages/runs).
    return deleteSessionRecord(id);
  }

  /**
   * Search sessions by title or message content using FTS5.
   * Falls back to in-memory filtering if DB is not available.
   */
  async searchSessions(
    query: string,
    options?: { limit?: number; currentSessionId?: string },
  ): Promise<
    Array<{
      id: string;
      title: string;
      status: string;
      createdAt: string;
      updatedAt?: string;
      archivedAt?: string;
      matchType: 'title' | 'content';
      rank: number;
      matchCount?: number;
      snippet?: string;
    }>
  > {
    const limit = options?.limit ?? 10;

    if (this.sessionsRepo) {
      const byTitle = await this.sessionsRepo.searchByTitle(
        query,
        limit,
        options?.currentSessionId,
      );

      let sessions = byTitle;
      if (sessions.length === 0) {
        sessions = await this.sessionsRepo.searchByContent(
          query,
          limit,
          options?.currentSessionId,
        );
      }

      return sessions.map((s) => {
        const base = {
          id: s.id,
          title: s.title,
          status: s.status,
          createdAt:
            s.createdAt instanceof Date
              ? s.createdAt.toISOString()
              : s.createdAt,
          matchType: s.matchType,
          rank: s.rank,
        };
        const optionals: Record<string, string | number | undefined> = {};
        if (s.updatedAt) {
          optionals.updatedAt =
            s.updatedAt instanceof Date
              ? s.updatedAt.toISOString()
              : s.updatedAt;
        }
        if (s.archivedAt) {
          optionals.archivedAt =
            s.archivedAt instanceof Date
              ? s.archivedAt.toISOString()
              : s.archivedAt;
        }
        if (s.matchCount !== undefined) optionals.matchCount = s.matchCount;
        if (s.snippet) optionals.snippet = s.snippet;
        return Object.assign({}, base, optionals);
      });
    }

    // In-memory fallback: filter by title substring (no ranking)
    // Cast to the shape we know the in-memory store returns
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = (await this.listSessions()) as any[];
    const normalized = query.toLowerCase();
    return records
      .filter(
        (s) =>
          s.title?.toLowerCase().includes(normalized) &&
          s.id !== options?.currentSessionId,
      )
      .slice(0, limit)
      .map((s, i) => {
        const result: {
          id: string;
          title: string;
          status: string;
          createdAt: string;
          matchType: 'title';
          rank: number;
          updatedAt?: string;
          archivedAt?: string;
        } = {
          id: s.id as string,
          title: s.title as string,
          status: String(s.status ?? 'active'),
          createdAt: String(
            s.createdAt instanceof Date
              ? s.createdAt.toISOString()
              : s.createdAt,
          ),
          matchType: 'title',
          rank: i,
        };
        if (s.updatedAt) {
          result.updatedAt = String(
            s.updatedAt instanceof Date
              ? s.updatedAt.toISOString()
              : s.updatedAt,
          );
        }
        return result;
      });
  }

  /**
   * List messages for a session
   */
  async listMessages(
    sessionId: string,
  ): Promise<SessionMessageRecord[] | SessionMessage[]> {
    if (this.messagesRepo) {
      return this.messagesRepo.listBySession(sessionId);
    }
    return listSessionMessageRecords(sessionId);
  }

  /**
   * List runs for a session
   */
  async listRuns(
    sessionId: string,
  ): Promise<SessionRunRecord[] | SessionRun[]> {
    if (this.runsRepo) {
      return this.runsRepo.listBySession(sessionId);
    }
    return listSessionRunRecords(sessionId);
  }

  /**
   * Submit a message to a session (non-streaming, legacy path)
   *
   * @deprecated Prefer submitMessageStreaming for all new callers. This method
   * does not support the tool-call loop, so agents with native tools (e.g.
   * web_fetch) will not be able to use them. Only use this as a fallback when
   * the provider does not support streaming.
   *
   * This orchestrates the full flow:
   * 1. Validate session exists
   * 2. Persist user message
   3. Create run record (queued)
   * 4. Mark run as running
   * 5. Build request from session history + new message
   * 6. Invoke provider
   * 7. Persist assistant message
   * 8. Update run with success/failure
   */
  async submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    // 1. Validate session exists
    const session = await this.getSession(input.sessionId);
    if (!session) {
      return {
        ok: false,
        error: {
          code: 'session.not_found',
          message: `Session "${input.sessionId}" not found`,
        },
      };
    }

    // 2. Persist user message
    const isFirstMessage =
      (await this.listMessages(input.sessionId)).length === 0;
    const userMessage = await this.appendMessage({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
    });

    // 3. Create run record (starts in 'queued' status)
    // Resolve agent: input.agentId > session.agentId > system default
    const configuredDefaultAgentId = this.getDefaultAgentId?.();
    const resolvedAgentId =
      input.agentId ??
      (session as { agentId?: string }).agentId ??
      configuredDefaultAgentId;
    const agent = resolvedAgentId
      ? this.agents?.getAgent(resolvedAgentId)
      : undefined;
    const defaultProviderConfig = this.providers.registry.getDefault();
    // Parse agent model string if available
    const agentModelParts = agent?.model ? agent.model.split('/') : null;
    const agentProviderId = agentModelParts?.[0];
    const agentModelId = agentModelParts?.[1];

    const providerEntry = input.providerId
      ? this.providers.registry.getEntry(input.providerId)
      : agentProviderId
        ? this.providers.registry.getEntry(agentProviderId)
        : defaultProviderConfig
          ? this.providers.registry.getEntry(defaultProviderConfig.providerId)
          : undefined;
    const providerId =
      input.providerId ??
      agentProviderId ??
      defaultProviderConfig?.providerId ??
      providerEntry?.provider.descriptor.id ??
      'default';
    const modelId =
      input.modelId ??
      agentModelId ??
      (providerId === defaultProviderConfig?.providerId && defaultProviderConfig
        ? defaultProviderConfig.modelId
        : undefined) ??
      providerEntry?.defaultModel ??
      'default';
    const agentId = resolvedAgentId ?? 'default';

    const run = await this.createRun({
      sessionId: input.sessionId,
      agentId,
      providerId,
      modelId,
    });

    // 4. Mark run as running
    await this.markRunRunning(run.id);

    // 5. Build request from session history + new message
    const history = await this.listMessages(input.sessionId);
    const historyMessages: Message[] = history.map((m) => {
      // Map to proper Message type - both types have these properties
      const msgRole = (m as { role: string }).role;
      const msgContent = (m as { content: string }).content;
      const msgToolCallId = (m as { toolCallId?: string }).toolCallId;

      if (msgRole === 'tool') {
        return {
          role: 'tool' as const,
          content: msgContent,
          toolCallId: msgToolCallId ?? '',
        };
      }
      return {
        role: msgRole as 'system' | 'user' | 'assistant',
        content: msgContent,
      } as Message;
    });

    // Build system prompt with personality files and skill bodies injected
    const systemPrompt = await buildSystemPrompt({
      agentId,
      basePrompt: agent?.systemPrompt ?? '',
      ...(agent?.skills ? { skillIds: agent.skills } : {}),
      personalityService: this.personalityService,
      skillRegistry: this.skillRegistry,
      isFirstMessage,
      userMessage: input.content,
      providers: this.providers,
      workspaceBaseDir: this.workspaceBaseDir,
      sessionType: (session as { type?: string }).type as
        | SessionType
        | undefined,
    });
    const messages: Message[] = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...historyMessages]
      : historyMessages;

    // 6. Invoke provider
    const modelRequest: ModelRequest = {
      model: modelId,
      messages,
    };

    // Build invocation options: client overrides take priority, then agent-resolved values
    const invokeOptions = {
      providerId: input.providerId ?? providerId,
      modelId: input.modelId ?? modelId,
    };

    const result = await this.providers.invocation.invoke(
      modelRequest,
      invokeOptions,
    );

    // 7 & 8. Handle result
    if (result.ok) {
      return this.handleSuccess(
        run,
        input.sessionId,
        userMessage,
        result.value,
      );
    } else {
      return this.handleFailure(
        run.id,
        userMessage,
        result.error.code,
        result.error.message,
      );
    }
  }

  /**
   * Non-streaming submitMessage that returns the full assistant reply text.
   * Used by channel handlers (WhatsApp, etc.) that need the complete response
   * before sending it back over the messaging protocol.
   *
   * NOTE: This method uses submitMessageStreaming internally (with a no-op
   * onStreamEvent callback) so the full tool-call loop runs — WhatsApp channels
   * CAN use builtin/MCP tools. This differs from the deprecated submitMessage()
   * which skips the tool-call loop entirely.
   *
   * Returns { ok: true, assistantMessage: { content: string } } or
   *        { ok: false, error: { code, message } }
   */
  async submitMessageNonStreaming(params: {
    sessionId: string;
    role: 'user' | 'system';
    content: string;
    agentId?: string;
    providerId?: string;
    modelId?: string;
  }): Promise<
    | { ok: true; assistantMessage: { content: string } }
    | { ok: false; error: { code: string; message: string } }
  > {
    const streamingInput: SubmitMessageStreamingInput = {
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      onStreamEvent: () => {
        // no-op — channel handlers don't need stream events
      },
    };
    if (params.agentId !== undefined) streamingInput.agentId = params.agentId;
    if (params.providerId !== undefined)
      streamingInput.providerId = params.providerId;
    if (params.modelId !== undefined) streamingInput.modelId = params.modelId;

    const result = await this.submitMessageStreaming(streamingInput);

    if (result.ok) {
      // Extract content from assistantMessage (which may be a full object with content)
      const content =
        (result as { ok: true; assistantMessage: { content: string } })
          .assistantMessage?.content ?? '';
      return { ok: true, assistantMessage: { content } };
    } else {
      const err = (
        result as { ok: false; error: { code: string; message: string } }
      ).error;
      return { ok: false, error: err };
    }
  }

  /**
   * Dispatch an agent to a session.
   *
   * Single shared entry point used by both addon proxies and agent tools.
   * Handles agent validation, session creation/reuse, and fires
   * submitMessageStreaming in the background.
   *
   * Returns the sessionId immediately plus a done promise so callers can
   * choose to await the result (addon proxy, synchronous) or fire-and-forget
   * (agent tool, asynchronous).
   */
  async dispatchAgent(params: {
    agentId: string;
    content: string;
    sessionId?: string;
    sessionTitle?: string;
  }): Promise<
    | {
        ok: true;
        sessionId: string;
        done: Promise<SubmitMessageResult>;
      }
    | { ok: false; error: string }
  > {
    const agentId = params.agentId.trim();
    const content = params.content.trim();

    if (!agentId) {
      return { ok: false, error: 'agentId is required' };
    }
    if (!content) {
      return { ok: false, error: 'content is required' };
    }

    if (this.agents) {
      const agent = this.agents.getAgent(agentId);
      if (!agent) {
        return {
          ok: false,
          error: `Agent "${agentId}" not found.`,
        };
      }
      if (!agent.enabled) {
        return {
          ok: false,
          error: `Agent "${agentId}" is disabled.`,
        };
      }
    }

    try {
      let sessionId: string;
      if (params.sessionId) {
        const existing = await this.getSession(params.sessionId);
        if (!existing) {
          return {
            ok: false,
            error: `Session "${params.sessionId}" not found.`,
          };
        }
        sessionId = params.sessionId;
      } else {
        const titlePrefix = content.slice(0, 80);
        const title =
          params.sessionTitle ??
          `[agent:${agentId}] ${titlePrefix}${content.length > 80 ? '...' : ''}`;
        const session = await this.createSession(title);
        sessionId = session.id;
      }

      const done = this.submitMessageStreaming({
        sessionId,
        role: 'user',
        content,
        agentId,
        onStreamEvent: () => {},
      });

      return { ok: true, sessionId, done };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Submit a message with streaming response
   *
   * Similar to submitMessage but yields content as it arrives via the callback.
   * Returns the final result once streaming is complete.
   */
  async submitMessageStreaming(
    input: SubmitMessageStreamingInput,
  ): Promise<SubmitMessageResult> {
    const { onStreamEvent } = input;

    // 1. Validate session exists
    const session = await this.getSession(input.sessionId);
    if (!session) {
      return {
        ok: false,
        error: {
          code: 'session.not_found',
          message: `Session "${input.sessionId}" not found`,
        },
      };
    }

    // 2. Persist user message
    const isFirstMessage =
      (await this.listMessages(input.sessionId)).length === 0;
    const userMessage = await this.appendMessage({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
    });

    // 3. Create run record
    // Track how many more messages should receive ONBOARDING.
    // Starts at 2 (first message + first user response).
    // Decremented each message, stops at 0.
    if (isFirstMessage) {
      this.onboardingCounter.set(input.sessionId, 5);
    }
    const onboardingMessagesRemaining =
      this.onboardingCounter.get(input.sessionId) ?? 0;
    if (onboardingMessagesRemaining > 0) {
      this.onboardingCounter.set(
        input.sessionId,
        onboardingMessagesRemaining - 1,
      );
    } else {
      this.onboardingCounter.delete(input.sessionId);
    }

    // Resolve agent: input.agentId > session.agentId > system default
    const configuredDefaultAgentId = this.getDefaultAgentId?.();
    const resolvedAgentId =
      input.agentId ??
      (session as { agentId?: string }).agentId ??
      configuredDefaultAgentId;
    const agent = resolvedAgentId
      ? this.agents?.getAgent(resolvedAgentId)
      : undefined;
    const defaultProviderConfig = this.providers.registry.getDefault();
    const agentModelParts = agent?.model ? agent.model.split('/') : null;
    const agentProviderId = agentModelParts?.[0];
    const agentModelId = agentModelParts?.[1];

    const providerEntry = input.providerId
      ? this.providers.registry.getEntry(input.providerId)
      : agentProviderId
        ? this.providers.registry.getEntry(agentProviderId)
        : defaultProviderConfig
          ? this.providers.registry.getEntry(defaultProviderConfig.providerId)
          : undefined;
    const providerId =
      input.providerId ??
      agentProviderId ??
      defaultProviderConfig?.providerId ??
      providerEntry?.provider.descriptor.id ??
      'default';
    const modelId =
      input.modelId ??
      agentModelId ??
      (providerId === defaultProviderConfig?.providerId && defaultProviderConfig
        ? defaultProviderConfig.modelId
        : undefined) ??
      providerEntry?.defaultModel ??
      'default';
    const agentId = resolvedAgentId ?? 'default';

    const run = await this.createRun({
      sessionId: input.sessionId,
      agentId,
      providerId,
      modelId,
    });

    // 4. Mark run as running
    await this.markRunRunning(run.id);

    // 5. Build request from session history + new message
    const history = await this.listMessages(input.sessionId);
    const historyMessages: Message[] = history.map((m) => {
      const msgRole = (m as { role: string }).role;
      const msgContent = (m as { content: string }).content;
      const msgToolCallId = (m as { toolCallId?: string }).toolCallId;
      const msgMetadata = (m as { metadata?: Record<string, unknown> })
        .metadata;

      if (msgRole === 'tool') {
        return {
          role: 'tool' as const,
          content: msgContent,
          toolCallId: msgToolCallId ?? '',
        };
      }
      if (msgRole === 'assistant') {
        // The DB row's `metadata.toolCalls` is an untyped JSON blob;
        // cast it to the canonical `readonly ToolCallRequest[]`
        // shape. The `thoughtSignature` field (Gemini-specific)
        // rides along on the same object and is consumed by the
        // gemini request mapper when serializing the next turn.
        const storedToolCalls = msgMetadata?.['toolCalls'] as
          | readonly ToolCallRequest[]
          | undefined;
        const msgReasoningContent = m.reasoningContent ?? undefined;
        return {
          role: 'assistant' as const,
          content: msgContent,
          ...(storedToolCalls?.length ? { toolCalls: storedToolCalls } : {}),
          ...(msgReasoningContent
            ? { reasoningContent: msgReasoningContent }
            : {}),
        } as Message;
      }
      return {
        role: msgRole as 'system' | 'user',
        content: msgContent,
      } as Message;
    });

    // 5. Build tool definitions (needed for system prompt and invocation)
    const mcpTools = this.buildMcpTools(agentId);
    const nativeToolDefs = this.buildNativeToolDefinitions(agentId);
    // All tool definitions sent to the model (MCP + builtin, merged)
    const allTools: ToolDefinition[] = [...mcpTools, ...nativeToolDefs];

    // Extract workspace permissions from agent config for honest reporting
    const workspacePermissions: WorkspacePermissionsInfo | undefined = agent
      ?.workspace?.enabled
      ? {
          read:
            agent.workspace.defaultPermissions?.read ??
            agent.workspace.workspaces?.some(
              (w) => w.permissions?.read !== false,
            ) ??
            true,
          write:
            agent.workspace.defaultPermissions?.write ??
            agent.workspace.workspaces?.some(
              (w) => w.permissions?.write === true,
            ) ??
            false,
          delete:
            agent.workspace.defaultPermissions?.delete ??
            agent.workspace.workspaces?.some(
              (w) => w.permissions?.delete === true,
            ) ??
            false,
          list:
            agent.workspace.defaultPermissions?.list ??
            agent.workspace.workspaces?.some(
              (w) => w.permissions?.list !== false,
            ) ??
            true,
        }
      : undefined;

    // Build system prompt with personality files, skill bodies, and tool guidelines injected
    const systemPrompt = await buildSystemPrompt({
      agentId,
      basePrompt: agent?.systemPrompt ?? '',
      ...(agent?.skills && { skillIds: agent.skills }),
      personalityService: this.personalityService,
      skillRegistry: this.skillRegistry,
      isFirstMessage,
      userMessage: input.content,
      providers: this.providers,
      tools: allTools,
      workspacePermissions,
      workspaceBaseDir: this.workspaceBaseDir,
      sessionType: (session as { type?: string }).type as
        | SessionType
        | undefined,
      onboardingMessagesRemaining,
    });

    const messages: Message[] = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...historyMessages]
      : historyMessages;

    // 6. Invoke provider with streaming (agentic tool-call loop)
    // Build invocation options: client overrides take priority, then agent-resolved values
    const invokeOptions = {
      providerId: input.providerId ?? providerId,
      modelId: input.modelId ?? modelId,
    };

    let accumulatedContent = '';
    let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finalFinishReason: string | undefined;
    let finalReasoningContent: string | undefined;
    let finalProviderId = providerId;
    let finalModelId = modelId;

    // Running message history for the tool-call loop
    const loopMessages: Message[] = [...messages];

    // Debug: log full system prompt length and first 500 chars
    const sysPromptMsg = messages.find((m) => m.role === 'system');
    this.logger?.info(
      {
        sessionId: input.sessionId,
        systemPromptLength: sysPromptMsg?.content.length ?? 0,
      },
      'Building messages for streaming',
    );

    try {
      const MAX_TOOL_ROUNDS = 10;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const modelRequest: ModelRequest = {
          model: modelId,
          messages: loopMessages,
          ...(allTools.length > 0 && { tools: allTools, toolChoice: 'auto' }),
        };

        // Local accumulator for the tool calls the model
        // returned this turn. The shape is a `Pick` of the
        // canonical `ToolCallRequest` so the `thoughtSignature`
        // (Gemini-specific) and any other future fields ride
        // along automatically — no inline duplication. Note
        // that `arguments` here is an object (the JSON is
        // stringified later by `mappedToolCalls`); we override
        // the type to reflect the in-loop reality rather than
        // the stringified `ToolCallRequest.arguments` shape.
        type LocalToolCall = Pick<
          ToolCallRequest,
          'id' | 'name' | 'thoughtSignature'
        > & { arguments: Record<string, unknown> };
        const toolCalls: LocalToolCall[] = [];
        let hasError = false;
        let errorCode = '';
        let errorMessage = '';
        accumulatedContent = '';

        const stream = this.providers.invocation.invokeStream(
          modelRequest,
          invokeOptions,
        );

        for await (const event of stream) {
          if (!event.ok) {
            hasError = true;
            errorCode = event.error.code;
            errorMessage = event.error.message;
            onStreamEvent({
              type: 'error',
              error: { code: event.error.code, message: event.error.message },
            });
            break;
          }

          const value = event.value;
          switch (value.type) {
            case 'stream.content_delta': {
              accumulatedContent += value.delta;
              onStreamEvent({ type: 'delta', content: value.delta });
              break;
            }
            case 'stream.tool_call': {
              const toolArgs =
                typeof value.toolCall.arguments === 'string'
                  ? JSON.parse(value.toolCall.arguments)
                  : value.toolCall.arguments;
              toolCalls.push({
                id: value.toolCall.id,
                name: value.toolCall.name,
                arguments: toolArgs as Record<string, unknown>,
              });
              onStreamEvent({
                type: 'tool_call',
                toolCall: {
                  id: value.toolCall.id,
                  name: value.toolCall.name,
                  arguments: toolArgs as Record<string, unknown>,
                },
              });
              break;
            }
            case 'stream.usage': {
              finalUsage = {
                promptTokens: value.usage.promptTokens,
                completionTokens: value.usage.completionTokens,
                totalTokens: value.usage.totalTokens,
              };
              onStreamEvent({ type: 'usage', usage: finalUsage });
              break;
            }
            case 'stream.started': {
              if (value.providerId) finalProviderId = value.providerId;
              if (value.model) finalModelId = value.model;
              break;
            }
            case 'stream.finished': {
              finalFinishReason = value.finishReason;
              if (value.reasoningContent)
                finalReasoningContent = value.reasoningContent;
              break;
            }
          }
        }

        if (hasError) {
          return this.handleFailure(
            run.id,
            userMessage,
            errorCode,
            errorMessage,
          );
        }

        // If the model made tool calls, execute them and continue the loop
        if (toolCalls.length > 0 && (this.mcp || this.builtinTools)) {
          const mappedToolCalls = toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
            // Gemini-specific thought signature; the gemini
            // request mapper reads it back when serializing the
            // assistant turn for the next request. Required by
            // the Gemini API on the first functionCall part of
            // a multi-call turn — see
            // https://ai.google.dev/gemini-api/docs/thought-signatures.
            ...(tc.thoughtSignature
              ? { thoughtSignature: tc.thoughtSignature }
              : {}),
          }));

          // Extract consulted skills from workspace_read/workspace_list calls
          const consultedSkills: string[] = [];
          for (const tc of mappedToolCalls) {
            if (tc.name === 'workspace_read' || tc.name === 'workspace_list') {
              try {
                const args = JSON.parse(tc.arguments) as { path?: string };
                const path = args.path ?? '';
                const match = path.match(/skills\/([^/]+)/);
                if (match && match[1]) {
                  consultedSkills.push(match[1]);
                }
              } catch {
                // Invalid JSON arguments, skip
              }
            }
          }

          // Persist the assistant tool-call turn so history can be fully
          // reconstructed on subsequent requests in this session.
          await this.appendMessage({
            sessionId: input.sessionId,
            runId: run.id,
            role: 'assistant',
            content: accumulatedContent || '',
            ...(finalReasoningContent
              ? { reasoningContent: finalReasoningContent }
              : {}),
            metadata: {
              toolCalls: mappedToolCalls,
              ...(consultedSkills.length > 0 && { consultedSkills }),
            },
          });

          // Append to in-process loop history with toolCalls for this round.
          loopMessages.push({
            role: 'assistant',
            content: accumulatedContent || '',
            toolCalls: mappedToolCalls,
            ...(finalReasoningContent
              ? { reasoningContent: finalReasoningContent }
              : {}),
          } as Message);

          for (const tc of toolCalls) {
            let toolContent: string | undefined;
            let toolIsError = false;
            let absolutePathFromTool: string | undefined;

            // Route to builtin (native) tool only if it exists in the registry
            // AND is still enabled for this agent (tools list may have changed mid-session).
            const enabledTools = this.agents?.getAgent(agentId)?.tools ?? [];
            const builtinTool = enabledTools.includes(tc.name)
              ? this.builtinTools?.get(tc.name)
              : undefined;
            if (builtinTool) {
              const builtinResult = await builtinTool
                .execute(tc.arguments, { agentId, sessionId: input.sessionId })
                .catch((e: unknown) => ({
                  ok: false as const,
                  error: `Tool error: ${e instanceof Error ? e.message : String(e)}`,
                }));

              // Check for INTERRUPT_CHOICES sentinel from present_choices tool
              if (builtinResult.ok) {
                try {
                  const parsed = JSON.parse(builtinResult.content);
                  if (parsed._type === 'INTERRUPT_CHOICES') {
                    // Emit choices event and stop the agentic loop
                    onStreamEvent({
                      type: 'choices',
                      question: parsed.question ?? undefined,
                      choices: parsed.choices as string[],
                    });
                    // Mark the run as suspended (awaiting user input)
                    await this.markRunSucceeded(run, {
                      finishReason: 'stop',
                      promptTokens: finalUsage.promptTokens,
                      completionTokens: finalUsage.completionTokens,
                      totalTokens: finalUsage.totalTokens,
                      metadata: {
                        providerId: finalProviderId,
                        model: finalModelId,
                        suspended: true,
                        choicesQuestion: parsed.question ?? null,
                        choicesCount: (parsed.choices as string[]).length,
                      },
                    }).catch(() => {});
                    return {
                      ok: true,
                      userMessage,
                      assistantMessage: undefined as unknown as never,
                      run,
                    };
                  }
                } catch {
                  // Not INTERRUPT_CHOICES JSON — fall through to normal handling
                }
              }

              if (!builtinResult.ok) {
                // Store the error message (not raw HTML) for failed tool calls
                // This ensures all tool calls are persisted and shown in the UI
                const errorMessage = `Error: ${builtinResult.error}`;
                toolContent = errorMessage; // Persist error message instead of raw content
                toolIsError = true;
              } else {
                toolContent = builtinResult.content;
                // workspace_write returns absolutePath but the BuiltinTool type
                // doesn't expose it, so we need to cast to access it
                const resultWithPath = builtinResult as {
                  ok: true;
                  content: string;
                  absolutePath?: string;
                };
                if (resultWithPath.absolutePath) {
                  absolutePathFromTool = resultWithPath.absolutePath;
                }
              }
            } else {
              // Fall back to MCP tool
              const mcpServerId = tc.name.split('::')[0]!;
              const mcpToolName = tc.name.split('::')[1] ?? tc.name;

              // Screenshot tools save images to a directory chosen at the
              // server's launch — not per-agent. Strip `filename` so the
              // server returns the image inline, then we persist those bytes
              // into this agent's workspace `screenshots/` folder below.
              const captureScreenshot =
                !!this.workspace && isScreenshotTool(mcpToolName);
              const { forwardedArgs, requestedFilename } = captureScreenshot
                ? stripScreenshotFilename(tc.arguments)
                : { forwardedArgs: tc.arguments, requestedFilename: undefined };

              let mcpResult = await this.mcp
                ?.callTool(mcpServerId, mcpToolName, forwardedArgs)
                .catch((e: unknown) => {
                  toolIsError = true;
                  return {
                    content: [
                      {
                        type: 'text',
                        text: `Error: ${e instanceof Error ? e.message : String(e)}`,
                      },
                    ],
                  };
                });

              // Persist any inline screenshot image into the agent workspace.
              // Best-effort: a failure here must not fail the tool call.
              if (
                captureScreenshot &&
                this.workspace &&
                mcpResult &&
                !toolIsError
              ) {
                try {
                  const persisted = await persistScreenshotImages({
                    result: mcpResult as McpToolResult,
                    workspace: this.workspace,
                    agentId,
                    requestedFilename,
                    logger: this.logger,
                  });
                  mcpResult = persisted.result;
                } catch (e) {
                  this.logger?.warn(
                    {
                      agentId,
                      tool: mcpToolName,
                      error: e instanceof Error ? e.message : String(e),
                    },
                    'Failed to persist screenshot to workspace',
                  );
                }
              }
              const mcpText = Array.isArray(
                (mcpResult as { content?: unknown[] } | undefined)?.content,
              )
                ? (mcpResult as { content: Array<{ text?: string }> }).content
                    .map((c) => c.text ?? '')
                    .join('')
                : JSON.stringify(mcpResult ?? { error: 'MCP not available' });
              // MCP responses can also surface errors via `isError: true`
              // on the result object itself (per MCP spec) — honor that
              // so the gemini mapper wraps the content as an error.
              if (
                !toolIsError &&
                mcpResult &&
                typeof mcpResult === 'object' &&
                (mcpResult as { isError?: unknown }).isError === true
              ) {
                toolIsError = true;
              }
              toolContent = mcpText;
              // Try to extract absolutePath from MCP result if present
              if (mcpResult && typeof mcpResult === 'object') {
                const mcpResultObj = mcpResult as {
                  content?: unknown[];
                  absolutePath?: string;
                };
                if (mcpResultObj.absolutePath) {
                  absolutePathFromTool = mcpResultObj.absolutePath;
                }
              }
            }

            // Only persist tool result if we have content
            if (toolContent !== undefined) {
              // Extract absolutePath from tool result if present (for workspace_write etc.)
              const toolMetadata: Record<string, unknown> = {
                toolName: tc.name,
                ...(toolIsError ? { isError: true } : {}),
              };
              if (absolutePathFromTool) {
                toolMetadata.absolutePath = absolutePathFromTool;
              }
              // Persist tool result message
              await this.appendMessage({
                sessionId: input.sessionId,
                runId: run.id,
                role: 'tool',
                content: toolContent,
                toolCallId: tc.id,
                ...(toolIsError ? { isError: true } : {}),
                metadata: toolMetadata,
              });

              loopMessages.push({
                role: 'tool',
                content: toolContent,
                toolCallId: tc.id,
                ...(toolIsError ? { isError: true } : {}),
              } as Message);

              // If agent saved a personality file via workspace_write, stop onboarding
              if (tc.name === 'workspace_write') {
                const args = tc.arguments as { path?: string } | undefined;
                const path = args?.path;
                if (
                  path === 'AGENT.md' ||
                  path === 'USER.md' ||
                  path === 'MISSION.md' ||
                  path === 'RULES.md'
                ) {
                  this.logger?.info(
                    { sessionId: input.sessionId, file: path },
                    'Personality file saved - onboarding complete',
                  );
                  this.onboardingCounter.delete(input.sessionId);
                }
              }
            }
          }
          // Continue loop for next model turn
          continue;
        }

        // No tool calls — we're done
        break;
      }

      // 7. Persist assistant message with accumulated content
      const assistantMessage = await this.appendMessage({
        sessionId: input.sessionId,
        runId: run.id,
        role: 'assistant',
        content: accumulatedContent,
        ...(finalReasoningContent
          ? { reasoningContent: finalReasoningContent }
          : {}),
        metadata: {
          providerId: finalProviderId,
          model: finalModelId,
        },
      });

      // 8. Update run with success
      const updatedRun = await this.markRunSucceeded(run, {
        finishReason: (finalFinishReason as FinishReason) ?? 'stop',
        promptTokens: finalUsage.promptTokens,
        completionTokens: finalUsage.completionTokens,
        totalTokens: finalUsage.totalTokens,
        firstMessageId: assistantMessage.id,
        metadata: { providerId: finalProviderId, model: finalModelId },
      });

      // 9. Update session's agentId to reflect the agent that just ran
      // This allows the session to "remember" which agent was last used
      await this.updateSessionAgentId(input.sessionId, agentId);

      return { ok: true, userMessage, assistantMessage, run: updatedRun! };
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Streaming failed';
      return this.handleFailure(
        run.id,
        userMessage,
        'streaming_error',
        errorMsg,
      );
    }
  }

  /**
   * Build ToolDefinition[] from MCP servers configured for an agent.
   * Tool names are prefixed with serverId:: to avoid collisions.
   */
  private buildMcpTools(agentId: string): ToolDefinition[] {
    if (!this.mcp || !this.agents) return [];
    const agent = this.agents.getAgent(agentId);
    if (!agent?.mcpServers?.length) return [];

    const tools: ToolDefinition[] = [];
    for (const ref of agent.mcpServers) {
      if (!this.mcp.isConnected(ref.id)) continue;
      const serverTools = this.mcp.getFilteredTools(ref.id, ref.tools);
      for (const t of serverTools) {
        tools.push({
          name: `${ref.id}::${t.name}`,
          description: t.description ?? t.name,
          parameters: t.inputSchema as ToolDefinition['parameters'],
        });
      }
    }
    return tools;
  }

  /**
   * Build ToolDefinition[] (schema only, no executor) from the agent's
   * nativeTools list against the BuiltinToolRegistry.
   * These are completely separate from MCP tools.
   */
  private buildNativeToolDefinitions(agentId: string): ToolDefinition[] {
    if (!this.builtinTools || !this.agents) return [];
    const agent = this.agents.getAgent(agentId);
    if (!agent?.tools?.length) return [];
    return this.builtinTools.getDefinitions(agent.tools);
  }

  /**
   * Append a message to a session
   */
  private async appendMessage(
    input: AppendMessageInput,
  ): Promise<SessionMessageRecord | SessionMessage> {
    if (this.messagesRepo) {
      const result = await this.messagesRepo.append({
        sessionId: input.sessionId,
        role: input.role as DbMessageRole,
        content: input.content,
        ...(input.runId !== undefined && { runId: input.runId }),
        ...(input.toolCallId !== undefined && { toolCallId: input.toolCallId }),
        ...(input.reasoningContent !== undefined && {
          reasoningContent: input.reasoningContent,
        }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
      });
      return result;
    }
    return appendMessageRecord(input);
  }

  /**
   * Create a run record
   */
  private async createRun(input: {
    sessionId: string;
    agentId: string;
    providerId: string;
    modelId: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionRunRecord | SessionRun> {
    if (this.runsRepo) {
      return this.runsRepo.create(input);
    }
    return createRunRecord(input);
  }

  /**
   * Mark a run as running
   */
  private async markRunRunning(
    id: string,
  ): Promise<SessionRunRecord | SessionRun | null> {
    if (this.runsRepo) {
      return this.runsRepo.markRunning(id);
    }
    return markRunRunning(id) ?? null;
  }

  /**
   * Mark a run as succeeded
   */
  private async markRunSucceeded(
    run: SessionRunRecord | SessionRun,
    input: {
      finishReason: FinishReason;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      firstMessageId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<SessionRunRecord | SessionRun | null> {
    if (this.runsRepo) {
      const successInput: {
        finishReason: DbFinishReason;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
        firstMessageId?: string;
        metadata?: Record<string, unknown>;
      } = {
        finishReason: input.finishReason as DbFinishReason,
      };
      if (input.promptTokens !== undefined) {
        successInput.usage = {
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens ?? 0,
          totalTokens: input.totalTokens ?? 0,
        };
      }
      if (input.firstMessageId !== undefined) {
        successInput.firstMessageId = input.firstMessageId;
      }
      if (input.metadata !== undefined) {
        successInput.metadata = input.metadata;
      }
      const updated = await this.runsRepo.markSucceeded(run.id, successInput);
      // Emit run.completed event
      if (this.runEvents && updated) {
        const eventData: {
          runId: string;
          sessionId: string;
          agentId: string;
          finishReason: string;
          usage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
          };
        } = {
          runId: run.id,
          sessionId: run.sessionId,
          agentId: run.agentId,
          finishReason: input.finishReason,
        };
        if (input.promptTokens !== undefined) {
          eventData.usage = {
            promptTokens: input.promptTokens,
            completionTokens: input.completionTokens ?? 0,
            totalTokens: input.totalTokens ?? 0,
          };
        }
        this.runEvents.emitCompleted(eventData);
      }
      return updated;
    }
    const updated = markRunSucceeded(run.id, input);
    // Emit run.completed event for in-memory runs too
    if (this.runEvents && updated) {
      const eventData: {
        runId: string;
        sessionId: string;
        agentId: string;
        finishReason: string;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
      } = {
        runId: run.id,
        sessionId: run.sessionId,
        agentId: run.agentId,
        finishReason: input.finishReason,
      };
      if (input.promptTokens !== undefined) {
        eventData.usage = {
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens ?? 0,
          totalTokens: input.totalTokens ?? 0,
        };
      }
      this.runEvents.emitCompleted(eventData);
    }
    return updated ?? null;
  }

  /**
   * Mark a run as failed
   */
  private async markRunFailed(
    id: string,
    input: {
      errorCode: string;
      errorMessage: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<SessionRunRecord | SessionRun | null> {
    if (this.runsRepo) {
      return this.runsRepo.markFailed(id, input);
    }
    return markRunFailed(id, input) ?? null;
  }

  /**
   * Handle successful provider invocation
   */
  private async handleSuccess(
    run: SessionRunRecord | SessionRun,
    sessionId: string,
    userMessage: SessionMessageRecord | SessionMessage,
    response: ModelResponse,
  ): Promise<SubmitMessageResult> {
    // Persist assistant message
    const assistantMessage = await this.appendMessage({
      sessionId: sessionId,
      runId: run.id,
      role: 'assistant',
      content: response.content,
      metadata: {
        providerId: response.providerId,
        model: response.model,
      },
    });

    // Update run with success
    const updatedRun = await this.markRunSucceeded(run, {
      finishReason: response.finishReason as FinishReason,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      metadata: {
        providerId: response.providerId,
        model: response.model,
        responseId: response.id,
      },
    });

    // Update session's agentId to reflect the agent that just ran
    await this.updateSessionAgentId(sessionId, run.agentId);

    return {
      ok: true,
      userMessage,
      assistantMessage,
      run: updatedRun!,
    };
  }

  /**
   * Handle failed provider invocation
   */
  private async handleFailure(
    runId: string,
    userMessage: SessionMessageRecord | SessionMessage,
    errorCode: string,
    errorMessage: string,
  ): Promise<SubmitMessageResult> {
    // Update run with failure
    await this.markRunFailed(runId, {
      errorCode,
      errorMessage,
    });

    return {
      ok: false,
      error: {
        code: errorCode,
        message: errorMessage,
      },
    };
  }
}
