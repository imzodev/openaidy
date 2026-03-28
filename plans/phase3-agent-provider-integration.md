# Phase 3: Agent & Provider Integration - Detailed Tasks

## Overview

This phase implements agent and provider query endpoints, integrates with AgentRegistry and ProviderServices, and exposes agent/provider capabilities to WebSocket clients.

---

## Task 3.1: Create Agent Handler

### Description

Implement WebSocket message handlers for agent operations: list, get, and query.

### Expected Results

- `apps/server/src/websocket/handlers/agent.ts`
- Handles all agent-related WebSocket messages
- Integrates with AgentRegistry
- Returns properly formatted responses

### Files to Create

- `apps/server/src/websocket/handlers/agent.ts`

### Files to Reference/Reuse

- `apps/server/src/agents/registry.ts` - AgentRegistry
- `apps/server/src/agents/schema.ts` - Agent schema
- `apps/server/src/routes/agents.ts` - REST API patterns
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/handlers/agent.test.ts`
  - Test agent.list handler
  - Test agent.get handler
  - Test agent query with filters
  - Test error handling for non-existent agent
  - Test error handling for missing permissions

### Implementation Details

#### Agent Handler Class

```typescript
class AgentHandler {
  private agentRegistry: AgentRegistry;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;

  constructor(
    agentRegistry: AgentRegistry,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  );

  // Handler functions
  async handleList(
    connectionId: string,
    request: AgentListRequest,
    context: HandlerContext,
  ): Promise<AgentListResponse | ErrorResponse>;

  async handleGet(
    connectionId: string,
    request: AgentGetRequest,
    context: HandlerContext,
  ): Promise<Agent | ErrorResponse>;

  async handleQuery(
    connectionId: string,
    request: AgentQueryRequest,
    context: HandlerContext,
  ): Promise<{ agents: Agent[] } | ErrorResponse>;
}
```

#### Response Mappers

```typescript
function mapAgentToResponse(agent: Agent): Agent;
function mapAgentCapability(capability: string): string;
```

#### Query Filters

```typescript
type AgentQueryFilter = {
  capability?: string;
  providerId?: string;
  modelId?: string;
  name?: string;
  description?: string;
};
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Task 1.5 (message router)
- Existing AgentRegistry

### Success Criteria

- All agent handlers work correctly
- Integration with AgentRegistry is complete
- Query filters work properly
- Error handling is comprehensive
- All operations are tested

---

## Task 3.2: Create Provider Handler

### Description

Implement WebSocket message handlers for provider operations: list, get, and models.

### Expected Results

- `apps/server/src/websocket/handlers/provider.ts`
- Handles all provider-related WebSocket messages
- Integrates with ProviderServices
- Returns properly formatted responses

### Files to Create

- `apps/server/src/websocket/handlers/provider.ts`

### Files to Reference/Reuse

- `apps/server/src/providers/index.ts` - ProviderServices
- `apps/server/src/providers/registry.ts` - ProviderRegistry
- `apps/server/src/providers/types.ts` - Provider types
- `apps/server/src/routes/providers.ts` - REST API patterns
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/handlers/provider.test.ts`
  - Test provider.list handler
  - Test provider.get handler
  - Test provider.models handler
  - Test error handling for non-existent provider
  - Test error handling for missing permissions

### Implementation Details

#### Provider Handler Class

```typescript
class ProviderHandler {
  private providerServices: ProviderServices;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;

  constructor(
    providerServices: ProviderServices,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  );

  // Handler functions
  async handleList(
    connectionId: string,
    request: ProviderListRequest,
    context: HandlerContext,
  ): Promise<ProviderListResponse | ErrorResponse>;

  async handleGet(
    connectionId: string,
    request: ProviderGetRequest,
    context: HandlerContext,
  ): Promise<Provider | ErrorResponse>;

  async handleModels(
    connectionId: string,
    request: ProviderModelsRequest,
    context: HandlerContext,
  ): Promise<{ models: Model[] } | ErrorResponse>;

  async handleCapabilities(
    connectionId: string,
    request: ProviderCapabilitiesRequest,
    context: HandlerContext,
  ): Promise<{ capabilities: string[] } | ErrorResponse>;
}
```

#### Response Mappers

```typescript
function mapProviderToResponse(provider: Provider): Provider;
function mapModelToResponse(model: Model): Model;
function mapCapability(capability: ProviderCapability): string;
```

#### Capability Filtering

```typescript
function filterProvidersByCapability(
  providers: Provider[],
  capability: string,
): Provider[];

function filterModelsByCapability(models: Model[], capability: string): Model[];
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Task 1.5 (message router)
- Existing ProviderServices

### Success Criteria

- All provider handlers work correctly
- Integration with ProviderServices is complete
- Capability filtering works properly
- Error handling is comprehensive
- All operations are tested

---

## Task 3.3: Create Agent Event Types

### Description

Define agent-specific event types for WebSocket communication.

### Expected Results

- Agent event types added to shared types
- Event types are properly typed
- Type guards for agent events

### Files to Modify

- `packages/shared-types/src/websocket.ts`

### Files to Reference/Reuse

- Task 1.1 (shared types)
- `packages/shared-types/src/events.ts` - Existing event types

### Expected Tests

- `packages/shared-types/src/websocket.test.ts` (update existing tests)
  - Test agent event type guards
  - Test agent event validation
  - Test agent event serialization

### Implementation Details

#### Agent Event Types

```typescript
// Agent registered event
type AgentRegisteredEvent = {
  type: 'agent.registered';
  payload: {
    agentId: string;
    name: string;
    capabilities: string[];
    registeredAt: string;
  };
};

// Agent updated event
type AgentUpdatedEvent = {
  type: 'agent.updated';
  payload: {
    agentId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  };
};

// Agent unregistered event
type AgentUnregisteredEvent = {
  type: 'agent.unregistered';
  payload: {
    agentId: string;
    unregisteredAt: string;
  };
};

// Union type
type AgentEvent =
  | AgentRegisteredEvent
  | AgentUpdatedEvent
  | AgentUnregisteredEvent;

// Type guards
function isAgentEvent(msg: unknown): msg is AgentEvent;
function isAgentRegisteredEvent(msg: unknown): msg is AgentRegisteredEvent;
function isAgentUpdatedEvent(msg: unknown): msg is AgentUpdatedEvent;
function isAgentUnregisteredEvent(msg: unknown): msg is AgentUnregisteredEvent;
```

### Dependencies

- Task 1.1 (shared types)

### Success Criteria

- All agent event types are defined
- Type guards work correctly
- Events can be serialized/deserialized
- Tests cover all event types

---

## Task 3.4: Create Provider Event Types

### Description

Define provider-specific event types for WebSocket communication.

### Expected Results

- Provider event types added to shared types
- Event types are properly typed
- Type guards for provider events

### Files to Modify

- `packages/shared-types/src/websocket.ts`

### Files to Reference/Reuse

- Task 1.1 (shared types)
- `packages/shared-types/src/events.ts` - Existing event types

### Expected Tests

- `packages/shared-types/src/websocket.test.ts` (update existing tests)
  - Test provider event type guards
  - Test provider event validation
  - Test provider event serialization

### Implementation Details

#### Provider Event Types

```typescript
// Provider registered event
type ProviderRegisteredEvent = {
  type: 'provider.registered';
  payload: {
    providerId: string;
    name: string;
    vendorFamily: string;
    capabilities: string[];
    registeredAt: string;
  };
};

// Provider updated event
type ProviderUpdatedEvent = {
  type: 'provider.updated';
  payload: {
    providerId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  };
};

// Provider unregistered event
type ProviderUnregisteredEvent = {
  type: 'provider.unregistered';
  payload: {
    providerId: string;
    unregisteredAt: string;
  };
};

// Model added event
type ModelAddedEvent = {
  type: 'model.added';
  payload: {
    providerId: string;
    modelId: string;
    name: string;
    capabilities: string[];
    addedAt: string;
  };
};

// Union type
type ProviderEvent =
  | ProviderRegisteredEvent
  | ProviderUpdatedEvent
  | ProviderUnregisteredEvent
  | ModelAddedEvent;

// Type guards
function isProviderEvent(msg: unknown): msg is ProviderEvent;
function isProviderRegisteredEvent(
  msg: unknown,
): msg is ProviderRegisteredEvent;
function isProviderUpdatedEvent(msg: unknown): msg is ProviderUpdatedEvent;
function isProviderUnregisteredEvent(
  msg: unknown,
): msg is ProviderUnregisteredEvent;
function isModelAddedEvent(msg: unknown): msg is ModelAddedEvent;
```

### Dependencies

- Task 1.1 (shared types)

### Success Criteria

- All provider event types are defined
- Type guards work correctly
- Events can be serialized/deserialized
- Tests cover all event types

---

## Task 3.5: Integrate Agent & Provider Handlers with Message Router

### Description

Register agent and provider handlers with the message router.

### Expected Results

- Agent handlers registered in message router
- Provider handlers registered in message router
- End-to-end agent operations work via WebSocket
- End-to-end provider operations work via WebSocket

### Files to Modify

- `apps/server/src/websocket/index.ts` - Gateway plugin
- `apps/server/src/websocket/message-router.ts` - Message router

### Files to Reference/Reuse

- Task 3.1 (agent handler)
- Task 3.2 (provider handler)
- Task 1.5 (message router)

### Expected Tests

- `apps/server/src/websocket/agent-provider-integration.test.ts`
  - Test end-to-end agent.list
  - Test end-to-end agent.get
  - Test end-to-end provider.list
  - Test end-to-end provider.models
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

  // Create handlers
  const agentHandler = new AgentHandler(
    services.agents,
    connectionManager,
    app.log,
  );

  const providerHandler = new ProviderHandler(
    services.providers,
    connectionManager,
    app.log,
  );

  // Register handlers with message router
  messageRouter.registerHandler(
    'agent.list',
    agentHandler.handleList.bind(agentHandler),
  );
  messageRouter.registerHandler(
    'agent.get',
    agentHandler.handleGet.bind(agentHandler),
  );
  messageRouter.registerHandler(
    'agent.query',
    agentHandler.handleQuery.bind(agentHandler),
  );

  messageRouter.registerHandler(
    'provider.list',
    providerHandler.handleList.bind(providerHandler),
  );
  messageRouter.registerHandler(
    'provider.get',
    providerHandler.handleGet.bind(providerHandler),
  );
  messageRouter.registerHandler(
    'provider.models',
    providerHandler.handleModels.bind(providerHandler),
  );
  messageRouter.registerHandler(
    'provider.capabilities',
    providerHandler.handleCapabilities.bind(providerHandler),
  );

  // ... rest of setup ...
};
```

### Dependencies

- All previous Phase 3 tasks
- Task 1.5 (message router)

### Success Criteria

- All agent handlers are registered
- All provider handlers are registered
- Agent operations work end-to-end
- Provider operations work end-to-end
- Integration tests pass

---

## Task 3.6: Create Agent & Provider Integration Tests

### Description

Create comprehensive integration tests for agent and provider operations via WebSocket.

### Expected Results

- Integration test suite for agent operations
- Integration test suite for provider operations
- Tests cover all handlers
- Tests cover error cases

### Files to Create

- `apps/server/src/websocket/integration/agent-provider-integration.test.ts`

### Files to Reference/Reuse

- `apps/server/src/agents/registry.test.ts` - AgentRegistry test patterns
- `apps/server/src/providers/registry.test.ts` - ProviderRegistry test patterns
- Task 3.1-3.5 (agent/provider components)

### Expected Tests

#### Agent Tests

- Test listing all agents
- Test getting a specific agent
- Test querying agents by capability
- Test querying agents by provider
- Test querying agents by model
- Test error for non-existent agent
- Test error for missing permissions

#### Provider Tests

- Test listing all providers
- Test getting a specific provider
- Test listing provider models
- Test getting provider capabilities
- Test error for non-existent provider
- Test error for missing permissions

#### Event Tests

- Test receiving agent.registered event
- Test receiving agent.updated event
- Test receiving provider.registered event
- Test receiving model.added event

#### Error Handling Tests

- Test invalid agent ID
- Test invalid provider ID
- Test missing permissions
- Test rate limiting

### Dependencies

- All previous Phase 3 tasks

### Success Criteria

- All integration tests pass
- Tests cover happy paths
- Tests cover error cases
- Tests are maintainable and clear
- Test coverage >90% for agent/provider code

---

## Phase 3 Completion Criteria

- All tasks completed and tested
- Agent operations work via WebSocket
- Provider operations work via WebSocket
- Integration with AgentRegistry is complete
- Integration with ProviderServices is complete
- All tests passing with >90% coverage
- Documentation updated

---

## Next Phase

After completing Phase 3, proceed to **Phase 4: Device/Node Support** which will implement node registration, invocation, capability system, and pairing flow.
