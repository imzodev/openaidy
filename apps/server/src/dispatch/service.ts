import type { ProviderServices } from '../providers';
import type { Message, ModelRequest, ModelResponse } from '@openaidy/runtime';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Agent, AgentRegistry } from '../agents';
import {
  SessionsRepository,
  SessionMessagesRepository,
  SessionRunsRepository,
  type Session,
  type SessionMessage,
  type SessionRun,
  type MessageRole as DbMessageRole,
  type FinishReason as DbFinishReason,
} from '@openaidy/db';
import * as schema from '@openaidy/db';
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
} from '../sessions/store';

type Database = NodePgDatabase<typeof schema>;

/**
 * Dispatch input
 */
export type DispatchInput = {
  sessionId: string;
  agentId: string;
  input: {
    role: 'user' | 'system';
    content: string;
  };
  /** Per-run overrides for provider/model */
  overrides?: {
    providerId?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
  };
};

/**
 * Dispatch result
 */
export type DispatchResult =
  | { ok: true; userMessage: SessionMessageRecord | SessionMessage; assistantMessage: SessionMessageRecord | SessionMessage; run: SessionRunRecord | SessionRun }
  | { ok: false; error: { code: string; message: string; providerId?: string; modelId?: string } };

/**
 * Resolved configuration for a dispatch
 */
export type ResolvedConfig = {
  agentId: string;
  providerId: string;
  modelId: string;
  temperature: number | undefined;
  maxTokens: number | undefined;
  systemPrompt: string;
};

/**
 * System default configuration
 */
export type SystemDefaults = {
  providerId: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
};

/**
 * DispatchService options
 */
export type DispatchServiceOptions = {
  agents: AgentRegistry;
  providers: ProviderServices;
  db?: Database | undefined;
  systemDefaults?: SystemDefaults;
};

/**
 * DispatchService
 * 
 * Orchestrates agent-based dispatch to sessions:
 * 1. Resolve agent config (provider/model/defaults)
 * 2. Validate session exists
 * 3. Persist user message
 * 4. Create run record
 * 5. Invoke provider with agent's system prompt
 * 6. Persist assistant message
 * 7. Update run with result
 * 
 * Resolution precedence:
 * - per-run overrides (providerId, modelId, etc.)
 * - agent defaults from AgentRegistry
 * - system defaults
 */
export class DispatchService {
  private readonly agents: AgentRegistry;
  private readonly providers: ProviderServices;
  private readonly db: Database | undefined;
  private readonly sessionsRepo: SessionsRepository | undefined;
  private readonly messagesRepo: SessionMessagesRepository | undefined;
  private readonly runsRepo: SessionRunsRepository | undefined;
  private readonly systemDefaults: SystemDefaults;

  constructor(options: DispatchServiceOptions) {
    this.agents = options.agents;
    this.providers = options.providers;
    this.db = options.db;
    
    // Default system defaults
    this.systemDefaults = options.systemDefaults ?? {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 4096,
    };
    
    if (options.db) {
      this.sessionsRepo = new SessionsRepository(options.db);
      this.messagesRepo = new SessionMessagesRepository(options.db);
      this.runsRepo = new SessionRunsRepository(options.db);
    }
  }

  /**
   * Resolve configuration for a dispatch
   * 
   * Precedence:
   * 1. per-run overrides
   * 2. agent defaults
   * 3. system defaults
   */
  resolveConfig(agentId: string, overrides?: DispatchInput['overrides']): ResolvedConfig | { error: { code: string; message: string } } {
    const agent = this.agents.getAgent(agentId);
    
    if (!agent) {
      return {
        error: {
          code: 'agent.not_found',
          message: `Agent "${agentId}" not found`,
        },
      };
    }
    
    if (!agent.enabled) {
      return {
        error: {
          code: 'agent.disabled',
          message: `Agent "${agentId}" is disabled`,
        },
      };
    }

    // Resolution precedence
    const providerId = overrides?.providerId 
      ?? agent.defaults.providerId 
      ?? this.systemDefaults.providerId;
    
    const modelId = overrides?.modelId 
      ?? agent.defaults.modelId 
      ?? this.systemDefaults.modelId;
    
    const temperature = overrides?.temperature 
      ?? agent.defaults.temperature 
      ?? this.systemDefaults.temperature;
    
    const maxTokens = overrides?.maxTokens 
      ?? agent.defaults.maxTokens 
      ?? this.systemDefaults.maxTokens;
    
    const systemPrompt = agent.systemPrompt;

    // Validate we have required config
    if (!providerId) {
      return {
        error: {
          code: 'provider.config_invalid',
          message: `No provider configured for agent "${agentId}" (set agent.defaults.providerId or systemDefaults.providerId)`,
        },
      };
    }
    
    if (!modelId) {
      return {
        error: {
          code: 'provider.config_invalid',
          message: `No model configured for agent "${agentId}" (set agent.defaults.modelId or systemDefaults.modelId)`,
        },
      };
    }

    return {
      agentId,
      providerId,
      modelId,
      temperature,
      maxTokens,
      systemPrompt,
    };
  }

  /**
   * Dispatch an agent to a session
   */
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    // 1. Resolve configuration
    const config = this.resolveConfig(input.agentId, input.overrides);
    
    if ('error' in config) {
      return {
        ok: false,
        error: config.error,
      };
    }

    // 2. Validate session exists
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

    // 3. Persist user message
    const userMessage = await this.appendMessage({
      sessionId: input.sessionId,
      role: input.input.role,
      content: input.input.content,
      metadata: {
        agentId: config.agentId,
      },
    });

    // 4. Create run record (starts in 'queued' status)
    const run = await this.createRun({
      sessionId: input.sessionId,
      agentId: config.agentId,
      providerId: config.providerId,
      modelId: config.modelId,
      metadata: {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      },
    });

    // 5. Mark run as running
    await this.markRunRunning(run.id);

    // 6. Build messages with agent system prompt
    const history = await this.listMessages(input.sessionId);
    const messages: Message[] = this.buildMessages(history, config.systemPrompt);

    // 7. Invoke provider
    const modelRequest: ModelRequest = {
      model: config.modelId,
      messages,
      ...(config.temperature !== undefined && { temperature: config.temperature }),
      ...(config.maxTokens !== undefined && { maxTokens: config.maxTokens }),
    };

    const result = await this.providers.invocation.invoke(modelRequest, {
      providerId: config.providerId,
    });

    // 8. Handle result
    if (result.ok) {
      return this.handleSuccess(run.id, input.sessionId, userMessage, result.value, config);
    } else {
      return this.handleFailure(run.id, userMessage, result.error.code, result.error.message);
    }
  }

  /**
   * Build messages array with system prompt
   */
  private buildMessages(
    history: SessionMessageRecord[] | SessionMessage[],
    systemPrompt: string
  ): Message[] {
    const messages: Message[] = [];
    
    // Add system prompt first
    messages.push({
      role: 'system',
      content: systemPrompt,
    });
    
    // Add conversation history
    for (const m of history) {
      const msgRole = (m as { role: string }).role;
      const msgContent = (m as { content: string }).content;
      const msgToolCallId = (m as { toolCallId?: string }).toolCallId;
      
      if (msgRole === 'tool') {
        messages.push({
          role: 'tool',
          content: msgContent,
          toolCallId: msgToolCallId ?? '',
        });
      } else if (msgRole !== 'system') {
        // Skip system messages from history (we use agent's system prompt)
        messages.push({
          role: msgRole as 'user' | 'assistant',
          content: msgContent,
        });
      }
    }
    
    return messages;
  }

  // Session operations
  private async getSession(id: string): Promise<SessionRecord | Session | null> {
    if (this.sessionsRepo) {
      return this.sessionsRepo.findById(id);
    }
    return findSessionRecord(id) ?? null;
  }

  private async listMessages(sessionId: string): Promise<SessionMessageRecord[] | SessionMessage[]> {
    if (this.messagesRepo) {
      return this.messagesRepo.listBySession(sessionId);
    }
    return listSessionMessageRecords(sessionId);
  }

  // Message operations
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

  // Run operations
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

  private async markRunRunning(id: string): Promise<SessionRunRecord | SessionRun | null> {
    if (this.runsRepo) {
      return this.runsRepo.markRunning(id);
    }
    return markRunRunning(id) ?? null;
  }

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

  // Result handlers
  private async handleSuccess(
    runId: string,
    sessionId: string,
    userMessage: SessionMessageRecord | SessionMessage,
    response: ModelResponse,
    config: ResolvedConfig
  ): Promise<DispatchResult> {
    // Persist assistant message
    const assistantMessage = await this.appendMessage({
      sessionId: sessionId,
      role: 'assistant',
      content: response.content,
      metadata: {
        agentId: config.agentId,
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
        agentId: config.agentId,
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

  private async handleFailure(
    runId: string,
    userMessage: SessionMessageRecord | SessionMessage,
    errorCode: string,
    errorMessage: string
  ): Promise<DispatchResult> {
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

/**
 * Create a dispatch service
 */
export function createDispatchService(options: DispatchServiceOptions): DispatchService {
  return new DispatchService(options);
}
