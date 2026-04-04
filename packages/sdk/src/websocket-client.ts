/**
 * WebSocket Client SDK
 *
 * A TypeScript client SDK for connecting to the OpenAidy WebSocket gateway.
 * Provides easy-to-use API for all WebSocket operations.
 */

import {
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
  defaultWebSocketClientOptions,
  noopLogger,
} from './websocket-client.types.js';
import {
  createWSMessage,
  type WSMessage,
  type WSResponse,
} from '@openaidy/shared-types';

type ConnectionEstablishedMessage = {
  id: string;
  type: 'connection.established';
  timestamp: string;
  payload: {
    connectionId: string;
    heartbeatInterval: number;
  };
};

// ============================================================================
// Request Correlator
// ============================================================================

/**
 * Manages request-response correlation
 */
class RequestCorrelator {
  private pending: Map<string, PendingRequest> = new Map();
  private timeout: number;

  constructor(timeout: number) {
    this.timeout = timeout;
  }

  /**
   * Create a pending request and return a promise
   */
  create<T>(requestId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, this.timeout);

      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * Resolve a pending request
   */
  resolve(requestId: string, value: unknown): boolean {
    const pending = this.pending.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(value);
      this.pending.delete(requestId);
      return true;
    }
    return false;
  }

  /**
   * Reject a pending request
   */
  reject(requestId: string, error: Error): boolean {
    const pending = this.pending.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(requestId);
      return true;
    }
    return false;
  }

  /**
   * Reject all pending requests
   */
  rejectAll(error: Error): number {
    const count = this.pending.size;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    return count;
  }

  /**
   * Clean up expired requests
   */
  cleanup(): void {
    const now = Date.now();
    for (const [requestId, pending] of this.pending) {
      if (now - pending.createdAt > this.timeout) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Request expired'));
        this.pending.delete(requestId);
      }
    }
  }

  /**
   * Get pending request count
   */
  get size(): number {
    return this.pending.size;
  }
}

// ============================================================================
// Reconnection Manager
// ============================================================================

/**
 * Manages automatic reconnection
 */
class ReconnectionManager {
  private attempts: number = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private maxAttempts: number;
  private interval: number;

  constructor(maxAttempts: number, interval: number) {
    this.maxAttempts = maxAttempts;
    this.interval = interval;
  }

  /**
   * Get backoff delay with exponential backoff
   */
  getBackoffDelay(): number {
    const baseDelay = this.interval;
    const maxDelay = baseDelay * 10;
    const exponentialDelay = baseDelay * Math.pow(2, this.attempts);
    return Math.min(exponentialDelay, maxDelay);
  }

  /**
   * Schedule a reconnection attempt
   */
  schedule(callback: () => void): boolean {
    if (this.attempts >= this.maxAttempts) {
      return false;
    }

    this.attempts++;
    const delay = this.getBackoffDelay();
    this.timer = setTimeout(callback, delay);
    return true;
  }

  /**
   * Cancel pending reconnection
   */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Reset reconnection attempts
   */
  reset(): void {
    this.cancel();
    this.attempts = 0;
  }

  /**
   * Get current attempt count
   */
  get attemptCount(): number {
    return this.attempts;
  }

  /**
   * Check if should reconnect
   */
  get canReconnect(): boolean {
    return this.attempts < this.maxAttempts;
  }
}

// ============================================================================
// WebSocket Client
// ============================================================================

/**
 * WebSocket client for OpenAidy gateway
 */
export class WebSocketClient {
  private options: Required<
    Omit<WebSocketClientOptions, 'token' | 'logger' | 'clientId'>
  > & {
    token?: string;
    logger: Logger;
    clientId?: string;
  };
  private socket: WebSocket | null = null;
  private state: WebSocketClientState = 'disconnected';
  private correlator: RequestCorrelator;
  private reconnectManager: ReconnectionManager;
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connectionId: string | null = null;
  private requestIdCounter: number = 0;

  constructor(options: WebSocketClientOptions) {
    this.options = {
      ...defaultWebSocketClientOptions,
      ...options,
      logger: options.logger ?? noopLogger,
    };

    this.correlator = new RequestCorrelator(this.options.requestTimeout);
    this.reconnectManager = new ReconnectionManager(
      this.options.maxReconnectAttempts,
      this.options.reconnectInterval,
    );
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (
      this.socket &&
      (this.state === 'connected' || this.state === 'connecting')
    ) {
      return;
    }

    this.setState('connecting');
    this.reconnectManager.reset();

    return new Promise((resolve, reject) => {
      try {
        const url = new URL(this.options.url);
        if (this.options.token) {
          url.searchParams.set('token', this.options.token);
        }

        this.socket = new WebSocket(url.toString());

        this.socket.onopen = () => {
          this.setState('connected');
          this.options.logger.info('WebSocket connected', {
            url: this.options.url,
          });
          this.startHeartbeat();
          resolve();
        };

        this.socket.onclose = (event) => {
          this.handleClose(event.code, event.reason);
        };

        this.socket.onerror = (_event) => {
          const error = new Error('WebSocket error');
          this.handleError(error);
          reject(error);
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this.setState('error');
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.reconnectManager.cancel();
    this.stopHeartbeat();

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect');
      this.socket = null;
    }

    this.connectionId = null;
    this.setState('disconnected');
    this.correlator.rejectAll(new Error('Connection closed'));
  }

  /**
   * Attempt to reconnect
   */
  async reconnect(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    return this.connect();
  }

  /**
   * Get current connection state
   */
  getState(): WebSocketClientState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return (
      this.state === 'connected' && this.socket?.readyState === WebSocket.OPEN
    );
  }

  /**
   * Get connection ID
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Authenticate with a token
   */
  async authenticate(token: string): Promise<void> {
    this.options.token = token;
    await this.reconnect();
  }

  /**
   * Refresh authentication
   */
  async refreshAuth(): Promise<void> {
    if (!this.options.token) {
      throw new Error('No token to refresh');
    }
    await this.reconnect();
  }

  // ============================================================================
  // Messaging
  // ============================================================================

  /**
   * Send a raw message
   */
  async send<T = unknown>(message: WSMessage): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    const requestId = message.id || this.createRequestId();
    const messageWithId = { ...message, id: requestId };

    const promise = this.correlator.create<T>(requestId);

    this.socket!.send(JSON.stringify(messageWithId));

    return promise;
  }

  /**
   * Send a request with type and payload
   */
  async sendRequest<T = unknown>(type: string, payload: unknown): Promise<T> {
    const message = createWSMessage(type, payload);
    return this.send<T>(message as WSMessage);
  }

  // ============================================================================
  // Session Operations
  // ============================================================================

  /**
   * Create a new session
   */
  async createSession(options?: SessionCreateOptions): Promise<WSResponse> {
    return this.sendRequest('session.create', options || {});
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<WSResponse> {
    return this.sendRequest('session.get', { sessionId });
  }

  /**
   * List sessions
   */
  async listSessions(options?: {
    status?: string;
    offset?: number;
    limit?: number;
  }): Promise<WSResponse> {
    return this.sendRequest('session.list', options || {});
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<WSResponse> {
    return this.sendRequest('session.delete', { sessionId });
  }

  /**
   * Send a message to a session
   */
  async sendMessage(
    sessionId: string,
    content: string,
    options?: MessageOptions,
  ): Promise<WSResponse> {
    return this.sendRequest('session.message', {
      sessionId,
      role: 'user',
      content,
      stream: options?.stream ?? false,
      ...options,
    });
  }

  /**
   * Subscribe to session events
   */
  async subscribeToSession(
    sessionId: string,
    events?: string[],
  ): Promise<WSResponse> {
    return this.sendRequest('session.subscribe', {
      sessionId,
      events,
    });
  }

  /**
   * Unsubscribe from session events
   */
  async unsubscribeFromSession(sessionId: string): Promise<WSResponse> {
    return this.sendRequest('session.unsubscribe', { sessionId });
  }

  /**
   * List messages for a session
   */
  async listMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<WSResponse> {
    return this.sendRequest('session.messages', {
      sessionId,
      ...options,
    });
  }

  /**
   * List runs for a session
   */
  async listRuns(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<WSResponse> {
    return this.sendRequest('session.runs', {
      sessionId,
      ...options,
    });
  }

  // ============================================================================
  // Agent Operations
  // ============================================================================

  /**
   * List available agents
   */
  async listAgents(): Promise<WSResponse> {
    return this.sendRequest('agent.list', {});
  }

  /**
   * Get an agent by ID
   */
  async getAgent(agentId: string): Promise<WSResponse> {
    return this.sendRequest('agent.get', { agentId });
  }

  /**
   * Query agents with filter
   */
  async queryAgents(filter?: AgentQueryFilter): Promise<WSResponse> {
    return this.sendRequest('agent.query', { filter });
  }

  // ============================================================================
  // Provider Operations
  // ============================================================================

  /**
   * List providers
   */
  async listProviders(): Promise<WSResponse> {
    return this.sendRequest('provider.list', {});
  }

  /**
   * Get a provider by ID
   */
  async getProvider(providerId: string): Promise<WSResponse> {
    return this.sendRequest('provider.get', { providerId });
  }

  /**
   * Get provider models
   */
  async getProviderModels(providerId: string): Promise<WSResponse> {
    return this.sendRequest('provider.models', { providerId });
  }

  // ============================================================================
  // Node Operations
  // ============================================================================

  /**
   * List nodes
   */
  async listNodes(): Promise<WSResponse> {
    return this.sendRequest('node.list', {});
  }

  /**
   * Get a node by ID
   */
  async getNode(nodeId: string): Promise<WSResponse> {
    return this.sendRequest('node.get', { nodeId });
  }

  /**
   * Invoke a node capability
   */
  async invokeNode(
    nodeId: string,
    capability: string,
    params: Record<string, unknown>,
  ): Promise<WSResponse> {
    return this.sendRequest('node.invoke', { nodeId, capability, params });
  }

  /**
   * Register a node
   */
  async registerNode(node: {
    nodeId: string;
    name: string;
    capabilities: string[];
    metadata?: Record<string, unknown>;
  }): Promise<WSResponse> {
    return this.sendRequest('node.register', node);
  }

  /**
   * Unregister a node
   */
  async unregisterNode(nodeId: string): Promise<WSResponse> {
    return this.sendRequest('node.unregister', { nodeId });
  }

  // ============================================================================
  // Configuration Operations
  // ============================================================================

  /**
   * Get configuration
   */
  async getConfig(path?: string): Promise<WSResponse> {
    return this.sendRequest('config.get', { path });
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Record<string, unknown>): Promise<WSResponse> {
    return this.sendRequest('config.update', { updates });
  }

  /**
   * Watch configuration changes
   */
  async watchConfig(paths?: string[]): Promise<WSResponse> {
    return this.sendRequest('config.watch', { paths });
  }

  /**
   * Unwatch configuration changes
   */
  async unwatchConfig(): Promise<WSResponse> {
    return this.sendRequest('config.unwatch', {});
  }

  // ============================================================================
  // Presence Operations
  // ============================================================================

  /**
   * Update presence status
   */
  async updatePresence(
    status: 'online' | 'away' | 'busy' | 'offline',
    metadata?: Record<string, unknown>,
  ): Promise<WSResponse> {
    return this.sendRequest('presence.update', { status, metadata });
  }

  /**
   * Get presence information
   */
  async getPresence(options?: {
    connectionId?: string;
    clientId?: string;
  }): Promise<WSResponse> {
    return this.sendRequest('presence.get', options || {});
  }

  /**
   * Get all presence
   */
  async getAllPresence(): Promise<WSResponse> {
    return this.sendRequest('presence.getAll', {});
  }

  /**
   * Subscribe to presence events
   */
  async subscribeToPresence(): Promise<WSResponse> {
    return this.sendRequest('presence.subscribe', {});
  }

  /**
   * Unsubscribe from presence events
   */
  async unsubscribeFromPresence(): Promise<WSResponse> {
    return this.sendRequest('presence.unsubscribe', {});
  }

  // ============================================================================
  // Pairing Operations
  // ============================================================================

  /**
   * Request pairing
   */
  async requestPairing(
    clientId: string,
    capabilities: string[],
  ): Promise<WSResponse> {
    return this.sendRequest('pairing.request', { clientId, capabilities });
  }

  /**
   * Get pairing status
   */
  async getPairingStatus(code: string): Promise<WSResponse> {
    return this.sendRequest('pairing.status', { code });
  }

  /**
   * Approve pairing
   */
  async approvePairing(
    requestId: string,
    scopes?: string[],
  ): Promise<WSResponse> {
    return this.sendRequest('pairing.approve', { requestId, scopes });
  }

  /**
   * Deny pairing
   */
  async denyPairing(requestId: string): Promise<WSResponse> {
    return this.sendRequest('pairing.deny', { requestId });
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Subscribe to an event
   */
  on<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler as EventHandler);

    // Return unsubscribe function
    return () => this.off(eventType, handler);
  }

  /**
   * Unsubscribe from an event
   */
  off<T = unknown>(eventType: string, handler: EventHandler<T>): void {
    this.eventHandlers.get(eventType)?.delete(handler as EventHandler);
  }

  /**
   * Subscribe to an event once
   */
  once<T = unknown>(eventType: string, handler: EventHandler<T>): () => void {
    const wrapper: EventHandler<T> = (data) => {
      this.off(eventType, wrapper);
      handler(data);
    };
    return this.on(eventType, wrapper);
  }

  /**
   * Subscribe to errors
   */
  onError(handler: ErrorHandler): () => void {
    return this.on('error', handler);
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(handler: StateChangeHandler): () => void {
    return this.on('stateChange', handler);
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Destroy the client and clean up resources
   */
  destroy(): void {
    this.disconnect();
    this.eventHandlers.clear();
    this.correlator.rejectAll(new Error('Client destroyed'));
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Set connection state
   */
  private setState(newState: WebSocketClientState): void {
    const oldState = this.state;
    this.state = newState;
    if (oldState !== newState) {
      this.emit('stateChange', newState);
    }
  }

  /**
   * Create a unique request ID
   */
  private createRequestId(): string {
    return `req_${Date.now()}_${++this.requestIdCounter}`;
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as
        | WSResponse
        | ConnectionEstablishedMessage;

      // Check if this is a response to a pending request
      if (message.id && this.correlator.resolve(message.id, message)) {
        return;
      }

      // Handle connection established
      if (message.type === 'connection.established') {
        const payload = message.payload as {
          connectionId: string;
          heartbeatInterval: number;
        };
        this.connectionId = payload.connectionId;
        this.emit('connection.established', payload);
        return;
      }

      // Handle error responses
      if (message.type === 'error') {
        const payload = message.payload as {
          requestId: string;
          error: { code: string; message: string };
        };
        if (payload.requestId) {
          this.correlator.reject(
            payload.requestId,
            new Error(`[${payload.error.code}] ${payload.error.message}`),
          );
        }
        this.emit(
          'error',
          new Error(`[${payload.error.code}] ${payload.error.message}`),
        );
        return;
      }

      // Emit as event for other message types
      this.emit(message.type, message);
    } catch (error) {
      this.options.logger.error('Failed to parse message', { data, error });
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(code: number, reason: string): void {
    this.stopHeartbeat();
    this.socket = null;
    this.connectionId = null;

    if (this.options.autoReconnect && this.reconnectManager.canReconnect) {
      this.setState('reconnecting');
      this.options.logger.info('Scheduling reconnect', {
        attempt: this.reconnectManager.attemptCount + 1,
        maxAttempts: this.options.maxReconnectAttempts,
      });

      this.reconnectManager.schedule(() => {
        this.connect().catch((error) => {
          this.options.logger.error('Reconnect failed', { error });
        });
      });
    } else {
      this.setState('disconnected');
      this.correlator.rejectAll(
        new Error(`Connection closed: ${code} - ${reason}`),
      );
    }

    this.emit('close', { code, reason });
  }

  /**
   * Handle error
   */
  private handleError(error: Error): void {
    this.setState('error');
    this.options.logger.error('WebSocket error', { error: error.message });
    this.emit('error', error);
  }

  /**
   * Emit an event
   */
  private emit(eventType: string, data: unknown): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          this.options.logger.error('Event handler error', {
            eventType,
            error,
          });
        }
      }
    }
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        // Send ping - server should respond with pong or update heartbeat
        this.send({
          id: this.createRequestId(),
          type: 'ping',
          timestamp: new Date().toISOString(),
          payload: {},
        }).catch(() => {
          // Ignore ping errors
        });
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a WebSocket client instance
 */
export function createWebSocketClient(
  options: WebSocketClientOptions,
): WebSocketClient {
  return new WebSocketClient(options);
}

export default WebSocketClient;
