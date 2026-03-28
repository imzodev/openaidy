# Phase 6: Testing & Documentation - Detailed Tasks

## Overview

This phase creates comprehensive test suites, documentation, and client SDK for the WebSocket control plane.

---

## Task 6.1: Create End-to-End Integration Tests

### Description

Create comprehensive end-to-end integration tests that test the entire WebSocket gateway from connection to message handling.

### Expected Results

- `apps/server/src/websocket/integration/e2e.test.ts`
- Tests cover complete user flows
- Tests verify all components work together
- Tests simulate real client behavior

### Files to Create

- `apps/server/src/websocket/integration/e2e.test.ts`

### Files to Reference/Reuse

- All previous phase components
- `apps/server/src/app.test.ts` - For test patterns

### Expected Tests

#### Connection Lifecycle Tests

- Test WebSocket connection establishment
- Test authentication flow
- Test heartbeat/ping-pong
- Test connection close
- Test reconnection after disconnect
- Test multiple concurrent connections

#### Authentication Tests

- Test valid token authentication
- Test invalid token rejection
- Test expired token rejection
- Test token refresh
- Test capability extraction
- Test permission enforcement

#### Session Flow Tests

- Test complete session creation → message → response flow
- Test streaming session message
- Test session subscription
- Test receiving session events
- Test session deletion
- Test concurrent sessions

#### Agent & Provider Tests

- Test listing agents
- Test querying agents
- Test listing providers
- Test querying provider models
- Test receiving agent events
- Test receiving provider events

#### Node & Pairing Tests

- Test complete pairing flow
- Test node registration
- Test node invocation
- Test receiving node events
- Test multiple nodes
- Test node capability filtering

#### Configuration & Presence Tests

- Test getting configuration
- Test updating configuration
- Test receiving config events
- Test updating presence
- Test receiving presence events
- Test presence subscription

#### Error Handling Tests

- Test malformed messages
- Test unknown message types
- Test rate limiting
- Test permission denied
- Test connection timeout
- Test server shutdown

#### Performance Tests

- Test with 100 concurrent connections
- Test with 1000 messages per second
- Test memory usage over time
- Test connection cleanup

### Dependencies

- All previous phase components

### Success Criteria

- All E2E tests pass
- Tests cover all major user flows
- Tests simulate real client behavior
- Tests are maintainable and clear
- Performance tests meet requirements

---

## Task 6.2: Create WebSocket Client SDK

### Description

Create a TypeScript client SDK for connecting to the WebSocket gateway and handling messages.

### Expected Results

- `packages/sdk/src/websocket-client.ts`
- Easy-to-use API for WebSocket communication
- Automatic reconnection
- Request-response correlation
- Event subscription
- Type-safe message handling

### Files to Create

- `packages/sdk/src/websocket-client.ts`
- `packages/sdk/src/websocket-client.types.ts`

### Files to Reference/Reuse

- `packages/shared-types/src/websocket.ts` - Shared types
- Task 1.1 (shared types)

### Expected Tests

- `packages/sdk/src/websocket-client.test.ts`
  - Test client connection
  - Test authentication
  - Test message sending
  - Test request-response correlation
  - Test event subscription
  - Test reconnection
  - Test error handling

### Implementation Details

#### Client SDK Types

```typescript
type WebSocketClientOptions = {
  url: string;
  token?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  heartbeatInterval?: number;
  logger?: Logger;
};

type WebSocketClientState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

type EventHandler<T = unknown> = (data: T) => void;
type ErrorHandler = (error: Error) => void;
type StateChangeHandler = (state: WebSocketClientState) => void;
```

#### WebSocket Client Class

```typescript
class WebSocketClient {
  private options: WebSocketClientOptions;
  private socket: WebSocket | null;
  private state: WebSocketClientState;
  private messageQueue: Map<string, PendingRequest>;
  private eventHandlers: Map<string, Set<EventHandler>>;
  private reconnectTimer: NodeJS.Timeout | null;
  private heartbeatTimer: NodeJS.Timeout | null;

  constructor(options: WebSocketClientOptions);

  // Connection management
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;

  // State
  getState(): WebSocketClientState;
  isConnected(): boolean;

  // Authentication
  authenticate(token: string): Promise<void>;
  refreshAuth(): Promise<void>;

  // Messaging
  send<T = unknown>(message: WSRequest): Promise<T>;
  sendRequest<T = unknown>(type: string, payload: unknown): Promise<T>;

  // Session operations
  createSession(options?: SessionCreateOptions): Promise<Session>;
  getSession(sessionId: string): Promise<Session>;
  listSessions(options?: SessionListOptions): Promise<Session[]>;
  deleteSession(sessionId: string): Promise<void>;
  sendMessage(
    sessionId: string,
    content: string,
    options?: MessageOptions,
  ): Promise<SessionMessageResponse>;
  subscribeToSession(sessionId: string, events?: string[]): void;
  unsubscribeFromSession(sessionId: string): void;

  // Agent operations
  listAgents(): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent>;
  queryAgents(filter: AgentQueryFilter): Promise<Agent[]>;

  // Provider operations
  listProviders(): Promise<Provider[]>;
  getProvider(providerId: string): Promise<Provider>;
  getProviderModels(providerId: string): Promise<Model[]>;

  // Node operations
  listNodes(): Promise<Node[]>;
  getNode(nodeId: string): Promise<Node>;
  invokeNode(
    nodeId: string,
    capability: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;

  // Configuration operations
  getConfig(path?: string): Promise<Record<string, unknown>>;
  updateConfig(updates: Record<string, unknown>): Promise<void>;
  watchConfig(): void;
  unwatchConfig(): void;

  // Presence operations
  updatePresence(
    status: PresenceStatus,
    metadata?: Record<string, unknown>,
  ): void;
  getPresence(): Promise<PresenceInfo[]>;
  subscribeToPresence(): void;
  unsubscribeFromPresence(): void;

  // Event handling
  on<T = unknown>(eventType: string, handler: EventHandler<T>): () => void;
  off(eventType: string, handler: EventHandler): void;
  once<T = unknown>(eventType: string, handler: EventHandler<T>): () => void;

  // Error handling
  onError(handler: ErrorHandler): () => void;
  onStateChange(handler: StateChangeHandler): () => void;

  // Cleanup
  destroy(): void;
}
```

#### Request-Response Correlation

```typescript
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  createdAt: number;
};

class RequestCorrelator {
  private pending: Map<string, PendingRequest>;
  private timeout: number;

  constructor(timeout: number);

  create<T>(requestId: string): Promise<T>;
  resolve(requestId: string, value: unknown): void;
  reject(requestId: string, error: Error): void;
  cleanup(): void;
}
```

#### Reconnection Logic

```typescript
class ReconnectionManager {
  private options: WebSocketClientOptions;
  private client: WebSocketClient;
  private reconnectTimer: NodeJS.Timeout | null;
  private reconnectAttempts: number;

  constructor(options: WebSocketClientOptions, client: WebSocketClient);

  scheduleReconnect(): void;
  cancelReconnect(): void;
  shouldReconnect(): boolean;
  getBackoffDelay(): number;
  reset(): void;
}
```

### Dependencies

- Task 1.1 (shared types)
- All previous phase components

### Success Criteria

- Client SDK is easy to use
- Automatic reconnection works
- Request-response correlation works
- Event subscription works
- All operations are tested
- TypeScript types are complete

---

## Task 6.3: Create WebSocket Protocol Documentation

### Description

Create comprehensive documentation for the WebSocket protocol, including message types, examples, and best practices.

### Expected Results

- `docs/websocket-protocol.md`
- Complete protocol reference
- Message type documentation
- Usage examples
- Best practices

### Files to Create

- `docs/websocket-protocol.md`

### Files to Reference/Reuse

- Task 1.1 (shared types)
- `plans/websocket-control-plane.md` - Design document

### Documentation Sections

#### Overview

- What is the WebSocket gateway?
- Why use WebSocket instead of REST?
- When to use WebSocket vs SSE

#### Connection

- Connection URL format
- Connection lifecycle
- Authentication flow
- Heartbeat/ping-pong
- Reconnection strategy

#### Message Protocol

- Message envelope structure
- Message types (requests, responses, events)
- Request-response correlation
- Error handling

#### Session Operations

- Creating a session
- Getting session details
- Listing sessions
- Deleting a session
- Sending a message
- Streaming responses
- Subscribing to session events

#### Agent Operations

- Listing agents
- Getting agent details
- Querying agents

#### Provider Operations

- Listing providers
- Getting provider details
- Listing provider models

#### Node Operations

- Listing nodes
- Getting node details
- Invoking node capabilities
- Registering a node

#### Pairing Operations

- Creating a pairing request
- Checking pairing status
- Approving a pairing request
- Denying a pairing request

#### Configuration Operations

- Getting configuration
- Updating configuration
- Watching for configuration changes

#### Presence Operations

- Updating presence
- Getting presence information
- Subscribing to presence events

#### Error Codes

- Complete list of error codes
- Error code descriptions
- Common error scenarios

#### Security

- Authentication
- Authorization
- Capability-based access control
- Token management

#### Best Practices

- Connection management
- Error handling
- Performance optimization
- Security considerations

#### Examples

- Basic connection example
- Session creation example
- Streaming message example
- Node invocation example
- Presence subscription example

### Dependencies

- Task 1.1 (shared types)
- All previous phase components

### Success Criteria

- Documentation is comprehensive
- Examples are clear and runnable
- Protocol is fully documented
- Best practices are included

---

## Task 6.4: Create Client SDK Documentation

### Description

Create documentation for the WebSocket client SDK, including API reference and usage examples.

### Expected Results

- `docs/websocket-client-sdk.md`
- Complete API reference
- Usage examples
- TypeScript type documentation

### Files to Create

- `docs/websocket-client-sdk.md`

### Files to Reference/Reuse

- Task 6.2 (client SDK)
- `packages/sdk/src/websocket-client.ts`

### Documentation Sections

#### Overview

- What is the client SDK?
- Installation
- Basic usage

#### API Reference

- WebSocketClient class
- Connection methods
- Authentication methods
- Session methods
- Agent methods
- Provider methods
- Node methods
- Configuration methods
- Presence methods
- Event handling methods

#### TypeScript Types

- WebSocketClientOptions
- WebSocketClientState
- EventHandler
- All request/response types

#### Examples

- Basic connection
- Authentication
- Creating and using sessions
- Streaming responses
- Event subscription
- Node invocation
- Configuration watching
- Presence subscription

#### Advanced Usage

- Custom reconnection logic
- Custom error handling
- Request timeout configuration
- Event filtering
- Message batching

#### Best Practices

- Connection lifecycle management
- Error handling
- Performance optimization
- Memory management

### Dependencies

- Task 6.2 (client SDK)

### Success Criteria

- API is fully documented
- Examples are clear and runnable
- TypeScript types are documented
- Best practices are included

---

## Task 6.5: Create Integration Guide

### Description

Create a guide for integrating the WebSocket gateway with existing applications.

### Expected Results

- `docs/websocket-integration-guide.md`
- Integration patterns
- Migration guide from REST
- Common integration scenarios

### Files to Create

- `docs/websocket-integration-guide.md`

### Files to Reference/Reuse

- `docs/websocket-protocol.md` - Protocol documentation
- `docs/websocket-client-sdk.md` - SDK documentation

### Documentation Sections

#### Integration Patterns

- Web application integration
- Mobile application integration
- CLI tool integration
- Service-to-service integration

#### Migration from REST

- Mapping REST endpoints to WebSocket messages
- Handling authentication differences
- Handling error differences
- Step-by-step migration guide

#### Common Scenarios

- Building a chat interface
- Building a dashboard
- Building a CLI tool
- Building a mobile app
- Building a service integration

#### Security Considerations

- Token storage
- Secure connections
- Permission handling

#### Performance Considerations

- Connection pooling
- Message batching
- Event filtering
- Memory management

#### Troubleshooting

- Common issues and solutions
- Debugging techniques
- Logging and monitoring

### Dependencies

- Task 6.3 (protocol documentation)
- Task 6.4 (SDK documentation)

### Success Criteria

- Integration patterns are clear
- Migration guide is complete
- Common scenarios are covered
- Troubleshooting section is helpful

---

## Task 6.6: Create Architecture Documentation

### Description

Create detailed architecture documentation for the WebSocket gateway.

### Expected Results

- `docs/websocket-architecture.md`
- Component architecture
- Data flow diagrams
- Design decisions
- Performance characteristics

### Files to Create

- `docs/websocket-architecture.md`

### Files to Reference/Reuse

- `plans/websocket-control-plane.md` - Design document
- All implementation files

### Documentation Sections

#### Overview

- Gateway architecture
- Design goals
- Non-goals

#### Components

- Connection Manager
- Message Router
- Authentication Middleware
- Rate Limiting Middleware
- Stream Manager
- Subscription Manager
- Node Registry
- Pairing Service
- Presence Manager

#### Data Flow

- Connection establishment flow
- Message handling flow
- Streaming flow
- Event broadcasting flow
- Pairing flow

#### Design Decisions

- Why WebSocket?
- Why this message protocol?
- Why capability-based authorization?
- Why this reconnection strategy?

#### Performance

- Connection limits
- Message throughput
- Memory usage
- Scaling considerations

#### Security

- Authentication flow
- Authorization flow
- Token management
- Rate limiting

#### Extensibility

- Adding new message types
- Adding new handlers
- Adding new middleware
- Adding new events

### Dependencies

- All implementation files

### Success Criteria

- Architecture is clearly documented
- Data flows are visualized
- Design decisions are explained
- Performance characteristics are documented

---

## Task 6.7: Update Existing Documentation

### Description

Update existing documentation to include WebSocket gateway information.

### Expected Results

- Updated README files
- Updated architecture documentation
- Updated API documentation

### Files to Modify

- `README.md`
- `docs/architecture.md`
- `docs/api-design.md`

### Files to Reference/Reuse

- All new documentation

### Updates Required

#### README.md

- Add WebSocket gateway section
- Add quick start example
- Add links to detailed documentation

#### docs/architecture.md

- Add WebSocket gateway to architecture diagram
- Add WebSocket gateway to subsystems
- Update data flow sections

#### docs/api-design.md

- Add WebSocket API section
- Add WebSocket vs REST comparison
- Add migration guide link

### Dependencies

- All previous documentation tasks

### Success Criteria

- All documentation is updated
- Links are correct
- Examples are accurate

---

## Task 6.8: Create Performance Benchmarks

### Description

Create performance benchmarks for the WebSocket gateway.

### Expected Results

- `apps/server/src/websocket/benchmarks/`
- Benchmark tests for key operations
- Performance baselines
- Performance regression detection

### Files to Create

- `apps/server/src/websocket/benchmarks/connection.bench.ts`
- `apps/server/src/websocket/benchmarks/messaging.bench.ts`
- `apps/server/src/websocket/benchmarks/streaming.bench.ts`
- `apps/server/src/websocket/benchmarks/subscription.bench.ts`

### Expected Benchmarks

#### Connection Benchmarks

- Connection establishment time
- Authentication time
- Concurrent connections (100, 1000, 10000)
- Connection cleanup time

#### Messaging Benchmarks

- Message throughput (messages/second)
- Request-response latency
- Concurrent requests
- Message serialization time

#### Streaming Benchmarks

- Stream start latency
- Stream delta latency
- Concurrent streams
- Stream event throughput

#### Subscription Benchmarks

- Subscription time
- Event broadcast time
- Concurrent subscriptions
- Event filtering performance

### Dependencies

- All implementation files

### Success Criteria

- Benchmarks are comprehensive
- Baselines are established
- Benchmarks are repeatable

---

## Task 6.9: Create Deployment Guide

### Description

Create a guide for deploying the WebSocket gateway in production.

### Expected Results

- `docs/websocket-deployment.md`
- Deployment configurations
- Production considerations
- Monitoring and observability

### Files to Create

- `docs/websocket-deployment.md`

### Documentation Sections

#### Deployment Options

- Standalone deployment
- Container deployment
- Kubernetes deployment
- Load balancing

#### Configuration

- Environment variables
- Production configuration
- Security configuration
- Performance tuning

#### Monitoring

- Metrics to track
- Logging configuration
- Alerting setup
- Dashboard examples

#### Scaling

- Horizontal scaling
- Vertical scaling
- Connection limits
- Rate limiting

#### Security

- TLS configuration
- Firewall rules
- Token management
- Rate limiting

#### Troubleshooting

- Common issues
- Debugging techniques
- Performance issues

### Dependencies

- All implementation files

### Success Criteria

- Deployment guide is complete
- Production considerations are covered
- Monitoring is documented

---

## Phase 6 Completion Criteria

- All tasks completed
- All tests passing with >90% coverage
- Client SDK is complete and tested
- Documentation is comprehensive
- Performance benchmarks are established
- Deployment guide is complete
- All existing documentation is updated

---

## Overall Project Completion

After completing all 6 phases, the WebSocket control plane will be fully implemented with:

1. **Core Infrastructure** (Phase 1)
   - WebSocket gateway plugin
   - Connection management
   - Message routing
   - Authentication and authorization
   - Rate limiting

2. **Session Integration** (Phase 2)
   - Session operations via WebSocket
   - Streaming responses
   - Event subscriptions

3. **Agent & Provider Integration** (Phase 3)
   - Agent queries via WebSocket
   - Provider queries via WebSocket
   - Agent and provider events

4. **Device/Node Support** (Phase 4)
   - Node registration and management
   - Capability invocation
   - Device pairing flow

5. **Configuration & Presence** (Phase 5)
   - Configuration management
   - Presence system
   - Configuration and presence events

6. **Testing & Documentation** (Phase 6)
   - Comprehensive test suites
   - Client SDK
   - Complete documentation
   - Performance benchmarks
   - Deployment guide

The WebSocket control plane will provide a robust, scalable, and well-documented foundation for real-time communication in OpenAidy, similar to OpenClaw's Gateway.
