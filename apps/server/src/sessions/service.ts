import type { FastifyBaseLogger } from 'fastify';
import type { ProviderServices } from '../providers';
import type { AgentRegistry } from '../agents';
import type { McpClientService, McpToolResult } from '../mcp/client';
import type { WorkspaceService } from '../workspace/service';
import {
  isScreenshotTool,
  stripScreenshotFilename,
  persistScreenshotImages,
  extractInlineImages,
  MEDIA_WORKSPACE_DIR,
  type PersistedImage,
} from '../mcp/screenshot-capture';
import type { BuiltinToolRegistry } from '../tools';
import type { AttachmentService } from '../attachments/service';
import type {
  ToolDefinition,
  Message,
  MessageAttachment as RuntimeMessageAttachment,
  ModelRequest,
  ModelResponse,
  ToolCallRequest,
} from '@openaidy/runtime';
import type { MessageAttachment as DbMessageAttachment } from '@openaidy/db';
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
import type { SessionType, ModelPricing } from '@openaidy/shared-types';
import { estimateCost } from '@openaidy/shared-types';
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
  markRunCancelled,
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
  private readonly attachments: AttachmentService | undefined;
  private readonly modelPricing: Record<string, ModelPricing> | undefined;
  private readonly maxToolRounds: number;
  private readonly maxToolOutputChars: number;
  // In-memory counter for ONBOARDING messages per session
  // Key: sessionId, Value: remaining count (2 = first message + first response)
  private readonly onboardingCounter = new Map<string, number>();

  // In-flight tool AbortControllers so a user "Stop" can cancel a running tool
  // (issue #375). Key: `${runId}:${toolCallId}`.
  private readonly inflightTools = new Map<string, AbortController>();

  // In-flight run-level AbortControllers so a user "Stop agent" can abort the
  // whole turn — the provider stream and any running tools (issue #376).
  // Key: runId (the WS-level run id the client addresses).
  private readonly inflightRuns = new Map<string, AbortController>();

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
    this.attachments = options.attachments;
    this.modelPricing = options.modelPricing;
    this.maxToolRounds = options.maxToolRounds ?? 25;
    this.maxToolOutputChars = options.maxToolOutputChars ?? 24_000;

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
   * Cancel an in-flight tool call (user hit Stop). Aborts the tool's
   * AbortSignal; the tool resolves with an error and the streaming loop
   * continues. Returns true if a matching in-flight tool was found.
   */
  cancelTool(runId: string, toolCallId: string): boolean {
    const controller = this.inflightTools.get(`${runId}:${toolCallId}`);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Cap the copy of a tool result that is fed back into the model context.
   *
   * A single oversized tool result (broad MCP search responses are the usual
   * culprit — builtin read/fetch already self-cap) can balloon the request to
   * the model's context limit, which degrades tool-calling and causes the run
   * to stall (see the agentic-loop round-exhaustion analysis). We truncate the
   * *context* copy only; the full result is still persisted to the DB so the
   * UI and history keep it intact. Cross-run history replay is trimmed
   * separately.
   */
  private capToolOutputForContext(content: string, toolName: string): string {
    const cap = this.maxToolOutputChars;
    if (content.length <= cap) return content;
    const omitted = content.length - cap;
    this.logger?.warn(
      { toolName, originalChars: content.length, cap },
      'Tool output exceeded context cap — truncated the copy sent to the model',
    );
    return (
      content.slice(0, cap) +
      `\n\n[Tool output truncated for context: showing ${cap} of ` +
      `${content.length} characters (${omitted} omitted). The full result is ` +
      `preserved in the transcript. If you need more, narrow the query, ` +
      `request a specific section/line range, or paginate.]`
    );
  }

  /**
   * Cancel an in-flight run (user hit "Stop agent"). Aborts the run-level
   * AbortSignal, which cancels the provider stream and any tool currently
   * running under this run. The streaming loop marks the run `cancelled` and
   * emits `run.cancelled` without persisting a final assistant message.
   * Returns true if a matching in-flight run was found.
   */
  cancelRun(runId: string): boolean {
    const controller = this.inflightRuns.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
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
   * List messages for a session.
   *
   * When attachment storage is configured, each message additionally
   * carries an `attachments` array (metadata only — no bytes) so both the
   * UI and the model-request builder know what media belongs to it.
   */
  async listMessages(
    sessionId: string,
  ): Promise<SessionMessageRecord[] | SessionMessage[]> {
    if (this.messagesRepo) {
      const messages = await this.messagesRepo.listBySession(sessionId);
      if (!this.attachments) return messages;
      const grouped = await this.attachments.listBySessionGrouped(sessionId);
      if (grouped.size === 0) return messages;
      return messages.map((m) => {
        const atts = grouped.get(m.id);
        return atts ? { ...m, attachments: atts } : m;
      }) as SessionMessage[];
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
   * Cumulative usage totals for a session (succeeded runs). Returns zeroed
   * totals when no DB-backed run store is configured.
   */
  async getSessionUsage(
    sessionId: string,
  ): Promise<import('@openaidy/db').SessionUsageTotals> {
    if (this.runsRepo) {
      return this.runsRepo.getSessionUsage(sessionId);
    }
    return {
      runCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cost: 0,
      hasCost: false,
    };
  }

  /**
   * Raw per-run usage rows (succeeded runs) for aggregation, optionally
   * filtered by an ISO created-at range. Empty when no DB store.
   */
  async listUsageRows(options?: {
    from?: string;
    to?: string;
  }): Promise<import('@openaidy/db').UsageRunRow[]> {
    if (this.runsRepo) {
      return this.runsRepo.listUsageRows(options ?? {});
    }
    return [];
  }

  /**
   * Per-session usage totals for every session with succeeded runs, in one
   * query. Used to show usage on the sessions list without an N+1 fan-out.
   * Empty when no DB store.
   */
  async getUsageBySession(): Promise<
    Array<import('@openaidy/db').SessionUsageTotals & { sessionId: string }>
  > {
    if (this.runsRepo) {
      return this.runsRepo.getUsageBySession();
    }
    return [];
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

    // Link any pending uploads to the persisted user message so they show
    // up in the transcript and flow into the model request below.
    if (input.attachmentIds?.length && this.attachments) {
      try {
        await this.attachments.linkToMessage(
          input.attachmentIds,
          input.sessionId,
          userMessage.id,
        );
      } catch (e) {
        this.logger?.warn(
          {
            sessionId: input.sessionId,
            attachmentIds: input.attachmentIds,
            error: e instanceof Error ? e.message : String(e),
          },
          'Failed to link attachments to message',
        );
      }
    }

    // 3. Create run record
    // Track how many more messages may include the (discretion-based) ONBOARDING
    // guidance. Starts at 2 (first message + first user response); decremented
    // each message, stops at 0. The block itself now lets the agent decide
    // whether to actually onboard, so it never gatekeeps a greeting or a task.
    if (isFirstMessage) {
      this.onboardingCounter.set(input.sessionId, 2);
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

    // Run-level AbortController: a user "Stop agent" aborts this, which cancels
    // the provider stream and any tool running under this run (issue #376).
    // Registered under the WS-level runId the client uses to address a cancel.
    const runController = new AbortController();
    if (input.runId) {
      this.inflightRuns.set(input.runId, runController);
    }

    // Server-driven activity heartbeat (issue #378): emit a `run.activity`
    // event (at most 1/s) while the run is idle between other events, so the
    // UI can show "Thinking…" / "Running <tool>… 12s". Emitted under the
    // WS-level runId so it reaches the subscribed client; skipped for non-WS
    // callers (no runId). `lastActivityAt` is bumped whenever we produce a
    // real event, so a continuously-streaming run stays quiet.
    const activityRunId = input.runId;
    const runStartAt = Date.now();
    let lastActivityAt = runStartAt;
    let activityPhase: 'thinking' | 'running_tool' = 'thinking';
    let activityToolName: string | undefined;
    const heartbeat =
      activityRunId && this.runEvents
        ? setInterval(() => {
            const now = Date.now();
            // Already busy (event within the last 500ms) — stay quiet.
            if (now - lastActivityAt < 500) return;
            this.runEvents!.emitActivity({
              runId: activityRunId,
              sessionId: input.sessionId,
              agentId,
              phase: activityPhase,
              elapsedMs: now - runStartAt,
              ...(activityToolName !== undefined && {
                toolName: activityToolName,
              }),
            });
          }, 1000)
        : undefined;

    // Model media capabilities — decide whether image/audio attachments are
    // embedded natively as provider content blocks or degraded to a
    // file-path note (so the model can reach for a vision-capable tool).
    // Unknown capabilities are treated as capable (optimistic): a provider
    // that can't handle the block will surface its own error.
    let modelSupportsVision = true;
    let modelSupportsAudio = true;
    if (this.attachments && providerEntry) {
      const modelResult = await providerEntry.provider
        .getModel(modelId)
        .catch(() => null);
      if (modelResult?.ok && modelResult.value.capabilities.length > 0) {
        modelSupportsVision = modelResult.value.capabilities.includes('vision');
        modelSupportsAudio =
          modelResult.value.capabilities.includes('audio_input');
      }
    }

    // 5. Build request from session history + new message
    const history = await this.listMessages(input.sessionId);
    const historyMessages: Message[] = [];
    for (const m of history) {
      const msgRole = (m as { role: string }).role;
      const msgContent = (m as { content: string }).content;
      const msgToolCallId = (m as { toolCallId?: string }).toolCallId;
      const msgMetadata = (m as { metadata?: Record<string, unknown> })
        .metadata;

      if (msgRole === 'tool') {
        historyMessages.push({
          role: 'tool' as const,
          content: msgContent,
          toolCallId: msgToolCallId ?? '',
        });
        continue;
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
        historyMessages.push({
          role: 'assistant' as const,
          content: msgContent,
          ...(storedToolCalls?.length ? { toolCalls: storedToolCalls } : {}),
          ...(msgReasoningContent
            ? { reasoningContent: msgReasoningContent }
            : {}),
        } as Message);
        continue;
      }

      // User messages may carry attachments (linked above / in prior turns).
      const msgAttachments = (m as { attachments?: DbMessageAttachment[] })
        .attachments;
      if (msgRole === 'user' && msgAttachments?.length && this.attachments) {
        const inline: RuntimeMessageAttachment[] = [];
        const degradedNotes: string[] = [];
        for (const att of msgAttachments) {
          if (att.kind !== 'image' && att.kind !== 'audio') continue;
          const supported =
            att.kind === 'image' ? modelSupportsVision : modelSupportsAudio;
          if (!supported) {
            degradedNotes.push(
              `[Attached ${att.kind}${att.name ? ` "${att.name}"` : ''} (${att.mimeType}) is saved at ${att.storagePath} — this model cannot process it natively; use an available tool to analyze the file.]`,
            );
            continue;
          }
          try {
            const { buffer } = await this.attachments.readBytes(att);
            inline.push({
              kind: att.kind,
              mimeType: att.mimeType,
              data: buffer.toString('base64'),
              ...(att.name ? { name: att.name } : {}),
            });
          } catch (e) {
            this.logger?.warn(
              {
                attachmentId: att.id,
                error: e instanceof Error ? e.message : String(e),
              },
              'Failed to read attachment bytes for model request',
            );
            degradedNotes.push(
              `[Attachment ${att.name ?? att.id} could not be read.]`,
            );
          }
        }
        const contentWithNotes = degradedNotes.length
          ? [msgContent, ...degradedNotes].filter(Boolean).join('\n')
          : msgContent;
        historyMessages.push({
          role: 'user' as const,
          content: contentWithNotes,
          ...(inline.length ? { attachments: inline } : {}),
        } as Message);
        continue;
      }

      historyMessages.push({
        role: msgRole as 'system' | 'user',
        content: msgContent,
      } as Message);
    }

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
    // Usage accumulated across all tool-call rounds — each round is a
    // separate billable provider call, so cache/cost totals sum them.
    const finalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    let sawCacheTokens = false;
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
      // Cap the agentic tool-call loop. Exploratory tasks legitimately chain
      // many tool calls (read files, search, fetch), so keep this generous —
      // a low cap makes the agent run out of rounds mid-task and stop.
      const MAX_TOOL_ROUNDS = this.maxToolRounds;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // On the final permitted round, stop offering tools so the model is
        // forced to turn what it has gathered into a text answer. Without this,
        // a task that exhausts the round budget ends right after the last
        // round's tool calls execute — the loop exits before the model can
        // respond, persisting an EMPTY assistant message and marking the run
        // "succeeded" with finish_reason `tool_calls`. To the user that looks
        // like the agent silently stalled mid-task, forcing them to re-prompt
        // "continue" (which starts a fresh run that then finishes). Reserving
        // the final round for a forced text response guarantees the run always
        // ends with a real, non-empty answer instead. (See run Ozpbnm8Y…)
        const isFinalRound = round === MAX_TOOL_ROUNDS - 1;
        const offerTools = allTools.length > 0 && !isFinalRound;
        if (isFinalRound && allTools.length > 0) {
          this.logger?.warn(
            {
              sessionId: input.sessionId,
              runId: run.id,
              maxRounds: MAX_TOOL_ROUNDS,
            },
            'Agentic loop hit MAX_TOOL_ROUNDS — forcing a final text response without tools',
          );
        }
        const modelRequest: ModelRequest = {
          model: modelId,
          messages: loopMessages,
          ...(offerTools && { tools: allTools, toolChoice: 'auto' }),
          // Run-level cancel: aborting this signal cancels the provider fetch.
          signal: runController.signal,
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
              // Content is flowing — mark busy so the heartbeat stays quiet
              // and the phase reads as thinking/streaming (#378).
              lastActivityAt = Date.now();
              activityPhase = 'thinking';
              activityToolName = undefined;
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
              finalUsage.promptTokens += value.usage.promptTokens;
              finalUsage.completionTokens += value.usage.completionTokens;
              finalUsage.totalTokens += value.usage.totalTokens;
              if (value.usage.cacheReadTokens !== undefined) {
                finalUsage.cacheReadTokens += value.usage.cacheReadTokens;
                sawCacheTokens = true;
              }
              if (value.usage.cacheCreationTokens !== undefined) {
                finalUsage.cacheCreationTokens +=
                  value.usage.cacheCreationTokens;
                sawCacheTokens = true;
              }
              onStreamEvent({
                type: 'usage',
                usage: {
                  promptTokens: value.usage.promptTokens,
                  completionTokens: value.usage.completionTokens,
                  totalTokens: value.usage.totalTokens,
                  ...(value.usage.cacheReadTokens !== undefined && {
                    cacheReadTokens: value.usage.cacheReadTokens,
                  }),
                  ...(value.usage.cacheCreationTokens !== undefined && {
                    cacheCreationTokens: value.usage.cacheCreationTokens,
                  }),
                },
              });
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
            // Inline images a tool returned and we persisted to disk —
            // registered as attachments on the tool result message below.
            let persistedImages: PersistedImage[] = [];

            // Route to builtin (native) tool only if it exists in the registry
            // AND is still enabled for this agent (tools list may have changed mid-session).
            const enabledTools = this.agents?.getAgent(agentId)?.tools ?? [];
            const builtinTool = enabledTools.includes(tc.name)
              ? this.builtinTools?.get(tc.name)
              : undefined;
            if (builtinTool) {
              // Register an AbortController so the user can cancel this tool
              // (issue #375). Keyed by (runId, toolCallId); cleaned up when the
              // tool settles.
              const cancelKey = input.runId
                ? `${input.runId}:${tc.id}`
                : undefined;
              const controller = new AbortController();
              if (cancelKey) this.inflightTools.set(cancelKey, controller);
              // A run-level "Stop agent" also aborts the tool in flight (#376).
              if (runController.signal.aborted) {
                controller.abort();
              } else {
                runController.signal.addEventListener(
                  'abort',
                  () => controller.abort(),
                  { once: true },
                );
              }

              // Reflect the running tool in the activity heartbeat (#378).
              activityPhase = 'running_tool';
              activityToolName = tc.name;
              lastActivityAt = Date.now();

              const builtinResult = await builtinTool
                .execute(tc.arguments, {
                  agentId,
                  sessionId: input.sessionId,
                  signal: controller.signal,
                  onOutput: (chunk) =>
                    onStreamEvent({
                      type: 'exec_output',
                      toolCallId: tc.id,
                      stream: chunk.stream,
                      data: chunk.data,
                    }),
                })
                .catch((e: unknown) => ({
                  ok: false as const,
                  error: `Tool error: ${e instanceof Error ? e.message : String(e)}`,
                }))
                .finally(() => {
                  if (cancelKey) this.inflightTools.delete(cancelKey);
                });

              // Tool settled — back to thinking until the next tool runs (#378).
              activityPhase = 'thinking';
              activityToolName = undefined;
              lastActivityAt = Date.now();

              // If the user cancelled this tool, tell the UI so it can mark the
              // block "Cancelled by user".
              if (controller.signal.aborted) {
                onStreamEvent({ type: 'tool_cancelled', toolCallId: tc.id });
              }

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
                      ...(sawCacheTokens && {
                        cacheReadTokens: finalUsage.cacheReadTokens,
                        cacheCreationTokens: finalUsage.cacheCreationTokens,
                      }),
                      metadata: {
                        providerId: finalProviderId,
                        model: finalModelId,
                        suspended: true,
                        choicesQuestion: parsed.question ?? null,
                        choicesCount: (parsed.choices as string[]).length,
                      },
                    }).catch(() => {});
                    // Persist a synthetic tool result message so the conversation
                    // history stays well-formed for the next turn. OpenAI-
                    // compatible APIs (MiniMax, OpenAI, DeepSeek, etc.) require
                    // every assistant message with `tool_calls` to be followed
                    // by a matching `role: 'tool'` message — without it, the
                    // next request errors with "tool call result does not
                    // follow tool call" the moment the user replies.
                    // The user-facing semantics are: present_choices paused the
                    // loop and surfaced the choices to the UI; the "result"
                    // here is just a marker that the tool is waiting on user
                    // input. The user's next message will arrive as a regular
                    // `role: 'user'` turn that resumes the conversation.
                    await this.appendMessage({
                      sessionId: input.sessionId,
                      runId: run.id,
                      role: 'tool',
                      content: JSON.stringify({
                        _type: 'INTERRUPT_CHOICES',
                        status: 'awaiting_user_choice',
                        question: parsed.question ?? null,
                        choices: parsed.choices,
                      }),
                      toolCallId: tc.id,
                      metadata: {
                        toolName: tc.name,
                        interrupt: 'awaiting_user_choice',
                      },
                    }).catch((err: unknown) => {
                      // Non-fatal: if persisting fails the next turn will
                      // surface the provider error, which is the same outcome
                      // we had before this fix.
                      this.logger?.warn(
                        { err, sessionId: input.sessionId, toolCallId: tc.id },
                        'Failed to persist synthetic INTERRUPT_CHOICES tool result',
                      );
                    });
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

              // Persist any inline image the tool returned into the agent
              // workspace — screenshots keep their dedicated folder, other
              // tool media goes to `media/`. The saved files are registered
              // as attachments on the tool result message below so they
              // render inline in chat. Best-effort: a failure here must not
              // fail the tool call.
              if (
                this.workspace &&
                mcpResult &&
                !toolIsError &&
                extractInlineImages(mcpResult as McpToolResult).length > 0
              ) {
                try {
                  const persisted = await persistScreenshotImages({
                    result: mcpResult as McpToolResult,
                    workspace: this.workspace,
                    agentId,
                    requestedFilename,
                    ...(captureScreenshot
                      ? {}
                      : { targetDir: MEDIA_WORKSPACE_DIR }),
                    logger: this.logger,
                  });
                  mcpResult = persisted.result;
                  persistedImages = persisted.saved;
                } catch (e) {
                  this.logger?.warn(
                    {
                      agentId,
                      tool: mcpToolName,
                      error: e instanceof Error ? e.message : String(e),
                    },
                    'Failed to persist tool image to workspace',
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
              const toolMessage = await this.appendMessage({
                sessionId: input.sessionId,
                runId: run.id,
                role: 'tool',
                content: toolContent,
                toolCallId: tc.id,
                ...(toolIsError ? { isError: true } : {}),
                metadata: toolMetadata,
              });

              // Register tool-produced images as attachments on the tool
              // result message so the chat renders them inline (instead of
              // only leaving a workspace-path breadcrumb).
              if (persistedImages.length > 0 && this.attachments) {
                for (const img of persistedImages) {
                  await this.attachments
                    .registerToolOutput({
                      sessionId: input.sessionId,
                      messageId: toolMessage.id,
                      mimeType: img.mimeType,
                      storagePath: img.absolutePath,
                      name:
                        img.relativePath.split('/').pop() ?? img.relativePath,
                    })
                    .catch((e: unknown) => {
                      this.logger?.warn(
                        {
                          messageId: toolMessage.id,
                          path: img.absolutePath,
                          error: e instanceof Error ? e.message : String(e),
                        },
                        'Failed to register tool image attachment',
                      );
                    });
                }
              }

              // Feed the model a size-capped copy (the full result was just
              // persisted above). Keeps one broad tool result from ballooning
              // the context and stalling the run (issue #436).
              loopMessages.push({
                role: 'tool',
                content: this.capToolOutputForContext(toolContent, tc.name),
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

      // If the user hit "Stop agent", mark the run cancelled and bail without
      // persisting a final assistant message (issue #376).
      if (runController.signal.aborted) {
        await this.markRunCancelled(run);
        return {
          ok: false,
          error: { code: 'cancelled', message: 'Run cancelled by user' },
        };
      }

      // 7. Persist assistant message with accumulated content.
      // Defense in depth: the forced final round (above) should always yield a
      // text answer, but if the model still returns nothing usable, never
      // persist a blank assistant bubble — that's the exact symptom that reads
      // as "the agent silently stopped". Substitute an honest, actionable note.
      if (accumulatedContent.trim() === '') {
        this.logger?.warn(
          {
            sessionId: input.sessionId,
            runId: run.id,
            finishReason: finalFinishReason,
          },
          'Run produced an empty final assistant message — substituting fallback',
        );
        accumulatedContent =
          finalFinishReason === 'tool_calls'
            ? 'I reached my step limit for this turn before finishing. Reply "continue" and I’ll pick up where I left off.'
            : 'I wasn’t able to produce a response for this turn. Reply "continue" to have me try again.';
      }

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
        ...(sawCacheTokens && {
          cacheReadTokens: finalUsage.cacheReadTokens,
          cacheCreationTokens: finalUsage.cacheCreationTokens,
        }),
        firstMessageId: assistantMessage.id,
        metadata: { providerId: finalProviderId, model: finalModelId },
      });

      // 9. Update session's agentId to reflect the agent that just ran
      // This allows the session to "remember" which agent was last used
      await this.updateSessionAgentId(input.sessionId, agentId);

      return { ok: true, userMessage, assistantMessage, run: updatedRun! };
    } catch (error) {
      // A user "Stop agent" aborts the provider fetch, which surfaces here as
      // an AbortError. Treat that as a cancellation, not a failure (issue #376).
      if (runController.signal.aborted) {
        await this.markRunCancelled(run);
        return {
          ok: false,
          error: { code: 'cancelled', message: 'Run cancelled by user' },
        };
      }
      const errorMsg =
        error instanceof Error ? error.message : 'Streaming failed';
      return this.handleFailure(
        run.id,
        userMessage,
        'streaming_error',
        errorMsg,
      );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (input.runId) this.inflightRuns.delete(input.runId);
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
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      firstMessageId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<SessionRunRecord | SessionRun | null> {
    // Estimate cost from the run's model + usage (null when pricing unknown).
    const cost =
      input.promptTokens !== undefined
        ? estimateCost(
            run.modelId,
            {
              promptTokens: input.promptTokens,
              completionTokens: input.completionTokens ?? 0,
              ...(input.cacheReadTokens !== undefined && {
                cacheReadTokens: input.cacheReadTokens,
              }),
              ...(input.cacheCreationTokens !== undefined && {
                cacheCreationTokens: input.cacheCreationTokens,
              }),
            },
            this.modelPricing,
          )
        : null;

    // Shared usage object for both persistence and the run.completed event.
    const usage =
      input.promptTokens !== undefined
        ? {
            promptTokens: input.promptTokens,
            completionTokens: input.completionTokens ?? 0,
            totalTokens: input.totalTokens ?? 0,
            ...(input.cacheReadTokens !== undefined && {
              cacheReadTokens: input.cacheReadTokens,
            }),
            ...(input.cacheCreationTokens !== undefined && {
              cacheCreationTokens: input.cacheCreationTokens,
            }),
          }
        : undefined;

    if (this.runsRepo) {
      const successInput: {
        finishReason: DbFinishReason;
        usage?: NonNullable<typeof usage>;
        cost?: number | null;
        firstMessageId?: string;
        metadata?: Record<string, unknown>;
      } = {
        finishReason: input.finishReason as DbFinishReason,
      };
      if (usage) successInput.usage = usage;
      if (cost !== null) successInput.cost = cost;
      if (input.firstMessageId !== undefined) {
        successInput.firstMessageId = input.firstMessageId;
      }
      if (input.metadata !== undefined) {
        successInput.metadata = input.metadata;
      }
      const updated = await this.runsRepo.markSucceeded(run.id, successInput);
      if (this.runEvents && updated) {
        this.runEvents.emitCompleted({
          runId: run.id,
          sessionId: run.sessionId,
          agentId: run.agentId,
          finishReason: input.finishReason,
          ...(usage && { usage }),
          ...(cost !== null && { cost }),
        });
      }
      return updated;
    }
    const updated = markRunSucceeded(run.id, {
      ...input,
      ...(cost !== null && { cost }),
    });
    if (this.runEvents && updated) {
      this.runEvents.emitCompleted({
        runId: run.id,
        sessionId: run.sessionId,
        agentId: run.agentId,
        finishReason: input.finishReason,
        ...(usage && { usage }),
        ...(cost !== null && { cost }),
      });
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
   * Mark a run as cancelled (user hit "Stop agent") and emit run.cancelled.
   */
  private async markRunCancelled(
    run: SessionRunRecord | SessionRun,
  ): Promise<SessionRunRecord | SessionRun | null> {
    const updated = this.runsRepo
      ? await this.runsRepo.markCancelled(run.id)
      : (markRunCancelled(run.id) ?? null);
    if (this.runEvents && updated) {
      this.runEvents.emitRunCancelled({
        runId: run.id,
        sessionId: run.sessionId,
        agentId: run.agentId,
      });
    }
    return updated;
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
      ...(response.usage.cacheReadTokens !== undefined && {
        cacheReadTokens: response.usage.cacheReadTokens,
      }),
      ...(response.usage.cacheCreationTokens !== undefined && {
        cacheCreationTokens: response.usage.cacheCreationTokens,
      }),
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
