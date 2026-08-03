import type { SessionMessage, SessionRun } from '@openaidy/db';
import type { SessionMessageRecord, SessionRunRecord } from '../types';

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
  /**
   * Ids of previously-uploaded (pending) attachments to link to this
   * message. The bytes were stored via POST /sessions/:id/attachments.
   */
  attachmentIds?: string[];
};

/**
 * Input for submitting a streaming message to a session
 */
export type SubmitMessageStreamingInput = SubmitMessageInput & {
  /**
   * The run identifier from the WS layer. Used to key in-flight tool
   * AbortControllers so `cancelTool(runId, toolCallId)` can find them.
   */
  runId?: string;
  /** Callback for stream events */
  onStreamEvent: (
    event:
      | { type: 'delta'; content?: string }
      | {
          type: 'tool_call';
          toolCall: {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          };
        }
      | {
          type: 'exec_output';
          toolCallId: string;
          stream: 'stdout' | 'stderr';
          data: string;
        }
      | { type: 'tool_cancelled'; toolCallId: string }
      | {
          type: 'usage';
          usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            cacheReadTokens?: number;
            cacheCreationTokens?: number;
          };
        }
      | { type: 'error'; error: { code: string; message: string } }
      | { type: 'choices'; question?: string; choices: string[] },
  ) => void;
};

/**
 * Result of submitting a message
 */
export type SubmitMessageResult =
  | {
      ok: true;
      userMessage: SessionMessageRecord | SessionMessage;
      assistantMessage: SessionMessageRecord | SessionMessage;
      run: SessionRunRecord | SessionRun;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        providerId?: string;
        modelId?: string;
      };
    };

// Import types needed for SessionMessageServiceOptions
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderServices } from '../providers';
import type { AgentRegistry } from '../agents';
import type { McpClientService } from '../mcp/client';
import type { WorkspaceService } from '../workspace/service';
import type { BuiltinToolRegistry } from '../tools';
import type { SkillRegistry } from '../skills';
import type { AgentPersonalityService } from '../agents/personality-service';
import type { RunEventEmitter } from '../dispatch/events';
import type {
  SessionsStore,
  SessionMessagesStore,
  SessionRunsStore,
} from '@openaidy/db';

/**
 * Session message service options
 */
export type SessionMessageServiceOptions = {
  providers: ProviderServices;
  logger?: FastifyBaseLogger;
  agents?: AgentRegistry;
  mcp?: McpClientService;
  /**
   * Workspace service — used to persist MCP artifacts (e.g. screenshots)
   * into the calling agent's workspace.
   */
  workspace?: WorkspaceService;
  /** Registry of native (in-process) builtin tools — separate from MCP */
  builtinTools?: BuiltinToolRegistry;
  /** Registry of skills for skill injection into system prompt */
  skills?: SkillRegistry;
  /** Service for reading personality markdown files per agent */
  personality?: AgentPersonalityService;
  getDefaultAgentId?: () => string | undefined;
  runEvents?: RunEventEmitter;
  /** Base directory for agent workspaces (for loading agent workspace skills) */
  workspaceBaseDir?: string;
  /**
   * Resolves the addons installed on this instance, for the
   * [ADDONS_AVAILABLE] block in the system prompt. A narrow callback rather
   * than the AddonService itself: this service only needs to read the list,
   * and the DB may be absent (no addons at all). Failures are swallowed at the
   * call site — a run must never die because the addon list was unavailable.
   */
  listAddons?: () => Promise<
    import('../prompts/build-system-prompt').AddonPromptSummary[]
  >;
  /** Attachment storage for image/audio chat media (requires DB) */
  attachments?: import('../attachments/service').AttachmentService;
  /**
   * Per-model pricing overrides (from app config) used for cost estimation.
   * Merged over the built-in MODEL_PRICING table.
   */
  modelPricing?: Record<string, import('@openaidy/shared-types').ModelPricing>;
  /**
   * Max rounds in the agentic tool-call loop before the model is forced to
   * produce a final text answer (tools withheld on the last round). Defaults
   * to 25. Exposed mainly so tests can drive the exhaustion path cheaply.
   */
  maxToolRounds?: number;
  /**
   * Max characters of a single tool result that are fed back into the model
   * context. Oversized results (e.g. broad MCP search responses) are truncated
   * with a notice before entering the loop history, to keep the context from
   * ballooning and degrading the model. The full result is still persisted for
   * the UI/history. Defaults to 24000 (~6k tokens).
   */
  maxToolOutputChars?: number;
  /**
   * Approximate input-token budget for the agentic loop. Before each model
   * call, if the running message history is estimated to exceed this, the
   * oldest tool-result bodies are elided (their tool_call/result pairing is
   * preserved) until it fits — keeping a large or long conversation from
   * degrading tool-calling or overflowing the model's window. The full
   * results remain in the persisted transcript. Defaults to 100000.
   */
  maxContextTokens?: number;
  /**
   * How many of the most-recent tool results to replay in full when
   * reconstructing a session's history for a new run. Older tool-result bodies
   * from prior turns are summarized (their tool_call pairing is preserved), so
   * a long multi-run session doesn't re-send every large tool output on every
   * turn — a cost/latency win even when the request is under `maxContextTokens`.
   * The full results remain in the persisted transcript. Defaults to 10.
   */
  historyToolResultsKept?: number;
  repositories?:
    | {
        sessions: SessionsStore;
        messages: SessionMessagesStore;
        runs: SessionRunsStore;
      }
    | undefined;
};
