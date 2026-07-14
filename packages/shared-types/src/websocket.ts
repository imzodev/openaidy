/**
 * WebSocket Message Types for OpenAidy
 *
 * This file contains all shared types for WebSocket communication
 * between the server and client SDKs.
 */

import type { ChoicesEvent } from './choices.js';
import type { SessionStatus, SessionType } from './sessions.js';

// ============================================================================
// Message Envelope
// ============================================================================

/**
 * WebSocket message envelope structure
 *
 * All messages follow this envelope format for consistent handling.
 */
export type WSMessage<TType extends string = string, TPayload = unknown> = {
  /** Unique message ID (UUID) */
  id: string;
  /** Message type (e.g., "session.create", "session.stream.delta") */
  type: TType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Type-specific payload */
  payload: TPayload;
  /** Present only for error responses */
  error?: WSError;
};

/**
 * WebSocket error structure
 */
export type WSError = {
  /** Error code (e.g., "AUTH_FAILED", "INVALID_PAYLOAD") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error context */
  details?: Record<string, unknown>;
};

// ============================================================================
// Error Codes
// ============================================================================

export const WS_ERROR_CODES = {
  // Authentication errors
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // Authorization errors
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_CAPABILITY: 'INSUFFICIENT_CAPABILITY',

  // Request errors
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNKNOWN_MESSAGE_TYPE: 'UNKNOWN_MESSAGE_TYPE',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // Connection errors
  CONNECTION_LIMIT: 'CONNECTION_LIMIT',
  CONNECTION_CLOSED: 'CONNECTION_CLOSED',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type WSErrorCode = (typeof WS_ERROR_CODES)[keyof typeof WS_ERROR_CODES];

// ============================================================================
// Capabilities
// ============================================================================

export const WS_CAPABILITIES = {
  // Session capabilities
  SESSIONS_LIST: 'sessions.list',
  SESSIONS_READ: 'sessions.read',
  SESSIONS_WRITE: 'sessions.write',
  SESSIONS_STREAM: 'sessions.stream',
  SESSIONS_DELETE: 'sessions.delete',

  // Agent capabilities
  AGENTS_LIST: 'agents.list',
  AGENTS_READ: 'agents.read',
  AGENTS_INVOKE: 'agents.invoke',

  // Provider capabilities
  PROVIDERS_READ: 'providers.read',
  PROVIDERS_INVOKE: 'providers.invoke',

  // Node capabilities
  NODE_INVOKE: 'node.invoke',
  NODE_DESCRIBE: 'node.describe',

  // Config capabilities
  CONFIG_READ: 'config.read',
  CONFIG_WRITE: 'config.write',

  // Pairing capabilities
  PAIRING_APPROVE: 'pairing.approve',
  PAIRING_DENY: 'pairing.deny',

  // System capabilities
  SYSTEM_RUN: 'system.run',
  SYSTEM_NOTIFY: 'system.notify',

  // Admin wildcard
  ADMIN: '*',
} as const;

export type WSCapability =
  (typeof WS_CAPABILITIES)[keyof typeof WS_CAPABILITIES];

export type ClientType = 'web' | 'cli' | 'mobile' | 'channel';

// ============================================================================
// Authentication Types
// ============================================================================

export type AuthAuthenticateRequest = WSMessage<
  'auth.authenticate',
  {
    token?: string;
    apiKey?: string;
    clientType?: ClientType;
    clientVersion?: string;
    clientMeta?: Record<string, unknown>;
    credentials?: {
      type: 'pairing' | 'token' | 'api_key';
      data: Record<string, unknown>;
    };
  }
>;

export type AuthRefreshRequest = WSMessage<
  'auth.refresh',
  {
    refreshToken: string;
  }
>;

export type AuthAuthenticatedResponse = WSMessage<
  'auth.authenticated',
  {
    clientId: string;
    clientType: ClientType;
    token: string;
    expiresAt: string;
    capabilities: string[];
  }
>;

// ============================================================================
// Session Types
// ============================================================================

export type SessionCreateRequest = WSMessage<
  'session.create',
  {
    agentId?: string;
    providerId?: string;
    modelId?: string;
    metadata?: Record<string, unknown>;
  }
>;

export type SessionGetRequest = WSMessage<
  'session.get',
  {
    sessionId: string;
  }
>;

export type SessionListRequest = WSMessage<
  'session.list',
  {
    limit?: number;
    offset?: number;
    agentId?: string;
    status?: 'active' | 'archived' | 'all';
  }
>;

export type SessionDeleteRequest = WSMessage<
  'session.delete',
  {
    sessionId: string;
  }
>;

/**
 * Attachment metadata surfaced on session messages (bytes are fetched
 * separately via GET /api/attachments/:id/raw).
 */
export type SessionMessageAttachment = {
  id: string;
  kind: 'image' | 'audio';
  source: 'user_upload' | 'tool_output';
  name?: string | null;
  mimeType: string;
  sizeBytes: number;
};

export type SessionMessageRequest = WSMessage<
  'session.message',
  {
    sessionId: string;
    role: 'user' | 'system';
    content: string;
    stream?: boolean;
    agentId?: string;
    providerId?: string;
    modelId?: string;
    /** Ids of previously-uploaded attachments to link to this message */
    attachmentIds?: string[];
    metadata?: Record<string, unknown>;
  }
>;

export type SessionSubscribeRequest = WSMessage<
  'session.subscribe',
  {
    sessionId: string;
    events?: string[];
  }
>;

export type SessionUnsubscribeRequest = WSMessage<
  'session.unsubscribe',
  {
    sessionId: string;
  }
>;

/** Client → server: cancel an in-flight tool call (user hit Stop). */
export type SessionToolCancelRequest = WSMessage<
  'session.tool.cancel',
  {
    sessionId: string;
    runId: string;
    toolCallId: string;
  }
>;

/** Client → server: cancel an in-flight run (user hit "Stop agent"). */
export type SessionRunCancelRequest = WSMessage<
  'session.run.cancel',
  {
    sessionId: string;
    runId: string;
  }
>;

export type SessionMessagesRequest = WSMessage<
  'session.messages',
  {
    sessionId: string;
    limit?: number;
    offset?: number;
  }
>;

export type SessionRunsRequest = WSMessage<
  'session.runs',
  {
    sessionId: string;
    limit?: number;
    offset?: number;
  }
>;

export type SessionMessagesResponse = WSMessage<
  'session.messages',
  {
    sessionId: string;
    messages: Array<{
      id: string;
      sessionId: string;
      role: string;
      content: string;
      sequence: number;
      createdAt: string;
      metadata?: Record<string, unknown>;
      attachments?: SessionMessageAttachment[];
    }>;
    total: number;
  }
>;

export type SessionRunsResponse = WSMessage<
  'session.runs',
  {
    sessionId: string;
    runs: Array<{
      id: string;
      sessionId: string;
      agentId?: string;
      providerId: string;
      modelId: string;
      status: string;
      finishReason?: string;
      errorCode?: string;
      errorMessage?: string;
      createdAt: string;
      firstMessageId?: string;
    }>;
    total: number;
  }
>;

export type SessionCreatedResponse = WSMessage<
  'session.created',
  {
    sessionId: string;
    agentId: string;
    createdAt: string;
  }
>;

export type SessionMessageResponse = WSMessage<
  'session.message',
  {
    sessionId: string;
    messageId: string;
    role: 'assistant' | 'user' | 'system';
    content: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    finishReason?: string;
  }
>;

export type SessionGetResponse = WSMessage<
  'session.get',
  {
    session: {
      id: string;
      title?: string;
      status: SessionStatus;
      agentId?: string;
      createdAt: string;
      updatedAt?: string;
    };
  }
>;

export type SessionListResponse = WSMessage<
  'session.list',
  {
    sessions: Array<{
      id: string;
      title?: string;
      type?: SessionType;
      status: SessionStatus;
      agentId?: string;
      createdAt: string;
      updatedAt?: string;
    }>;
    total: number;
  }
>;

export type SessionDeleteResponse = WSMessage<
  'session.delete',
  {
    sessionId: string;
    deleted: boolean;
  }
>;

export type SessionSubscribedResponse = WSMessage<
  'session.subscribed',
  {
    sessionId: string;
    subscriptionId: string;
  }
>;

export type SessionUnsubscribedResponse = WSMessage<
  'session.unsubscribed',
  {
    sessionId: string;
  }
>;

// ============================================================================
// Session Event Types (Non-Streaming)
// ============================================================================

/**
 * Event emitted when a session is created
 */
export type SessionCreatedEvent = WSMessage<
  'session.created',
  {
    sessionId: string;
    agentId: string;
    createdAt: string;
  }
>;

/**
 * Event emitted when a session message is received/processed
 */
export type SessionMessageEvent = WSMessage<
  'session.message',
  {
    sessionId: string;
    messageId: string;
    role: 'assistant' | 'user' | 'system';
    content: string;
    createdAt: string;
  }
>;

/**
 * Event emitted when a session is deleted
 */
export type SessionDeletedEvent = WSMessage<
  'session.deleted',
  {
    sessionId: string;
    deletedAt: string;
  }
>;

/**
 * Event emitted when a session is updated
 */
export type SessionUpdatedEvent = WSMessage<
  'session.updated',
  {
    sessionId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  }
>;

/**
 * Union type for all non-streaming session events
 */
export type SessionEvent =
  | SessionCreatedEvent
  | SessionMessageEvent
  | SessionDeletedEvent
  | SessionUpdatedEvent;

// ============================================================================
// Streaming Types
// ============================================================================

export type SessionStreamStart = WSMessage<
  'session.stream.start',
  {
    sessionId: string;
    runId: string;
    agentId: string;
    providerId: string;
    modelId: string;
  }
>;

export type SessionStreamDelta = WSMessage<
  'session.stream.delta',
  {
    sessionId: string;
    runId: string;
    delta: string;
    content: string;
  }
>;

export type SessionStreamToolCall = WSMessage<
  'session.stream.tool_call',
  {
    sessionId: string;
    runId: string;
    toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }
>;

export type SessionStreamUsage = WSMessage<
  'session.stream.usage',
  {
    sessionId: string;
    runId: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }
>;

export type SessionStreamEnd = WSMessage<
  'session.stream.end',
  {
    sessionId: string;
    runId: string;
    finishReason: string;
  }
>;

export type SessionStreamError = WSMessage<
  'session.stream.error',
  {
    sessionId: string;
    runId: string;
    error: {
      code: string;
      message: string;
    };
  }
>;

/** Live stdout/stderr chunk from an in-flight tool (e.g. exec_run). */
export type SessionStreamExecOutput = WSMessage<
  'session.stream.exec_output',
  {
    sessionId: string;
    runId: string;
    toolCallId: string;
    stream: 'stdout' | 'stderr';
    data: string;
  }
>;

/** A tool call was cancelled by the user. */
export type SessionStreamToolCancelled = WSMessage<
  'session.stream.tool_cancelled',
  {
    sessionId: string;
    runId: string;
    toolCallId: string;
  }
>;

/** The whole run was cancelled by the user ("Stop agent"). */
export type SessionStreamRunCancelled = WSMessage<
  'session.stream.run_cancelled',
  {
    sessionId: string;
    runId: string;
  }
>;

/**
 * Server-driven liveness heartbeat so the UI can show what the agent is doing
 * between other events ("Thinking…" / "Running <tool>… 12s"). At most one per
 * second per run (#378).
 */
export type SessionStreamActivity = WSMessage<
  'session.stream.activity',
  {
    sessionId: string;
    runId: string;
    phase: 'thinking' | 'running_tool';
    toolName?: string;
    elapsedMs: number;
  }
>;

export type SessionRunChoicesEvent = WSMessage<
  'session.run.choices',
  ChoicesEvent
>;

export type SessionStreamEvent =
  | SessionStreamStart
  | SessionStreamDelta
  | SessionStreamToolCall
  | SessionStreamExecOutput
  | SessionStreamToolCancelled
  | SessionStreamRunCancelled
  | SessionStreamActivity
  | SessionStreamUsage
  | SessionStreamEnd
  | SessionStreamError
  | SessionRunChoicesEvent;

/**
 * Acknowledgment response for streaming session.message request
 *
 * When a client sends session.message with stream: true, this response
 * is returned immediately to acknowledge the request and provide the runId.
 * The actual response content will be delivered via session.stream.* events.
 */
export type SessionMessageStreamAck = WSMessage<
  'session.message.ack',
  {
    sessionId: string;
    runId: string;
    status: 'streaming';
  }
>;

// ============================================================================
// Agent Types
// ============================================================================

export type AgentListRequest = WSMessage<'agent.list', Record<string, never>>;

export type AgentGetRequest = WSMessage<
  'agent.get',
  {
    agentId: string;
  }
>;

export type AgentListResponse = WSMessage<
  'agent.list',
  {
    agents: Array<{
      id: string;
      name: string;
      description?: string;
      tools: string[];
    }>;
  }
>;

export type AgentGetResponse = WSMessage<
  'agent.get',
  {
    agent: {
      id: string;
      name: string;
      description?: string;
      systemPrompt?: string;
      tools: string[];
      enabled: boolean;
    };
  }
>;

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderListRequest = WSMessage<
  'provider.list',
  Record<string, never>
>;

export type ProviderModelsRequest = WSMessage<
  'provider.models',
  {
    providerId: string;
  }
>;

export type ProviderListResponse = WSMessage<
  'provider.list',
  {
    providers: Array<{
      id: string;
      name: string;
      vendorFamily: string;
      capabilities: string[];
    }>;
  }
>;

export type ProviderModelsResponse = WSMessage<
  'provider.models',
  {
    providerId: string;
    models: Array<{
      id: string;
      name: string;
      capabilities?: string[];
    }>;
  }
>;

// ============================================================================
// Node Types
// ============================================================================

export type NodeType = 'mobile' | 'desktop' | 'browser' | 'channel' | 'service';

export type NodeListRequest = WSMessage<'node.list', Record<string, never>>;

export type NodeDescribeRequest = WSMessage<
  'node.describe',
  {
    nodeId: string;
  }
>;

export type NodeInvokeRequest = WSMessage<
  'node.invoke',
  {
    nodeId: string;
    capability: string;
    params: Record<string, unknown>;
  }
>;

export type NodeRegisterRequest = WSMessage<
  'node.register',
  {
    nodeId: string;
    capabilities: string[];
    metadata?: Record<string, unknown>;
    pairingCode?: string;
  }
>;

export type NodeRegisteredResponse = WSMessage<
  'node.registered',
  {
    nodeId: string;
    token: string;
    expiresAt: string;
  }
>;

export type NodeInvokedResponse = WSMessage<
  'node.invoked',
  {
    nodeId: string;
    capability: string;
    result: unknown;
    error?: WSError;
  }
>;

/**
 * Node RPC request - sent from server to node for invocation
 *
 * This is the envelope sent to the target node when a client calls node.invoke.
 * The node should respond with node.rpc.response or node.rpc.error.
 */
export type NodeRpcRequest = WSMessage<
  'node.rpc.request',
  {
    invocationId: string;
    capability: string;
    params: Record<string, unknown>;
    timeout?: number;
  }
>;

/**
 * Node RPC response - sent from node to server on successful invocation
 */
export type NodeRpcResponse = WSMessage<
  'node.rpc.response',
  {
    invocationId: string;
    result: unknown;
    duration: number;
  }
>;

/**
 * Node RPC error - sent from node to server on failed invocation
 */
export type NodeRpcError = WSMessage<
  'node.rpc.error',
  {
    invocationId: string;
    error: WSError;
  }
>;

// Note: NodeOnlineEvent and NodeOfflineEvent are defined later in the Node Event Types section

// ============================================================================
// Pairing Types
// ============================================================================

export type PairingRequest = WSMessage<
  'pairing.request',
  {
    deviceName: string;
    deviceType: NodeType;
    capabilities: string[];
  }
>;

export type PairingApproveRequest = WSMessage<
  'pairing.approve',
  {
    requestId: string;
    scopes?: string[];
  }
>;

export type PairingDenyRequest = WSMessage<
  'pairing.deny',
  {
    requestId: string;
  }
>;

// Note: PairingRequestedEvent is defined later in the Pairing Event Types section

export type PairingApprovedResponse = WSMessage<
  'pairing.approved',
  {
    requestId: string;
    nodeId: string;
    token: string;
  }
>;

// ============================================================================
// Configuration Types
// ============================================================================

export type ConfigGetRequest = WSMessage<
  'config.get',
  {
    path?: string;
  }
>;

export type ConfigUpdateRequest = WSMessage<
  'config.update',
  {
    updates: Record<string, unknown>;
  }
>;

/**
 * Event emitted when configuration is updated
 */
export type ConfigUpdatedEvent = WSMessage<
  'config.updated',
  {
    updates: Record<string, unknown>;
    updatedAt: string;
    updatedBy?: string;
  }
>;

/**
 * Event emitted when configuration is reloaded
 */
export type ConfigReloadedEvent = WSMessage<
  'config.reloaded',
  {
    config: Record<string, unknown>;
    reloadedAt: string;
  }
>;

/**
 * Event emitted when configuration validation fails
 */
export type ConfigValidationErrorEvent = WSMessage<
  'config.validation_error',
  {
    errors: string[];
    occurredAt: string;
  }
>;

/**
 * Union type for all configuration events
 */
export type ConfigEvent =
  | ConfigUpdatedEvent
  | ConfigReloadedEvent
  | ConfigValidationErrorEvent;

// ============================================================================
// Presence Types
// ============================================================================

export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export type PresenceUpdateRequest = WSMessage<
  'presence.update',
  {
    status: PresenceStatus;
    metadata?: Record<string, unknown>;
  }
>;

export type PresenceChangedEvent = WSMessage<
  'presence.changed',
  {
    clientId: string;
    status: PresenceStatus;
    metadata?: Record<string, unknown>;
  }
>;

/**
 * Event emitted when a client comes online
 */
export type PresenceOnlineEvent = WSMessage<
  'presence.online',
  {
    clientId: string;
    connectionId?: string;
    metadata?: Record<string, unknown>;
    onlineAt: string;
  }
>;

/**
 * Event emitted when a client goes offline
 */
export type PresenceOfflineEvent = WSMessage<
  'presence.offline',
  {
    clientId: string;
    connectionId?: string;
    offlineAt: string;
    reason?: string;
  }
>;

/**
 * Event emitted when a connection subscribes to presence updates
 */
export type PresenceSubscribedEvent = WSMessage<
  'presence.subscribed',
  {
    connectionId: string;
    subscribedAt: string;
  }
>;

/**
 * Event emitted when a connection unsubscribes from presence updates
 */
export type PresenceUnsubscribedEvent = WSMessage<
  'presence.unsubscribed',
  {
    connectionId: string;
    unsubscribedAt: string;
  }
>;

/**
 * Union type for all presence events
 */
export type PresenceEvent =
  | PresenceChangedEvent
  | PresenceOnlineEvent
  | PresenceOfflineEvent
  | PresenceSubscribedEvent
  | PresenceUnsubscribedEvent;

// ============================================================================
// Error Response
// ============================================================================

export type ErrorResponse = WSMessage<
  'error',
  {
    requestId: string;
    error: WSError;
  }
>;

// ============================================================================
// Request Union Types
// ============================================================================

export type WSRequest =
  | AuthAuthenticateRequest
  | AuthRefreshRequest
  | SessionCreateRequest
  | SessionGetRequest
  | SessionListRequest
  | SessionDeleteRequest
  | SessionMessageRequest
  | SessionSubscribeRequest
  | SessionUnsubscribeRequest
  | SessionToolCancelRequest
  | SessionRunCancelRequest
  | SessionMessagesRequest
  | SessionRunsRequest
  | AgentListRequest
  | AgentGetRequest
  | ProviderListRequest
  | ProviderModelsRequest
  | ConfigGetRequest
  | ConfigUpdateRequest
  | NodeListRequest
  | NodeDescribeRequest
  | NodeInvokeRequest
  | NodeRegisterRequest
  | PairingRequest
  | PairingApproveRequest
  | PairingDenyRequest
  | PresenceUpdateRequest;

export type WSRequestType = WSRequest['type'];

// ============================================================================
// Response Union Types
// ============================================================================

export type WSResponse =
  | AuthAuthenticatedResponse
  | SessionCreatedResponse
  | SessionMessageResponse
  | SessionMessageStreamAck
  | SessionMessagesResponse
  | SessionRunsResponse
  | SessionGetResponse
  | SessionListResponse
  | SessionDeleteResponse
  | SessionSubscribedResponse
  | SessionUnsubscribedResponse
  | SessionUpdatedEvent
  | SessionStreamEvent
  | AgentListResponse
  | AgentGetResponse
  | ProviderListResponse
  | ProviderModelsResponse
  | NodeRegisteredResponse
  | NodeInvokedResponse
  | NodeOnlineEvent
  | NodeOfflineEvent
  | PairingRequestedEvent
  | PairingApprovedResponse
  | ConfigUpdatedEvent
  | ConfigReloadedEvent
  | ConfigValidationErrorEvent
  | PresenceChangedEvent
  | PresenceOnlineEvent
  | PresenceOfflineEvent
  | PresenceSubscribedEvent
  | PresenceUnsubscribedEvent
  | ErrorResponse;

export type WSResponseType = WSResponse['type'];

// ============================================================================
// Type Guards
// ============================================================================

const REQUEST_TYPES: Set<string> = new Set([
  'auth.authenticate',
  'auth.refresh',
  'session.create',
  'session.get',
  'session.list',
  'session.delete',
  'session.message',
  'session.messages',
  'session.runs',
  'session.subscribe',
  'session.unsubscribe',
  'session.tool.cancel',
  'session.run.cancel',
  'agent.list',
  'agent.get',
  'provider.list',
  'provider.models',
  'config.get',
  'config.update',
  'node.list',
  'node.describe',
  'node.invoke',
  'node.register',
  'pairing.request',
  'pairing.approve',
  'pairing.deny',
  'presence.update',
]);

const RESPONSE_TYPES: Set<string> = new Set([
  'auth.authenticated',
  'session.created',
  'session.message',
  'session.message.ack',
  'session.messages',
  'session.runs',
  'session.get',
  'session.list',
  'session.delete',
  'session.subscribed',
  'session.unsubscribed',
  'session.stream.start',
  'session.stream.delta',
  'session.stream.tool_call',
  'session.stream.exec_output',
  'session.stream.tool_cancelled',
  'session.stream.run_cancelled',
  'session.stream.activity',
  'session.stream.usage',
  'session.stream.end',
  'session.stream.error',
  'session.updated',
  'agent.list',
  'agent.get',
  'provider.list',
  'provider.models',
  'node.registered',
  'node.invoked',
  'node.online',
  'node.offline',
  'pairing.requested',
  'pairing.approved',
  'config.updated',
  'config.reloaded',
  'config.validation_error',
  'presence.changed',
  'presence.online',
  'presence.offline',
  'presence.subscribed',
  'presence.unsubscribed',
  'error',
]);

const STREAM_EVENT_TYPES: Set<string> = new Set([
  'session.stream.start',
  'session.stream.delta',
  'session.stream.tool_call',
  'session.stream.exec_output',
  'session.stream.tool_cancelled',
  'session.stream.run_cancelled',
  'session.stream.activity',
  'session.stream.usage',
  'session.stream.end',
  'session.stream.error',
  'session.run.choices',
]);

/**
 * Check if a value is a valid WSMessage
 */
export function isWSMessage(value: unknown): value is WSMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  return (
    typeof msg.id === 'string' &&
    typeof msg.type === 'string' &&
    typeof msg.timestamp === 'string' &&
    'payload' in msg
  );
}

/**
 * Check if a value is a valid WSError
 */
export function isWSError(value: unknown): value is WSError {
  if (typeof value !== 'object' || value === null) return false;
  const err = value as Record<string, unknown>;
  return typeof err.code === 'string' && typeof err.message === 'string';
}

/**
 * Check if a message type is a request type
 */
export function isRequestType(type: string): type is WSRequestType {
  return REQUEST_TYPES.has(type);
}

/**
 * Check if a message type is a response type
 */
export function isResponseType(type: string): type is WSResponseType {
  return RESPONSE_TYPES.has(type);
}

/**
 * Check if a message type is a stream event type
 */
export function isStreamEventType(
  type: string,
): type is SessionStreamEvent['type'] {
  return STREAM_EVENT_TYPES.has(type);
}

/**
 * Check if a message is a WSRequest
 */
export function isWSRequest(msg: unknown): msg is WSRequest {
  return isWSMessage(msg) && isRequestType(msg.type);
}

/**
 * Check if a message is a WSResponse
 */
export function isWSResponse(msg: unknown): msg is WSResponse {
  return isWSMessage(msg) && isResponseType(msg.type);
}

/**
 * Check if a message is a SessionStreamEvent
 */
export function isSessionStreamEvent(msg: unknown): msg is SessionStreamEvent {
  return isWSMessage(msg) && isStreamEventType(msg.type);
}

/**
 * Check if a message is an ErrorResponse
 */
export function isErrorResponse(msg: unknown): msg is ErrorResponse {
  return isWSMessage(msg) && msg.type === 'error';
}

// ============================================================================
// Session Event Type Guards
// ============================================================================

const SESSION_EVENT_TYPES: Set<string> = new Set([
  'session.created',
  'session.message',
  'session.deleted',
  'session.updated',
]);

/**
 * Check if a message type is a session event type
 */
export function isSessionEventType(type: string): type is SessionEvent['type'] {
  return SESSION_EVENT_TYPES.has(type);
}

/**
 * Check if a message is a SessionEvent
 */
export function isSessionEvent(msg: unknown): msg is SessionEvent {
  return isWSMessage(msg) && isSessionEventType(msg.type);
}

/**
 * Check if a message is a SessionCreatedEvent
 */
export function isSessionCreatedEvent(
  msg: unknown,
): msg is SessionCreatedEvent {
  return isWSMessage(msg) && msg.type === 'session.created';
}

/**
 * Check if a message is a SessionMessageEvent
 */
export function isSessionMessageEvent(
  msg: unknown,
): msg is SessionMessageEvent {
  return isWSMessage(msg) && msg.type === 'session.message';
}

/**
 * Check if a message is a SessionDeletedEvent
 */
export function isSessionDeletedEvent(
  msg: unknown,
): msg is SessionDeletedEvent {
  return isWSMessage(msg) && msg.type === 'session.deleted';
}

/**
 * Check if a message is a SessionUpdatedEvent
 */
export function isSessionUpdatedEvent(
  msg: unknown,
): msg is SessionUpdatedEvent {
  return isWSMessage(msg) && msg.type === 'session.updated';
}

// ============================================================================
// Session Stream Event Type Guards
// ============================================================================

/**
 * Check if a message is a SessionStreamStart
 */
export function isSessionStreamStart(msg: unknown): msg is SessionStreamStart {
  return isWSMessage(msg) && msg.type === 'session.stream.start';
}

/**
 * Check if a message is a SessionStreamDelta
 */
export function isSessionStreamDelta(msg: unknown): msg is SessionStreamDelta {
  return isWSMessage(msg) && msg.type === 'session.stream.delta';
}

/**
 * Check if a message is a SessionStreamToolCall
 */
export function isSessionStreamToolCall(
  msg: unknown,
): msg is SessionStreamToolCall {
  return isWSMessage(msg) && msg.type === 'session.stream.tool_call';
}

/**
 * Check if a message is a SessionStreamUsage
 */
export function isSessionStreamUsage(msg: unknown): msg is SessionStreamUsage {
  return isWSMessage(msg) && msg.type === 'session.stream.usage';
}

/**
 * Check if a message is a SessionStreamEnd
 */
export function isSessionStreamEnd(msg: unknown): msg is SessionStreamEnd {
  return isWSMessage(msg) && msg.type === 'session.stream.end';
}

/**
 * Check if a message is a SessionStreamError
 */
export function isSessionStreamError(msg: unknown): msg is SessionStreamError {
  return isWSMessage(msg) && msg.type === 'session.stream.error';
}

/**
 * Check if a message is a SessionRunChoicesEvent
 */
export function isSessionRunChoicesEvent(
  msg: unknown,
): msg is SessionRunChoicesEvent {
  return isWSMessage(msg) && msg.type === 'session.run.choices';
}

// ============================================================================
// Agent Event Types
// ============================================================================

/**
 * Event emitted when an agent is registered/created
 */
export type AgentCreatedEvent = WSMessage<
  'agent.created',
  {
    agentId: string;
    name: string;
    model: string;
    createdAt: string;
  }
>;

/**
 * Event emitted when an agent is updated
 */
export type AgentUpdatedEvent = WSMessage<
  'agent.updated',
  {
    agentId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  }
>;

/**
 * Event emitted when an agent is deleted
 */
export type AgentDeletedEvent = WSMessage<
  'agent.deleted',
  {
    agentId: string;
    deletedAt: string;
  }
>;

/**
 * Event emitted when an agent is enabled
 */
export type AgentEnabledEvent = WSMessage<
  'agent.enabled',
  {
    agentId: string;
    enabledAt: string;
  }
>;

/**
 * Event emitted when an agent is disabled
 */
export type AgentDisabledEvent = WSMessage<
  'agent.disabled',
  {
    agentId: string;
    disabledAt: string;
  }
>;

/**
 * Union type for all agent events
 */
export type AgentEvent =
  | AgentCreatedEvent
  | AgentUpdatedEvent
  | AgentDeletedEvent
  | AgentEnabledEvent
  | AgentDisabledEvent;

// ============================================================================
// Agent Event Type Guards
// ============================================================================

const AGENT_EVENT_TYPES: Set<string> = new Set([
  'agent.created',
  'agent.updated',
  'agent.deleted',
  'agent.enabled',
  'agent.disabled',
]);

/**
 * Check if a message type is an agent event type
 */
export function isAgentEventType(type: string): type is AgentEvent['type'] {
  return AGENT_EVENT_TYPES.has(type);
}

/**
 * Check if a message is an AgentEvent
 */
export function isAgentEvent(msg: unknown): msg is AgentEvent {
  return isWSMessage(msg) && isAgentEventType(msg.type);
}

/**
 * Check if a message is an AgentCreatedEvent
 */
export function isAgentCreatedEvent(msg: unknown): msg is AgentCreatedEvent {
  return isWSMessage(msg) && msg.type === 'agent.created';
}

/**
 * Check if a message is an AgentUpdatedEvent
 */
export function isAgentUpdatedEvent(msg: unknown): msg is AgentUpdatedEvent {
  return isWSMessage(msg) && msg.type === 'agent.updated';
}

/**
 * Check if a message is an AgentDeletedEvent
 */
export function isAgentDeletedEvent(msg: unknown): msg is AgentDeletedEvent {
  return isWSMessage(msg) && msg.type === 'agent.deleted';
}

/**
 * Check if a message is an AgentEnabledEvent
 */
export function isAgentEnabledEvent(msg: unknown): msg is AgentEnabledEvent {
  return isWSMessage(msg) && msg.type === 'agent.enabled';
}

/**
 * Check if a message is an AgentDisabledEvent
 */
export function isAgentDisabledEvent(msg: unknown): msg is AgentDisabledEvent {
  return isWSMessage(msg) && msg.type === 'agent.disabled';
}

// ============================================================================
// Provider Event Types
// ============================================================================

/**
 * Event emitted when a provider is registered
 */
export type ProviderRegisteredEvent = WSMessage<
  'provider.registered',
  {
    providerId: string;
    name: string;
    vendorFamily: string;
    capabilities: string[];
    registeredAt: string;
  }
>;

/**
 * Event emitted when a provider is updated
 */
export type ProviderUpdatedEvent = WSMessage<
  'provider.updated',
  {
    providerId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  }
>;

/**
 * Event emitted when a provider is unregistered
 */
export type ProviderUnregisteredEvent = WSMessage<
  'provider.unregistered',
  {
    providerId: string;
    unregisteredAt: string;
  }
>;

/**
 * Event emitted when a model is added to a provider
 */
export type ModelAddedEvent = WSMessage<
  'model.added',
  {
    providerId: string;
    modelId: string;
    name: string;
    capabilities?: string[];
    addedAt: string;
  }
>;

/**
 * Union type for all provider events
 */
export type ProviderEvent =
  | ProviderRegisteredEvent
  | ProviderUpdatedEvent
  | ProviderUnregisteredEvent
  | ModelAddedEvent;

// ============================================================================
// Provider Event Type Guards
// ============================================================================

const PROVIDER_EVENT_TYPES: Set<string> = new Set([
  'provider.registered',
  'provider.updated',
  'provider.unregistered',
  'model.added',
]);

/**
 * Check if a message type is a provider event type
 */
export function isProviderEventType(
  type: string,
): type is ProviderEvent['type'] {
  return PROVIDER_EVENT_TYPES.has(type);
}

/**
 * Check if a message is a ProviderEvent
 */
export function isProviderEvent(msg: unknown): msg is ProviderEvent {
  return isWSMessage(msg) && isProviderEventType(msg.type);
}

/**
 * Check if a message is a ProviderRegisteredEvent
 */
export function isProviderRegisteredEvent(
  msg: unknown,
): msg is ProviderRegisteredEvent {
  return isWSMessage(msg) && msg.type === 'provider.registered';
}

/**
 * Check if a message is a ProviderUpdatedEvent
 */
export function isProviderUpdatedEvent(
  msg: unknown,
): msg is ProviderUpdatedEvent {
  return isWSMessage(msg) && msg.type === 'provider.updated';
}

/**
 * Check if a message is a ProviderUnregisteredEvent
 */
export function isProviderUnregisteredEvent(
  msg: unknown,
): msg is ProviderUnregisteredEvent {
  return isWSMessage(msg) && msg.type === 'provider.unregistered';
}

/**
 * Check if a message is a ModelAddedEvent
 */
export function isModelAddedEvent(msg: unknown): msg is ModelAddedEvent {
  return isWSMessage(msg) && msg.type === 'model.added';
}

// ============================================================================
// Node Event Types
// ============================================================================

/**
 * Event emitted when a node is registered
 */
export type NodeRegisteredEvent = WSMessage<
  'node.registered',
  {
    nodeId: string;
    name: string;
    type: string;
    capabilities: string[];
    registeredAt: string;
  }
>;

/**
 * Event emitted when a node comes online
 */
export type NodeOnlineEvent = WSMessage<
  'node.online',
  {
    nodeId: string;
    capabilities: string[];
    metadata?: Record<string, unknown>;
    onlineAt: string;
  }
>;

/**
 * Event emitted when a node goes offline
 */
export type NodeOfflineEvent = WSMessage<
  'node.offline',
  {
    nodeId: string;
    offlineAt: string;
  }
>;

/**
 * Event emitted when a node is invoked
 */
export type NodeInvokedEvent = WSMessage<
  'node.invoked',
  {
    nodeId: string;
    capability: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: WSError;
    invokedAt: string;
  }
>;

/**
 * Event emitted when a node is updated
 */
export type NodeUpdatedEvent = WSMessage<
  'node.updated',
  {
    nodeId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  }
>;

/**
 * Event emitted when a node is unregistered
 */
export type NodeUnregisteredEvent = WSMessage<
  'node.unregistered',
  {
    nodeId: string;
    unregisteredAt: string;
  }
>;

/**
 * Union type for all node events
 */
export type NodeEvent =
  | NodeRegisteredEvent
  | NodeOnlineEvent
  | NodeOfflineEvent
  | NodeInvokedEvent
  | NodeUpdatedEvent
  | NodeUnregisteredEvent;

// ============================================================================
// Node Event Type Guards
// ============================================================================

const NODE_EVENT_TYPES: Set<string> = new Set([
  'node.registered',
  'node.online',
  'node.offline',
  'node.invoked',
  'node.updated',
  'node.unregistered',
]);

/**
 * Check if a message type is a node event type
 */
export function isNodeEventType(type: string): type is NodeEvent['type'] {
  return NODE_EVENT_TYPES.has(type);
}

/**
 * Check if a message is a NodeEvent
 */
export function isNodeEvent(msg: unknown): msg is NodeEvent {
  return isWSMessage(msg) && isNodeEventType(msg.type);
}

/**
 * Check if a message is a NodeRegisteredEvent
 */
export function isNodeRegisteredEvent(
  msg: unknown,
): msg is NodeRegisteredEvent {
  return isWSMessage(msg) && msg.type === 'node.registered';
}

/**
 * Check if a message is a NodeOnlineEvent
 */
export function isNodeOnlineEvent(msg: unknown): msg is NodeOnlineEvent {
  return isWSMessage(msg) && msg.type === 'node.online';
}

/**
 * Check if a message is a NodeOfflineEvent
 */
export function isNodeOfflineEvent(msg: unknown): msg is NodeOfflineEvent {
  return isWSMessage(msg) && msg.type === 'node.offline';
}

/**
 * Check if a message is a NodeInvokedEvent
 */
export function isNodeInvokedEvent(msg: unknown): msg is NodeInvokedEvent {
  return isWSMessage(msg) && msg.type === 'node.invoked';
}

/**
 * Check if a message is a NodeUpdatedEvent
 */
export function isNodeUpdatedEvent(msg: unknown): msg is NodeUpdatedEvent {
  return isWSMessage(msg) && msg.type === 'node.updated';
}

/**
 * Check if a message is a NodeUnregisteredEvent
 */
export function isNodeUnregisteredEvent(
  msg: unknown,
): msg is NodeUnregisteredEvent {
  return isWSMessage(msg) && msg.type === 'node.unregistered';
}

// ============================================================================
// Pairing Event Types
// ============================================================================

/**
 * Event emitted when a pairing request is made
 */
export type PairingRequestedEvent = WSMessage<
  'pairing.requested',
  {
    requestId: string;
    pairingCode: string;
    deviceName: string;
    deviceType: string;
    capabilities: string[];
    requestedAt: string;
  }
>;

/**
 * Event emitted when a pairing request is approved
 */
export type PairingApprovedEvent = WSMessage<
  'pairing.approved',
  {
    requestId: string;
    nodeId: string;
    token: string;
    scopes: string[];
    approvedAt: string;
  }
>;

/**
 * Event emitted when a pairing request is denied
 */
export type PairingDeniedEvent = WSMessage<
  'pairing.denied',
  {
    requestId: string;
    deniedAt: string;
  }
>;

/**
 * Union type for all pairing events
 */
export type PairingEvent =
  | PairingRequestedEvent
  | PairingApprovedEvent
  | PairingDeniedEvent;

// ============================================================================
// Pairing Event Type Guards
// ============================================================================

const PAIRING_EVENT_TYPES: Set<string> = new Set([
  'pairing.requested',
  'pairing.approved',
  'pairing.denied',
]);

/**
 * Check if a message type is a pairing event type
 */
export function isPairingEventType(type: string): type is PairingEvent['type'] {
  return PAIRING_EVENT_TYPES.has(type);
}

/**
 * Check if a message is a PairingEvent
 */
export function isPairingEvent(msg: unknown): msg is PairingEvent {
  return isWSMessage(msg) && isPairingEventType(msg.type);
}

/**
 * Check if a message is a PairingRequestedEvent
 */
export function isPairingRequestedEvent(
  msg: unknown,
): msg is PairingRequestedEvent {
  return isWSMessage(msg) && msg.type === 'pairing.requested';
}

/**
 * Check if a message is a PairingApprovedEvent
 */
export function isPairingApprovedEvent(
  msg: unknown,
): msg is PairingApprovedEvent {
  return isWSMessage(msg) && msg.type === 'pairing.approved';
}

/**
 * Check if a message is a PairingDeniedEvent
 */
export function isPairingDeniedEvent(msg: unknown): msg is PairingDeniedEvent {
  return isWSMessage(msg) && msg.type === 'pairing.denied';
}

// ============================================================================
// Configuration Event Type Guards
// ============================================================================

const CONFIG_EVENT_TYPES: Set<string> = new Set([
  'config.updated',
  'config.reloaded',
  'config.validation_error',
]);

/**
 * Check if a message type is a config event type
 */
export function isConfigEventType(type: string): type is ConfigEvent['type'] {
  return CONFIG_EVENT_TYPES.has(type);
}

/**
 * Check if a message is a ConfigEvent
 */
export function isConfigEvent(msg: unknown): msg is ConfigEvent {
  return isWSMessage(msg) && isConfigEventType(msg.type);
}

/**
 * Check if a message is a ConfigUpdatedEvent
 */
export function isConfigUpdatedEvent(msg: unknown): msg is ConfigUpdatedEvent {
  return isWSMessage(msg) && msg.type === 'config.updated';
}

/**
 * Check if a message is a ConfigReloadedEvent
 */
export function isConfigReloadedEvent(
  msg: unknown,
): msg is ConfigReloadedEvent {
  return isWSMessage(msg) && msg.type === 'config.reloaded';
}

/**
 * Check if a message is a ConfigValidationErrorEvent
 */
export function isConfigValidationErrorEvent(
  msg: unknown,
): msg is ConfigValidationErrorEvent {
  return isWSMessage(msg) && msg.type === 'config.validation_error';
}

// ============================================================================
// Presence Event Type Guards
// ============================================================================

const PRESENCE_EVENT_TYPES: Set<string> = new Set([
  'presence.changed',
  'presence.online',
  'presence.offline',
  'presence.subscribed',
  'presence.unsubscribed',
]);

/**
 * Check if a message type is a presence event type
 */
export function isPresenceEventType(
  type: string,
): type is PresenceEvent['type'] {
  return PRESENCE_EVENT_TYPES.has(type);
}

/**
 * Check if a message is a PresenceEvent
 */
export function isPresenceEvent(msg: unknown): msg is PresenceEvent {
  return isWSMessage(msg) && isPresenceEventType(msg.type);
}

/**
 * Check if a message is a PresenceChangedEvent
 */
export function isPresenceChangedEvent(
  msg: unknown,
): msg is PresenceChangedEvent {
  return isWSMessage(msg) && msg.type === 'presence.changed';
}

/**
 * Check if a message is a PresenceOnlineEvent
 */
export function isPresenceOnlineEvent(
  msg: unknown,
): msg is PresenceOnlineEvent {
  return isWSMessage(msg) && msg.type === 'presence.online';
}

/**
 * Check if a message is a PresenceOfflineEvent
 */
export function isPresenceOfflineEvent(
  msg: unknown,
): msg is PresenceOfflineEvent {
  return isWSMessage(msg) && msg.type === 'presence.offline';
}

/**
 * Check if a message is a PresenceSubscribedEvent
 */
export function isPresenceSubscribedEvent(
  msg: unknown,
): msg is PresenceSubscribedEvent {
  return isWSMessage(msg) && msg.type === 'presence.subscribed';
}

/**
 * Check if a message is a PresenceUnsubscribedEvent
 */
export function isPresenceUnsubscribedEvent(
  msg: unknown,
): msg is PresenceUnsubscribedEvent {
  return isWSMessage(msg) && msg.type === 'presence.unsubscribed';
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a WSMessage structure
 *
 * Returns the message if valid, or creates an error object if invalid.
 */
export function validateWSMessage(data: unknown): WSMessage | WSError {
  if (!isWSMessage(data)) {
    return {
      code: WS_ERROR_CODES.INVALID_REQUEST,
      message: 'Invalid message structure',
      details: { received: typeof data },
    };
  }

  // Validate timestamp is ISO 8601
  const timestamp = Date.parse(data.timestamp);
  if (isNaN(timestamp)) {
    return {
      code: WS_ERROR_CODES.INVALID_PAYLOAD,
      message: 'Invalid timestamp format',
      details: { timestamp: data.timestamp },
    };
  }

  return data;
}

/**
 * Create a new WSMessage with generated ID and timestamp
 */
export function createWSMessage<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  id?: string,
): WSMessage<TType, TPayload> {
  return {
    id: id ?? crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/**
 * Create an error response message
 */
export function createErrorResponse(
  requestId: string,
  code: WSErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  const error: WSError = {
    code,
    message,
  };
  if (details !== undefined) {
    error.details = details;
  }
  return createWSMessage('error', {
    requestId,
    error,
  });
}

/**
 * Create a WSError object
 */
export function createWSError(
  code: WSErrorCode,
  message: string,
  details?: Record<string, unknown>,
): WSError {
  const error: WSError = {
    code,
    message,
  };
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}
