# Phase 5: Configuration & Presence - Detailed Tasks

## Overview

This phase implements configuration management endpoints, presence system, and related events for WebSocket clients.

---

## Task 5.1: Create Configuration Handler

### Description

Implement WebSocket message handlers for configuration operations: get and update.

### Expected Results

- `apps/server/src/websocket/handlers/config.ts`
- Handles all configuration-related WebSocket messages
- Integrates with AppConfigService
- Enforces permission checks for config updates

### Files to Create

- `apps/server/src/websocket/handlers/config.ts`

### Files to Reference/Reuse

- `apps/server/src/config/service.ts` - AppConfigService
- `apps/server/src/routes/config.ts` - REST API patterns
- Task 1.1 (shared types)
- Task 1.6 (auth middleware)

### Expected Tests

- `apps/server/src/websocket/handlers/config.test.ts`
  - Test config.get handler
  - Test config.get with path
  - Test config.update handler
  - Test config.update with multiple paths
  - Test error handling for missing permissions
  - Test error handling for invalid config

### Implementation Details

#### Configuration Handler Class

```typescript
class ConfigHandler {
  private configService: AppConfigService;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;

  constructor(
    configService: AppConfigService,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  );

  // Handler functions
  async handleGet(
    connectionId: string,
    request: ConfigGetRequest,
    context: HandlerContext,
  ): Promise<Record<string, unknown> | ErrorResponse>;

  async handleUpdate(
    connectionId: string,
    request: ConfigUpdateRequest,
    context: HandlerContext,
  ): Promise<
    { success: boolean; config: Record<string, unknown> } | ErrorResponse
  >;

  async handleWatch(
    connectionId: string,
    request: ConfigWatchRequest,
    context: HandlerContext,
  ): Promise<{ watching: boolean } | ErrorResponse>;

  async handleUnwatch(
    connectionId: string,
    request: ConfigUnwatchRequest,
    context: HandlerContext,
  ): Promise<{ watching: boolean } | ErrorResponse>;
}
```

#### Configuration Path Resolution

```typescript
function resolveConfigPath(
  config: Record<string, unknown>,
  path?: string,
): unknown {
  if (!path) {
    return config;
  }

  const parts = path.split('.');
  let current: unknown = config;

  for (const part of parts) {
    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
```

#### Configuration Validation

```typescript
async function validateConfigUpdate(
  updates: Record<string, unknown>,
  configService: AppConfigService,
): Promise<{ valid: boolean; errors?: string[] }> {
  // Validate against config schema
  const schema = configService.getSchema();
  const errors: string[] = [];

  // Implement validation logic
  // This depends on the actual schema structure

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Task 1.6 (auth middleware)
- Existing AppConfigService

### Success Criteria

- All config handlers work correctly
- Integration with AppConfigService is complete
- Permission checks are enforced
- Configuration validation works
- All operations are tested

---

## Task 5.2: Create Presence Manager

### Description

Implement presence manager that tracks client presence status and broadcasts presence changes.

### Expected Results

- `apps/server/src/websocket/presence-manager.ts`
- Tracks client presence status
- Broadcasts presence changes
- Manages presence subscriptions
- Handles presence queries

### Files to Create

- `apps/server/src/websocket/presence-manager.ts`

### Files to Reference/Reuse

- Task 1.4 (connection manager)
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/presence-manager.test.ts`
  - Test presence update
  - Test presence query
  - Test presence broadcast
  - Test presence subscription
  - Test presence cleanup
  - Test presence timeout

### Implementation Details

#### Presence Types

```typescript
type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

type PresenceInfo = {
  connectionId: string;
  clientId?: string;
  status: PresenceStatus;
  metadata?: Record<string, unknown>;
  lastSeen: number;
};
```

#### Presence Manager Class

```typescript
class PresenceManager {
  private presence: Map<string, PresenceInfo>; // connectionId -> presence
  private clientIndex: Map<string, Set<string>>; // clientId -> connectionIds
  private statusIndex: Map<PresenceStatus, Set<string>>; // status -> connectionIds
  private subscribers: Set<string>; // connectionIds subscribed to presence events
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger);

  // Presence management
  updatePresence(
    connectionId: string,
    status: PresenceStatus,
    metadata?: Record<string, unknown>,
  ): void;

  getPresence(connectionId: string): PresenceInfo | undefined;
  getClientPresence(clientId: string): PresenceInfo[];
  getAllPresence(): PresenceInfo[];
  getPresenceByStatus(status: PresenceStatus): PresenceInfo[];

  // Subscription management
  subscribe(connectionId: string): void;
  unsubscribe(connectionId: string): void;
  isSubscribed(connectionId: string): boolean;

  // Query
  findOnlineClients(): string[];
  findClientsByStatus(status: PresenceStatus): string[];

  // Cleanup
  removeConnection(connectionId: string): void;
  cleanupStalePresence(timeoutMs: number): number;
  clear(): void;
}
```

#### Presence Events

```typescript
type PresenceChangedEvent = {
  type: 'presence.changed';
  payload: {
    connectionId: string;
    clientId?: string;
    status: PresenceStatus;
    metadata?: Record<string, unknown>;
    changedAt: string;
  };
};

type PresenceOnlineEvent = {
  type: 'presence.online';
  payload: {
    connectionId: string;
    clientId?: string;
    metadata?: Record<string, unknown>;
    onlineAt: string;
  };
};

type PresenceOfflineEvent = {
  type: 'presence.offline';
  payload: {
    connectionId: string;
    clientId?: string;
    offlineAt: string;
  };
};
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)

### Success Criteria

- Presence is tracked correctly
- Presence changes are broadcast
- Subscriptions work properly
- Stale presence is cleaned up
- All operations are tested

---

## Task 5.3: Create Presence Handler

### Description

Implement WebSocket message handlers for presence operations: update, get, and subscribe.

### Expected Results

- `apps/server/src/websocket/handlers/presence.ts`
- Handles all presence-related WebSocket messages
- Integrates with PresenceManager
- Broadcasts presence events

### Files to Create

- `apps/server/src/websocket/handlers/presence.ts`

### Files to Reference/Reuse

- Task 5.2 (presence manager)
- Task 1.1 (shared types)
- Task 1.4 (connection manager)

### Expected Tests

- `apps/server/src/websocket/handlers/presence.test.ts`
  - Test presence.update handler
  - Test presence.get handler
  - Test presence.subscribe handler
  - Test presence.unsubscribe handler
  - Test error handling for invalid status
  - Test error handling for missing connection

### Implementation Details

#### Presence Handler Class

```typescript
class PresenceHandler {
  private presenceManager: PresenceManager;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;

  constructor(
    presenceManager: PresenceManager,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  );

  // Handler functions
  async handleUpdate(
    connectionId: string,
    request: PresenceUpdateRequest,
    context: HandlerContext,
  ): Promise<{ success: boolean } | ErrorResponse>;

  async handleGet(
    connectionId: string,
    request: PresenceGetRequest,
    context: HandlerContext,
  ): Promise<PresenceInfo | PresenceInfo[] | ErrorResponse>;

  async handleSubscribe(
    connectionId: string,
    request: PresenceSubscribeRequest,
    context: HandlerContext,
  ): Promise<{ subscribed: boolean } | ErrorResponse>;

  async handleUnsubscribe(
    connectionId: string,
    request: PresenceUnsubscribeRequest,
    context: HandlerContext,
  ): Promise<{ subscribed: boolean } | ErrorResponse>;
}
```

#### Presence Event Broadcasting

```typescript
function broadcastPresenceChanged(
  connectionId: string,
  status: PresenceStatus,
  metadata: Record<string, unknown> | undefined,
  presenceManager: PresenceManager,
  connectionManager: ConnectionManager,
): void {
  const connection = connectionManager.getConnection(connectionId);
  if (!connection) {
    return;
  }

  const event: PresenceChangedEvent = {
    type: 'presence.changed',
    payload: {
      connectionId,
      clientId: connection.clientId,
      status,
      metadata,
      changedAt: new Date().toISOString(),
    },
  };

  // Broadcast to all presence subscribers
  const subscribers = presenceManager.getSubscribers();
  for (const subscriberId of subscribers) {
    if (subscriberId !== connectionId) {
      connectionManager.send(subscriberId, event as WSMessage);
    }
  }
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Task 5.2 (presence manager)

### Success Criteria

- All presence handlers work correctly
- Integration with PresenceManager is complete
- Presence events are broadcast
- Error handling is comprehensive
- All operations are tested

---

## Task 5.4: Create Configuration Event Types

### Description

Define configuration-specific event types for WebSocket communication.

### Expected Results

- Configuration event types added to shared types
- Event types are properly typed
- Type guards for configuration events

### Files to Modify

- `packages/shared-types/src/websocket.ts`

### Files to Reference/Reuse

- Task 1.1 (shared types)
- `packages/shared-types/src/events.ts` - Existing event types

### Expected Tests

- `packages/shared-types/src/websocket.test.ts` (update existing tests)
  - Test config event type guards
  - Test config event validation
  - Test config event serialization

### Implementation Details

#### Configuration Event Types

```typescript
// Configuration updated event
type ConfigUpdatedEvent = {
  type: 'config.updated';
  payload: {
    updates: Record<string, unknown>;
    updatedAt: string;
    updatedBy?: string;
  };
};

// Configuration reloaded event
type ConfigReloadedEvent = {
  type: 'config.reloaded';
  payload: {
    config: Record<string, unknown>;
    reloadedAt: string;
  };
};

// Configuration validation error event
type ConfigValidationErrorEvent = {
  type: 'config.validation_error';
  payload: {
    errors: string[];
    occurredAt: string;
  };
};

// Union type
type ConfigEvent =
  | ConfigUpdatedEvent
  | ConfigReloadedEvent
  | ConfigValidationErrorEvent;

// Type guards
function isConfigEvent(msg: unknown): msg is ConfigEvent;
function isConfigUpdatedEvent(msg: unknown): msg is ConfigUpdatedEvent;
function isConfigReloadedEvent(msg: unknown): msg is ConfigReloadedEvent;
function isConfigValidationErrorEvent(
  msg: unknown,
): msg is ConfigValidationErrorEvent;
```

### Dependencies

- Task 1.1 (shared types)

### Success Criteria

- All configuration event types are defined
- Type guards work correctly
- Events can be serialized/deserialized
- Tests cover all event types

---

## Task 5.5: Create Presence Event Types

### Description

Define presence-specific event types for WebSocket communication.

### Expected Results

- Presence event types added to shared types
- Event types are properly typed
- Type guards for presence events

### Files to Modify

- `packages/shared-types/src/websocket.ts`

### Files to Reference/Reuse

- Task 1.1 (shared types)
- Task 5.2 (presence manager types)

### Expected Tests

- `packages/shared-types/src/websocket.test.ts` (update existing tests)
  - Test presence event type guards
  - Test presence event validation
  - Test presence event serialization

### Implementation Details

#### Presence Event Types

```typescript
// Presence changed event
type PresenceChangedEvent = {
  type: 'presence.changed';
  payload: {
    connectionId: string;
    clientId?: string;
    status: PresenceStatus;
    metadata?: Record<string, unknown>;
    changedAt: string;
  };
};

// Presence online event
type PresenceOnlineEvent = {
  type: 'presence.online';
  payload: {
    connectionId: string;
    clientId?: string;
    metadata?: Record<string, unknown>;
    onlineAt: string;
  };
};

// Presence offline event
type PresenceOfflineEvent = {
  type: 'presence.offline';
  payload: {
    connectionId: string;
    clientId?: string;
    offlineAt: string;
  };
};

// Union type
type PresenceEvent =
  | PresenceChangedEvent
  | PresenceOnlineEvent
  | PresenceOfflineEvent;

// Type guards
function isPresenceEvent(msg: unknown): msg is PresenceEvent;
function isPresenceChangedEvent(msg: unknown): msg is PresenceChangedEvent;
function isPresenceOnlineEvent(msg: unknown): msg is PresenceOnlineEvent;
function isPresenceOfflineEvent(msg: unknown): msg is PresenceOfflineEvent;
```

### Dependencies

- Task 1.1 (shared types)
- Task 5.2 (presence manager)

### Success Criteria

- All presence event types are defined
- Type guards work correctly
- Events can be serialized/deserialized
- Tests cover all event types

---

## Task 5.6: Integrate Config & Presence Handlers with Message Router

### Description

Register configuration and presence handlers with message router.

### Expected Results

- Config handlers registered in message router
- Presence handlers registered in message router
- End-to-end config operations work via WebSocket
- End-to-end presence operations work via WebSocket

### Files to Modify

- `apps/server/src/websocket/index.ts` - Gateway plugin
- `apps/server/src/websocket/message-router.ts` - Message router

### Files to Reference/Reuse

- Task 5.1 (config handler)
- Task 5.3 (presence handler)
- Task 1.5 (message router)

### Expected Tests

- `apps/server/src/websocket/config-presence-integration.test.ts`
  - Test end-to-end config.get
  - Test end-to-end config.update
  - Test end-to-end config.watch
  - Test end-to-end presence.update
  - Test end-to-end presence.subscribe
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
  const presenceManager = new PresenceManager(app.log);

  // Create handlers
  const configHandler = new ConfigHandler(
    services.config,
    connectionManager,
    app.log,
  );

  const presenceHandler = new PresenceHandler(
    presenceManager,
    connectionManager,
    app.log,
  );

  // Register handlers with message router
  messageRouter.registerHandler(
    'config.get',
    configHandler.handleGet.bind(configHandler),
  );
  messageRouter.registerHandler(
    'config.update',
    configHandler.handleUpdate.bind(configHandler),
  );
  messageRouter.registerHandler(
    'config.watch',
    configHandler.handleWatch.bind(configHandler),
  );
  messageRouter.registerHandler(
    'config.unwatch',
    configHandler.handleUnwatch.bind(configHandler),
  );

  messageRouter.registerHandler(
    'presence.update',
    presenceHandler.handleUpdate.bind(presenceHandler),
  );
  messageRouter.registerHandler(
    'presence.get',
    presenceHandler.handleGet.bind(presenceHandler),
  );
  messageRouter.registerHandler(
    'presence.subscribe',
    presenceHandler.handleSubscribe.bind(presenceHandler),
  );
  messageRouter.registerHandler(
    'presence.unsubscribe',
    presenceHandler.handleUnsubscribe.bind(presenceHandler),
  );

  // Setup config change notifications
  services.config.on('changed', (updates) => {
    const event: ConfigUpdatedEvent = {
      type: 'config.updated',
      payload: {
        updates,
        updatedAt: new Date().toISOString(),
      },
    };

    // Broadcast to all connections
    connectionManager.broadcast(event as WSMessage);
  });

  // Setup presence cleanup
  const presenceCleanupInterval = setInterval(() => {
    presenceManager.cleanupStalePresence(config.heartbeatInterval * 3);
  }, 60000); // Every minute

  // Cleanup
  fastify.addHook('onClose', async () => {
    clearInterval(presenceCleanupInterval);
    presenceManager.clear();
  });
};
```

### Dependencies

- All previous Phase 5 tasks
- Task 1.5 (message router)

### Success Criteria

- All config handlers are registered
- All presence handlers are registered
- Config operations work end-to-end
- Presence operations work end-to-end
- Config changes are broadcast
- Presence changes are broadcast
- Integration tests pass

---

## Task 5.7: Create Config & Presence Integration Tests

### Description

Create comprehensive integration tests for configuration and presence operations via WebSocket.

### Expected Results

- Integration test suite for configuration operations
- Integration test suite for presence operations
- Tests cover all handlers
- Tests cover event broadcasting

### Files to Create

- `apps/server/src/websocket/integration/config-presence-integration.test.ts`

### Files to Reference/Reuse

- `apps/server/src/config/service.test.ts` - ConfigService test patterns
- Task 5.1-5.6 (config/presence components)

### Expected Tests

#### Configuration Tests

- Test getting full configuration
- Test getting configuration by path
- Test updating configuration
- Test updating multiple paths
- Test configuration validation
- Test configuration watch
- Test configuration unwatch
- Test receiving config.updated event
- Test error for missing permissions
- Test error for invalid config

#### Presence Tests

- Test updating presence status
- Test updating presence with metadata
- Test getting own presence
- Test getting client presence
- Test getting all presence
- Test getting presence by status
- Test subscribing to presence events
- Test unsubscribing from presence events
- Test receiving presence.changed event
- Test receiving presence.online event
- Test receiving presence.offline event
- Test error for invalid status

#### Event Broadcasting Tests

- Test config updates are broadcast
- Test presence changes are broadcast
- Test only subscribers receive events
- Test events are not sent to sender

#### Error Handling Tests

- Test invalid configuration path
- Test invalid presence status
- Test missing permissions
- Test rate limiting
- Test connection timeout

### Dependencies

- All previous Phase 5 tasks

### Success Criteria

- All integration tests pass
- Tests cover happy paths
- Tests cover error cases
- Tests are maintainable and clear
- Test coverage >90% for config/presence code

---

## Phase 5 Completion Criteria

- All tasks completed and tested
- Configuration operations work via WebSocket
- Presence system is functional
- Configuration changes are broadcast
- Presence changes are broadcast
- All tests passing with >90% coverage
- Documentation updated

---

## Next Phase

After completing Phase 5, proceed to **Phase 6: Testing & Documentation** which will create comprehensive test suites, documentation, and client SDK.
