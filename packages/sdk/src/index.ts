/**
 * SDK Package
 *
 * Exports for the OpenAidy SDK.
 */

// WebSocket Client SDK
export { WebSocketClient, createWebSocketClient } from './websocket-client';
export {
  type WebSocketClientOptions,
  type WebSocketClientState,
  type EventHandler,
  type ErrorHandler,
  type StateChangeHandler,
  type PendingRequest,
  type SessionCreateOptions,
  type MessageOptions,
  type AgentQueryFilter,
  type Logger,
  type ConnectionEstablishedEvent,
  type SessionEvent,
  type PresenceChangedEvent,
  type ConfigUpdatedEvent,
  type ClientEvent,
  defaultWebSocketClientOptions,
  noopLogger,
} from './websocket-client.types';

// Legacy exports (for backward compatibility)
export * from './sessions';
export * from './stream';
