# Phase 2: Session Integration - Detailed Tasks

## Overview

This phase implements session management endpoints, integrates with the existing SessionMessageService, and implements streaming responses with subscription management.

---

## Task 2.1: Create Session Handler

### Description

Implement WebSocket message handlers for session operations: create, get, list, delete, and message.

### Expected Results

- `apps/server/src/websocket/handlers/session.ts`
- Handles all session-related WebSocket messages
- Integrates with SessionMessageService
- Returns properly formatted responses

### Files to Create

- `apps/server/src/websocket/handlers/session.ts`

### Files to Reference/Reuse

- `apps/server/src/sessions/service.ts` - SessionMessageService
- `apps/server/src/sessions/store.ts` - Session store functions
- `apps/server/src/routes/sessions.ts` - REST API patterns
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/handlers/session.test.ts`
  - Test session.create handler
  - Test session.get handler
  - Test session.list handler
  - Test session.delete handler
  - Test session.message handler (non-streaming)
  - Test session.message handler (streaming)
  - Test error handling for invalid session IDs
  - Test error handling for missing permissions

### Implementation Details

#### Session Handler Class

```typescript
class SessionHandler {
  private sessionService: SessionMessageService;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;

  constructor(
    sessionService: SessionMessageService,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  );

  // Handler functions
  async handleCreate(
    connectionId: string,
    request: SessionCreateRequest,
    context: HandlerContext,
  ): Promise<SessionCreatedResponse>;

  async handleGet(
    connectionId: string,
    request: SessionGetRequest,
    context: HandlerContext,
  ): Promise<Session | ErrorResponse>;

  async handleList(
    connectionId: string,
    request: SessionListRequest,
    context: HandlerContext,
  ): Promise<{ sessions: Session[] } | ErrorResponse>;

  async handleDelete(
    connectionId: string,
    request: SessionDeleteRequest,
    context: HandlerContext,
  ): Promise<{ success: boolean } | ErrorResponse>;

  async handleMessage(
    connectionId: string,
    request: SessionMessageRequest,
    context: HandlerContext,
  ): Promise<SessionMessageResponse | ErrorResponse>;
}
```

#### Response Mappers

```typescript
function mapSessionToResponse(session: Session): Session;
function mapMessageToResponse(message: SessionMessage): SessionMessage;
function mapRunToResponse(run: SessionRun): SessionRun;
```

#### Validation

```typescript
async function validateSessionAccess(
  sessionId: string,
  connectionId: string,
  connectionManager: ConnectionManager,
  requiredCapability: string,
): Promise<boolean>;
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Task 1.5 (message router)
- Existing SessionMessageService

### Success Criteria

- All session handlers work correctly
- Integration with SessionMessageService is complete
- Error handling is comprehensive
- All operations are tested

---

## Task 2.2: Create Streaming Response Handler

### Description

Implement streaming response handler that forwards RunEvents to WebSocket clients as streaming events.

### Expected Results

- `apps/server/src/websocket/streaming.ts`
- Subscribes to RunEventEmitter
- Maps RunEvents to WebSocket streaming events
- Manages per-connection stream subscriptions
- Handles stream lifecycle (start, delta, end, error)

### Files to Create

- `apps/server/src/websocket/streaming.ts`

### Files to Reference/Reuse

- `apps/server/src/dispatch/events.ts` - RunEventEmitter
- `apps/server/src/dispatch/service.ts` - DispatchService
- Task 1.1 (shared types)
- Task 1.4 (connection manager)

### Expected Tests

- `apps/server/src/websocket/streaming.test.ts`
  - Test stream start event mapping
  - Test stream delta event mapping
  - Test stream tool_call event mapping
  - Test stream usage event mapping
  - Test stream end event mapping
  - Test stream error event mapping
  - Test subscription management
  - Test unsubscription cleanup

### Implementation Details

#### Stream Manager Class

```typescript
class StreamManager {
  private runEvents: RunEventEmitter;
  private connectionManager: ConnectionManager;
  private subscriptions: Map<string, Set<string>>; // runId -> connectionIds
  private logger: FastifyBaseLogger;

  constructor(
    runEvents: RunEventEmitter,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  );

  // Subscription management
  subscribeToRun(runId: string, connectionId: string): void;
  unsubscribeFromRun(runId: string, connectionId: string): void;
  unsubscribeAllFromConnection(connectionId: string): void;

  // Event handling
  private handleRunEvent(event: RunEvent): void;
  private mapToStreamEvent(event: RunEvent): SessionStreamEvent | null;

  // Lifecycle
  start(): void;
  stop(): void;
}
```

#### Event Mapping

```typescript
function mapRunEventToStreamEvent(event: RunEvent): SessionStreamEvent | null {
  switch (event.type) {
    case 'run.started':
      return {
        type: 'session.stream.start',
        payload: {
          sessionId: event.sessionId,
          runId: event.runId,
          agentId: event.agentId,
          providerId: event.data.providerId as string,
          modelId: event.data.modelId as string,
        },
      };
    case 'run.delta':
      return {
        type: 'session.stream.delta',
        payload: {
          sessionId: event.sessionId,
          runId: event.runId,
          delta: event.data.delta as string,
          content: event.data.content as string,
        },
      };
    // ... other event types
    default:
      return null;
  }
}
```

#### Stream Event Types

```typescript
type SessionStreamEvent =
  | SessionStreamStart
  | SessionStreamDelta
  | SessionStreamToolCall
  | SessionStreamUsage
  | SessionStreamEnd
  | SessionStreamError;
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Existing RunEventEmitter
- Existing DispatchService

### Success Criteria

- RunEvents are mapped correctly
- Subscriptions are managed properly
- Stream lifecycle is handled correctly
- Cleanup happens on disconnect
- All operations are tested

---

## Task 2.3: Create Subscription Manager

### Description

Implement subscription manager for session events, allowing clients to subscribe to specific sessions or event types.

### Expected Results

- `apps/server/src/websocket/subscriptions.ts`
- Manages client subscriptions to sessions
- Filters events based on subscription criteria
- Handles subscription lifecycle
- Integrates with event bus

### Files to Create

- `apps/server/src/websocket/subscriptions.ts`

### Files to Reference/Reuse

- `apps/server/src/dispatch/events.ts` - Event emitter pattern
- Task 1.4 (connection manager)
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/subscriptions.test.ts`
  - Test session subscription
  - Test session unsubscription
  - Test event filtering by type
  - Test broadcast to subscribers
  - Test connection cleanup
  - Test subscription limits

### Implementation Details

#### Subscription Types

```typescript
type Subscription = {
  id: string;
  connectionId: string;
  sessionId: string;
  eventTypes: string[]; // Empty = all events
  createdAt: number;
};

type SubscriptionFilter = {
  sessionId?: string;
  eventTypes?: string[];
};
```

#### Subscription Manager Class

```typescript
class SubscriptionManager {
  private subscriptions: Map<string, Subscription>; // subscriptionId -> subscription
  private sessionSubscriptions: Map<string, Set<string>>; // sessionId -> subscriptionIds
  private connectionSubscriptions: Map<string, Set<string>>; // connectionId -> subscriptionIds
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger);

  // Subscription management
  createSubscription(
    connectionId: string,
    sessionId: string,
    eventTypes?: string[],
  ): string;

  removeSubscription(subscriptionId: string): void;
  removeConnectionSubscriptions(connectionId: string): void;
  removeSessionSubscriptions(sessionId: string): void;

  // Query
  getSubscription(subscriptionId: string): Subscription | undefined;
  getConnectionSubscriptions(connectionId: string): Subscription[];
  getSessionSubscriptions(sessionId: string): Subscription[];

  // Event broadcasting
  broadcastToSession(
    sessionId: string,
    event: unknown,
    eventType: string,
  ): void;
  broadcastToAll(event: unknown): void;

  // Cleanup
  cleanup(): void;
}
```

#### Event Integration

```typescript
class EventBusIntegration {
  private subscriptionManager: SubscriptionManager;
  private runEvents: RunEventEmitter;

  constructor(
    subscriptionManager: SubscriptionManager,
    runEvents: RunEventEmitter,
  );

  // Subscribe to events
  setupEventListeners(): void;

  // Event handlers
  private handleRunEvent(event: RunEvent): void;
  private handleSessionEvent(event: SessionEvent): void;
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Existing RunEventEmitter

### Success Criteria

- Subscriptions are managed correctly
- Events are filtered and broadcast properly
- Cleanup happens on disconnect
- Subscription limits are enforced
- All operations are tested

---

## Task 2.4: Integrate Session Handlers with Message Router

### Description

Register session handlers with the message router and wire up the streaming and subscription managers.

### Expected Results

- Session handlers registered in message router
- Streaming manager integrated
- Subscription manager integrated
- End-to-end session operations work via WebSocket

### Files to Modify

- `apps/server/src/websocket/index.ts` - Gateway plugin
- `apps/server/src/websocket/message-router.ts` - Message router

### Files to Reference/Reuse

- Task 2.1 (session handler)
- Task 2.2 (streaming manager)
- Task 2.3 (subscription manager)
- Task 1.5 (message router)

### Expected Tests

- `apps/server/src/websocket/session-integration.test.ts`
  - Test end-to-end session creation
  - Test end-to-end session messaging
  - Test end-to-end streaming
  - Test end-to-end subscription
  - Test error handling

### Implementation Details

#### Gateway Plugin Updates

```typescript
// In apps/server/src/websocket/index.ts

export const websocketGatewayPlugin: FastifyPluginAsync = async (
  fastify,
  options,
) => {
  // ... existing setup ...

  // Create managers
  const streamManager = new StreamManager(
    services.runEvents,
    connectionManager,
    app.log,
  );

  const subscriptionManager = new SubscriptionManager(app.log);

  // Create handlers
  const sessionHandler = new SessionHandler(
    services.sessions,
    connectionManager,
    app.log,
  );

  // Register handlers with message router
  messageRouter.registerHandler(
    'session.create',
    sessionHandler.handleCreate.bind(sessionHandler),
  );
  messageRouter.registerHandler(
    'session.get',
    sessionHandler.handleGet.bind(sessionHandler),
  );
  messageRouter.registerHandler(
    'session.list',
    sessionHandler.handleList.bind(sessionHandler),
  );
  messageRouter.registerHandler(
    'session.delete',
    sessionHandler.handleDelete.bind(sessionHandler),
  );
  messageRouter.registerHandler(
    'session.message',
    sessionHandler.handleMessage.bind(sessionHandler),
  );
  messageRouter.registerHandler(
    'session.subscribe',
    async (connectionId, message, context) => {
      // Handle subscription
    },
  );
  messageRouter.registerHandler(
    'session.unsubscribe',
    async (connectionId, message, context) => {
      // Handle unsubscription
    },
  );

  // Start streaming manager
  streamManager.start();

  // Cleanup
  fastify.addHook('onClose', async () => {
    streamManager.stop();
    subscriptionManager.cleanup();
  });
};
```

### Dependencies

- All previous Phase 2 tasks
- Task 1.5 (message router)

### Success Criteria

- All session handlers are registered
- Streaming works end-to-end
- Subscriptions work end-to-end
- Integration tests pass
- No regressions in existing functionality

---

## Task 2.5: Create Session Event Types

### Description

Define session-specific event types for WebSocket communication, extending the shared types.

### Expected Results

- Session event types added to shared types
- Event types are properly typed
- Type guards for session events

### Files to Modify

- `packages/shared-types/src/websocket.ts`

### Files to Reference/Reuse

- Task 1.1 (shared types)
- `packages/shared-types/src/events.ts` - Existing event types

### Expected Tests

- `packages/shared-types/src/websocket.test.ts` (update existing tests)
  - Test session event type guards
  - Test session event validation
  - Test session event serialization

### Implementation Details

#### Session Event Types

```typescript
// Session created event
type SessionCreatedEvent = {
  type: 'session.created';
  payload: {
    sessionId: string;
    agentId: string;
    createdAt: string;
  };
};

// Session message event
type SessionMessageEvent = {
  type: 'session.message';
  payload: {
    sessionId: string;
    messageId: string;
    role: 'assistant' | 'user' | 'system';
    content: string;
    createdAt: string;
  };
};

// Session deleted event
type SessionDeletedEvent = {
  type: 'session.deleted';
  payload: {
    sessionId: string;
    deletedAt: string;
  };
};

// Session updated event
type SessionUpdatedEvent = {
  type: 'session.updated';
  payload: {
    sessionId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  };
};

// Union type
type SessionEvent =
  | SessionCreatedEvent
  | SessionMessageEvent
  | SessionDeletedEvent
  | SessionUpdatedEvent;

// Type guards
function isSessionEvent(msg: unknown): msg is SessionEvent;
function isSessionCreatedEvent(msg: unknown): msg is SessionCreatedEvent;
function isSessionMessageEvent(msg: unknown): msg is SessionMessageEvent;
```

### Dependencies

- Task 1.1 (shared types)

### Success Criteria

- All session event types are defined
- Type guards work correctly
- Events can be serialized/deserialized
- Tests cover all event types

---

## Task 2.6: Create Session Integration Tests

### Description

Create comprehensive integration tests for session operations via WebSocket.

### Expected Results

- Integration test suite for session operations
- Tests cover all session handlers
- Tests cover streaming
- Tests cover subscriptions

### Files to Create

- `apps/server/src/websocket/integration/session-integration.test.ts`

### Files to Reference/Reuse

- `apps/server/src/sessions/service.test.ts` - Service test patterns
- Task 2.1-2.4 (session components)

### Expected Tests

#### Connection Tests

- Test WebSocket connection establishment
- Test authentication
- Test connection close

#### Session Creation Tests

- Test creating a session via WebSocket
- Test session creation with custom agent
- Test session creation with provider/model override
- Test session creation error handling

#### Session Query Tests

- Test getting a session via WebSocket
- Test listing sessions with filters
- Test getting non-existent session
- Test listing with pagination

#### Session Message Tests

- Test sending a message (non-streaming)
- Test sending a message (streaming)
- Test message with system role
- Test message with custom provider/model
- Test message error handling

#### Streaming Tests

- Test receiving stream start event
- Test receiving stream delta events
- Test receiving stream usage event
- Test receiving stream end event
- Test stream error handling
- Test concurrent streams

#### Subscription Tests

- Test subscribing to a session
- Test receiving session events
- Test unsubscribing from a session
- Test subscribing to specific event types
- Test subscription cleanup on disconnect

#### Error Handling Tests

- Test invalid session ID
- Test missing permissions
- Test invalid message format
- Test rate limiting
- Test connection timeout

### Dependencies

- All previous Phase 2 tasks

### Success Criteria

- All integration tests pass
- Tests cover happy paths
- Tests cover error cases
- Tests are maintainable and clear
- Test coverage >90% for session code

---

## Phase 2 Completion Criteria

- All tasks completed and tested
- Session operations work via WebSocket
- Streaming responses work end-to-end
- Subscriptions work correctly
- Integration with SessionMessageService is complete
- All tests passing with >90% coverage
- Documentation updated

---

## Next Phase

After completing Phase 2, proceed to **Phase 3: Agent & Provider Integration** which will implement agent and provider query endpoints and integrate with AgentRegistry and ProviderServices.
