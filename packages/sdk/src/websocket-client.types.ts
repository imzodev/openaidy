/**
 * WebSocket Client SDK Types
 *
 * Type definitions for the WebSocket client SDK.
 */

import type {
  WSMessage,
  WSResponse,
  SessionCreatedResponse,
  SessionMessageResponse,
  AgentListResponse,
  ProviderListResponse,
  PresenceStatus,
  ClientType,
} from '@openaidy/shared-types';

// ============================================================================
// Client Options
// ============================================================================

/**
 * WebSocket client configuration options
 */
export type WebSocketClientOptions = {
  /** WebSocket server URL (e.g., ws://localhost:3000/ws) */
  url: string;
  /** Authentication token (JWT) */
  token?: string;
  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean;
  /** Reconnection interval in milliseconds (default: 1000) */
  reconnectInterval?: number;
  /** Maximum reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatInterval?: number;
  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;
  /** Custom logger */
  logger?: Logger;
  /** Client ID for presence tracking */
  clientId?: string;
  /** Client type for capability presets (web, cli, mobile, channel) */
  clientType?: ClientType;
  /** Client version string */
  clientVersion?: string;
  /** Additional client metadata */
  clientMeta?: Record<string, unknown>;
};

/**
 * Default client options
 *
 * `url` has no default — callers MUST supply it (per port-config-refactor:
 * no hardcoded port fallbacks in business code). The remaining fields are
 * protocol-level tunables (reconnect, heartbeat, timeout) which are stable
 * across deployments.
 */
export const defaultWebSocketClientOptions: Required<
  Omit<
    WebSocketClientOptions,
    | 'url'
    | 'token'
    | 'logger'
    | 'clientId'
    | 'clientType'
    | 'clientVersion'
    | 'clientMeta'
  >
> = {
  autoReconnect: true,
  reconnectInterval: 1000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
  requestTimeout: 30000,
};

// ============================================================================
// Client State
// ============================================================================

/**
 * WebSocket client connection state
 */
export type WebSocketClientState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'reconnecting';

// ============================================================================
// Event Types
// ============================================================================

/**
 * Generic event handler
 */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * Error handler
 */
export type ErrorHandler = (error: Error) => void;

/**
 * State change handler
 */
export type StateChangeHandler = (state: WebSocketClientState) => void;

/**
 * Connection established event
 */
export type ConnectionEstablishedEvent = {
  connectionId: string;
  heartbeatInterval: number;
};

/**
 * Session event
 */
export type SessionEvent = {
  type: 'session.created' | 'session.updated' | 'session.deleted';
  sessionId: string;
  data?: unknown;
};

/**
 * Presence changed event
 */
export type PresenceChangedEvent = {
  type: 'presence.changed';
  clientId: string;
  status: PresenceStatus;
  metadata?: Record<string, unknown>;
};

/**
 * Config updated event
 */
export type ConfigUpdatedEvent = {
  type: 'config.updated';
  updates: Record<string, unknown>;
  updatedAt: string;
};

/**
 * All client events
 */
export type ClientEvent =
  | ConnectionEstablishedEvent
  | SessionEvent
  | PresenceChangedEvent
  | ConfigUpdatedEvent;

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Pending request tracking
 */
export type PendingRequest<T = unknown> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  createdAt: number;
};

/**
 * Session creation options
 */
export type SessionCreateOptions = {
  agentId?: string;
  providerId?: string;
  modelId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Message options
 */
export type MessageOptions = {
  stream?: boolean;
  agentId?: string;
  providerId?: string;
  modelId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Agent query filter
 */
export type AgentQueryFilter = {
  status?: string;
  capability?: string;
  tags?: string[];
};

// ============================================================================
// Logger
// ============================================================================

/**
 * Logger interface
 */
export type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
};

/**
 * No-op logger (default)
 */
export const noopLogger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

// ============================================================================
// Re-export shared types
// ============================================================================

export type {
  WSMessage,
  WSResponse,
  SessionCreatedResponse,
  SessionMessageResponse,
  AgentListResponse,
  ProviderListResponse,
  PresenceStatus,
};
