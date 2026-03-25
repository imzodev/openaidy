import type { ProviderServices } from '../providers';
import type { AgentRegistry } from '../agents';
import type { Message, ModelRequest, ModelResponse } from '@openaidy/runtime';
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
import {
  findSessionRecord,
  createSessionRecord,
  listSessionRecords,
  appendMessageRecord,
  listSessionMessageRecords,
  createRunRecord,
  markRunRunning,
  markRunSucceeded,
  markRunFailed,
  listSessionRunRecords,
  type SessionMessageRecord,
  type SessionRunRecord,
  type SessionRecord,
  type FinishReason,
} from './store';

/**
 * Input for submitting a message to a session
 */
export type SubmitMessageInput = {
  sessionId: string;
  role: 'user' | 'system';
  content: string;
  agentId?: string;
  providerId?: string;
  modelId?: string;
};

/**
 * Result of submitting a message
 */
export type SubmitMessageResult =
  | { ok: true; userMessage: SessionMessageRecord | SessionMessage; assistantMessage: SessionMessageRecord | SessionMessage; run: SessionRunRecord | SessionRun }
  | { ok: false; error: { code: string; message: string; providerId?: string; modelId?: string } };

/**
 * Session message service options
 */
export type SessionMessageServiceOptions = {
  providers: ProviderServices;
  agents?: AgentRegistry;
  getDefaultAgentId?: () => string | undefined;
  repositories?: {
    sessions: SessionsStore;
    messages: SessionMessagesStore;
    runs: SessionRunsStore;
  } | undefined;
};

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
  private readonly agents: AgentRegistry | undefined;
  private readonly getDefaultAgentId: (() => string | undefined) | undefined;
  private readonly sessionsRepo: SessionsStore | undefined;
  private readonly messagesRepo: SessionMessagesStore | undefined;
  private readonly runsRepo: SessionRunsStore | undefined;

  constructor(options: SessionMessageServiceOptions) {
    this.providers = options.providers;
    this.agents = options.agents;
    this.getDefaultAgentId = options.getDefaultAgentId;
    
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
  async createSession(title: string): Promise<SessionRecord | Session> {
    if (this.sessionsRepo) {
      return this.sessionsRepo.create({ title });
    }
    return createSessionRecord(title);
  }

  /**
   * List messages for a session
   */
  async listMessages(sessionId: string): Promise<SessionMessageRecord[] | SessionMessage[]> {
    if (this.messagesRepo) {
      return this.messagesRepo.listBySession(sessionId);
    }
    return listSessionMessageRecords(sessionId);
  }

  /**
   * List runs for a session
   */
  async listRuns(sessionId: string): Promise<SessionRunRecord[] | SessionRun[]> {
    if (this.runsRepo) {
      return this.runsRepo.listBySession(sessionId);
    }
    return listSessionRunRecords(sessionId);
  }

  /**
   * Submit a message to a session
   * 
   * This orchestrates the full flow:
   * 1. Validate session exists
   * 2. Persist user message
   * 3. Create run record (queued)
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
    const userMessage = await this.appendMessage({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
    });

    // 3. Create run record (starts in 'queued' status)
    const configuredDefaultAgentId = this.getDefaultAgentId?.();
    const resolvedAgentId = input.agentId ?? configuredDefaultAgentId;
    const agent = resolvedAgentId ? this.agents?.getAgent(resolvedAgentId) : undefined;
    const defaultProviderConfig = this.providers.registry.getDefault();
    const providerEntry = input.providerId
      ? this.providers.registry.getEntry(input.providerId)
      : agent?.defaults.providerId
        ? this.providers.registry.getEntry(agent.defaults.providerId)
        : defaultProviderConfig
          ? this.providers.registry.getEntry(defaultProviderConfig.providerId)
          : undefined;
    const providerId = input.providerId
      ?? agent?.defaults.providerId
      ?? defaultProviderConfig?.providerId
      ?? providerEntry?.provider.descriptor.id
      ?? 'default';
    const modelId = input.modelId
      ?? agent?.defaults.modelId
      ?? (providerId === defaultProviderConfig?.providerId ? defaultProviderConfig.modelId : undefined)
      ?? providerEntry?.defaultModel
      ?? 'default';
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
    const messages: Message[] = history.map(m => {
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

    // 6. Invoke provider
    const modelRequest: ModelRequest = {
      model: modelId,
      messages,
    };

    // Build invocation options, only including properties that have values
    const invokeOptions = {
      ...(input.providerId !== undefined && { providerId: input.providerId }),
      ...(input.modelId !== undefined && { modelId: input.modelId }),
    };

    const result = await this.providers.invocation.invoke(modelRequest, invokeOptions);

    // 7 & 8. Handle result
    if (result.ok) {
      return this.handleSuccess(run.id, input.sessionId, userMessage, result.value);
    } else {
      return this.handleFailure(run.id, userMessage, result.error.code, result.error.message);
    }
  }

  /**
   * Append a message to a session
   */
  private async appendMessage(input: {
    sessionId: string;
    role: 'user' | 'system' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SessionMessageRecord | SessionMessage> {
    if (this.messagesRepo) {
      const appendInput: {
        sessionId: string;
        role: DbMessageRole;
        content: string;
        toolCallId?: string;
        metadata?: Record<string, unknown>;
      } = {
        sessionId: input.sessionId,
        role: input.role as DbMessageRole,
        content: input.content,
      };
      if (input.toolCallId !== undefined) {
        appendInput.toolCallId = input.toolCallId;
      }
      if (input.metadata !== undefined) {
        appendInput.metadata = input.metadata;
      }
      return this.messagesRepo.append(appendInput);
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
  private async markRunRunning(id: string): Promise<SessionRunRecord | SessionRun | null> {
    if (this.runsRepo) {
      return this.runsRepo.markRunning(id);
    }
    return markRunRunning(id) ?? null;
  }

  /**
   * Mark a run as succeeded
   */
  private async markRunSucceeded(
    id: string,
    input: {
      finishReason: FinishReason;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<SessionRunRecord | SessionRun | null> {
    if (this.runsRepo) {
      const successInput: {
        finishReason: DbFinishReason;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
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
      if (input.metadata !== undefined) {
        successInput.metadata = input.metadata;
      }
      return this.runsRepo.markSucceeded(id, successInput);
    }
    return markRunSucceeded(id, input) ?? null;
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
    }
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
    runId: string,
    sessionId: string,
    userMessage: SessionMessageRecord | SessionMessage,
    response: ModelResponse
  ): Promise<SubmitMessageResult> {
    // Persist assistant message
    const assistantMessage = await this.appendMessage({
      sessionId: sessionId,
      role: 'assistant',
      content: response.content,
      metadata: {
        providerId: response.providerId,
        model: response.model,
        runId,
      },
    });

    // Update run with success
    const updatedRun = await this.markRunSucceeded(runId, {
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
    errorMessage: string
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
