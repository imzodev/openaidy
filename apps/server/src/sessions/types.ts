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
  /** Attachment storage for image/audio chat media (requires DB) */
  attachments?: import('../attachments/service').AttachmentService;
  /**
   * Per-model pricing overrides (from app config) used for cost estimation.
   * Merged over the built-in MODEL_PRICING table.
   */
  modelPricing?: Record<string, import('@openaidy/shared-types').ModelPricing>;
  repositories?:
    | {
        sessions: SessionsStore;
        messages: SessionMessagesStore;
        runs: SessionRunsStore;
      }
    | undefined;
};
