import type { SessionMessage, SessionRun } from '@openaidy/db';
import type { SessionMessageRecord, SessionRunRecord } from './store';

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
 * Input for submitting a streaming message to a session
 */
export type SubmitMessageStreamingInput = SubmitMessageInput & {
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
          type: 'usage';
          usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
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
import type { BuiltinToolRegistry } from '../tools';
import type { SkillRegistry } from '../skills';
import type { AgentPersonalityService } from '../agents/personality-service';
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
  /** Registry of native (in-process) builtin tools — separate from MCP */
  builtinTools?: BuiltinToolRegistry;
  /** Registry of skills for skill injection into system prompt */
  skills?: SkillRegistry;
  /** Service for reading personality markdown files per agent */
  personality?: AgentPersonalityService;
  getDefaultAgentId?: () => string | undefined;
  repositories?:
    | {
        sessions: SessionsStore;
        messages: SessionMessagesStore;
        runs: SessionRunsStore;
      }
    | undefined;
};
