import type { ProviderServices } from '../providers';
import type { Message, ModelRequest, ModelResponse } from '@openaidy/runtime';
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
  providerId?: string;
  modelId?: string;
};

/**
 * Result of submitting a message
 */
export type SubmitMessageResult =
  | { ok: true; userMessage: SessionMessageRecord; assistantMessage: SessionMessageRecord; run: SessionRunRecord }
  | { ok: false; error: { code: string; message: string; providerId?: string; modelId?: string } };

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
 */
export class SessionMessageService {
  constructor(private readonly providers: ProviderServices) {}

  /**
   * List all sessions
   */
  listSessions(): SessionRecord[] {
    return listSessionRecords();
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): SessionRecord | undefined {
    return findSessionRecord(id);
  }

  /**
   * Create a new session
   */
  createSession(title: string): SessionRecord {
    return createSessionRecord(title);
  }

  /**
   * List messages for a session
   */
  listMessages(sessionId: string): SessionMessageRecord[] {
    return listSessionMessageRecords(sessionId);
  }

  /**
   * List runs for a session
   */
  listRuns(sessionId: string): SessionRunRecord[] {
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
    const session = findSessionRecord(input.sessionId);
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
    const userMessage = appendMessageRecord({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
    });

    // 3. Create run record (starts in 'queued' status)
    const providerId = input.providerId ?? 'default';
    const modelId = input.modelId ?? 'default';
    
    const run = createRunRecord({
      sessionId: input.sessionId,
      providerId,
      modelId,
    });

    // 4. Mark run as running
    markRunRunning(run.id);

    // 5. Build request from session history + new message
    const history = listSessionMessageRecords(input.sessionId);
    const messages: Message[] = history.map(m => {
      // Map to proper Message type
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          toolCallId: m.toolCallId ?? '',
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
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
      return this.handleSuccess(run.id, userMessage, result.value);
    } else {
      return this.handleFailure(run.id, userMessage, result.error.code, result.error.message);
    }
  }

  /**
   * Handle successful provider invocation
   */
  private handleSuccess(
    runId: string,
    userMessage: SessionMessageRecord,
    response: ModelResponse
  ): SubmitMessageResult {
    // Persist assistant message
    const assistantMessage = appendMessageRecord({
      sessionId: userMessage.sessionId,
      role: 'assistant',
      content: response.content,
      metadata: {
        providerId: response.providerId,
        model: response.model,
        runId,
      },
    });

    // Update run with success
    const updatedRun = markRunSucceeded(runId, {
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
  private handleFailure(
    runId: string,
    userMessage: SessionMessageRecord,
    errorCode: string,
    errorMessage: string
  ): SubmitMessageResult {
    // Update run with failure
    markRunFailed(runId, {
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
