/**
 * SDK Package
 *
 * Exports for the OpenAidy SDK.
 */

// WebSocket Client SDK
export { WebSocketClient, createWebSocketClient } from './websocket-client.js';
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
  type PresenceStatus,
  type ConfigUpdatedEvent,
  type ClientEvent,
  defaultWebSocketClientOptions,
  noopLogger,
} from './websocket-client.types.js';

// Client adapters
export {
  WebUIAdapter,
  createWebUIAdapter,
  CLIAdapter,
  createCLIAdapter,
  MobileAdapter,
  createMobileAdapter,
  ChannelAdapter,
  createChannelAdapter,
} from './adapters/index.js';
export type {
  ClientAdapter,
  AdapterBaseOptions,
  WebUIAdapterOptions,
  CLIAdapterOptions,
  MobileAdapterOptions,
  ChannelAdapterOptions,
} from './adapters/index.js';

// Legacy exports (for backward compatibility)
export * from './sessions.js';
export * from './stream.js';
