/**
 * WebSocket Message Types for OpenAidy
 *
 * This file contains all shared types for WebSocket communication
 * between the server and client SDKs.
 */

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
  SESSIONS_READ: 'sessions.read',
  SESSIONS_WRITE: 'sessions.write',
  SESSIONS_STREAM: 'sessions.stream',
  SESSIONS_DELETE: 'sessions.delete',

  // Agent capabilities
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

export type WSCapability = (typeof WS_CAPABILITIES)[keyof typeof WS_CAPABILITIES];

// ============================================================================
// Authentication Types
// ============================================================================

export type AuthAuthenticateRequest = WSMessage<
  'auth.authenticate',
  {
    token?: string;
    apiKey?: string;
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

export type SessionMessageRequest = WSMessage<
  'session.message',
  {
    sessionId: string;
    role: 'user' | 'system';
    content: string;
    stream?: boolean;
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

export type SessionStreamEvent =
  | SessionStreamStart
  | SessionStreamDelta
  | SessionStreamToolCall
  | SessionStreamUsage
  | SessionStreamEnd
  | SessionStreamError;

// ============================================================================
// Agent Types
// ============================================================================

export type AgentListRequest = WSMessage<
  'agent.list',
  Record<string, never>
>;

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
      capabilities: string[];
    }>;
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

// ============================================================================
// Node Types
// ============================================================================

export type NodeType = 'mobile' | 'desktop' | 'browser' | 'channel' | 'service';

export type NodeListRequest = WSMessage<
  'node.list',
  Record<string, never>
>;

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

export type NodeOnlineEvent = WSMessage<
  'node.online',
  {
    nodeId: string;
    capabilities: string[];
    metadata?: Record<string, unknown>;
  }
>;

export type NodeOfflineEvent = WSMessage<
  'node.offline',
  {
    nodeId: string;
  }
>;

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

export type PairingRequestedEvent = WSMessage<
  'pairing.requested',
  {
    requestId: string;
    pairingCode: string;
    deviceName: string;
    deviceType: NodeType;
    capabilities: string[];
    requestedAt: string;
  }
>;

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

export type ConfigUpdatedEvent = WSMessage<
  'config.updated',
  {
    updates: Record<string, unknown>;
    updatedAt: string;
  }
>;

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
  | SessionStreamEvent
  | AgentListResponse
  | ProviderListResponse
  | NodeRegisteredResponse
  | NodeInvokedResponse
  | NodeOnlineEvent
  | NodeOfflineEvent
  | PairingRequestedEvent
  | PairingApprovedResponse
  | ConfigUpdatedEvent
  | PresenceChangedEvent
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
  'session.subscribe',
  'session.unsubscribe',
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
  'session.stream.start',
  'session.stream.delta',
  'session.stream.tool_call',
  'session.stream.usage',
  'session.stream.end',
  'session.stream.error',
  'agent.list',
  'provider.list',
  'node.registered',
  'node.invoked',
  'node.online',
  'node.offline',
  'pairing.requested',
  'pairing.approved',
  'config.updated',
  'presence.changed',
  'error',
]);

const STREAM_EVENT_TYPES: Set<string> = new Set([
  'session.stream.start',
  'session.stream.delta',
  'session.stream.tool_call',
  'session.stream.usage',
  'session.stream.end',
  'session.stream.error',
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
export function isStreamEventType(type: string): type is SessionStreamEvent['type'] {
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
