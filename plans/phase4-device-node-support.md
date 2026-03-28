# Phase 4: Device/Node Support - Detailed Tasks

## Overview

This phase implements node registration, invocation, capability system, and pairing flow for device management.

---

## Task 4.1: Create Node Registry

### Description

Implement a registry for tracking connected nodes/devices with their capabilities and metadata.

### Expected Results

- `apps/server/src/websocket/node-registry.ts`
- Tracks registered nodes
- Manages node capabilities
- Handles node lifecycle (register, update, unregister)
- Provides node lookup and query capabilities

### Files to Create

- `apps/server/src/websocket/node-registry.ts`

### Files to Reference/Reuse

- `apps/server/src/agents/registry.ts` - For registry pattern reference
- `apps/server/src/instances/service.ts` - For instance management patterns
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/node-registry.test.ts`
  - Test node registration
  - Test node lookup
  - Test node query by capability
  - Test node update
  - Test node unregistration
  - Test node expiration
  - Test node cleanup

### Implementation Details

#### Node Types

```typescript
type NodeType = 'mobile' | 'desktop' | 'browser' | 'channel' | 'service';

type NodeStatus = 'online' | 'offline' | 'stale';

type Node = {
  nodeId: string;
  name: string;
  type: NodeType;
  status: NodeStatus;
  capabilities: string[];
  metadata: Record<string, unknown>;
  connectionId?: string;
  lastSeen: number;
  registeredAt: number;
  tokenHash?: string;
  scopes?: string[];
};
```

#### Node Registry Class

```typescript
class NodeRegistry {
  private nodes: Map<string, Node>;
  private capabilityIndex: Map<string, Set<string>>; // capability -> nodeIds
  private connectionIndex: Map<string, string>; // connectionId -> nodeId
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger);

  // Node lifecycle
  registerNode(node: Node): void;
  unregisterNode(nodeId: string): void;
  updateNode(nodeId: string, updates: Partial<Node>): void;

  // Node lookup
  getNode(nodeId: string): Node | undefined;
  getNodeByConnection(connectionId: string): Node | undefined;
  getAllNodes(): Node[];
  getOnlineNodes(): Node[];

  // Query
  findNodesByCapability(capability: string): Node[];
  findNodesByCapabilities(capabilities: string[]): Node[];
  findNodesByType(type: NodeType): Node[];

  // Status management
  updateLastSeen(nodeId: string): void;
  markOffline(nodeId: string): void;
  markStale(nodeId: string): void;
  checkStaleNodes(timeoutMs: number): string[];

  // Cleanup
  cleanupStaleNodes(timeoutMs: number): number;
  clear(): void;
}
```

#### Capability Indexing

```typescript
class CapabilityIndex {
  private index: Map<string, Set<string>>; // capability -> nodeIds

  addCapability(nodeId: string, capability: string): void;
  removeCapability(nodeId: string, capability: string): void;
  removeNode(nodeId: string): void;
  findNodes(capability: string): Set<string>;
  findNodesWithAll(capabilities: string[]): Set<string>;
  findNodesWithAny(capabilities: string[]): Set<string>;
}
```

### Dependencies

- Task 1.1 (shared types)
- Existing logger

### Success Criteria

- Nodes are tracked correctly
- Capability indexing works
- Node lookup is efficient
- Stale nodes are cleaned up
- All operations are tested

---

## Task 4.2: Create Node Handler

### Description

Implement WebSocket message handlers for node operations: list, describe, invoke, and register.

### Expected Results

- `apps/server/src/websocket/handlers/node.ts`
- Handles all node-related WebSocket messages
- Integrates with NodeRegistry
- Handles node capability invocation

### Files to Create

- `apps/server/src/websocket/handlers/node.ts`

### Files to Reference/Reuse

- Task 4.1 (node registry)
- Task 1.1 (shared types)
- Task 1.4 (connection manager)

### Expected Tests

- `apps/server/src/websocket/handlers/node.test.ts`
  - Test node.list handler
  - Test node.describe handler
  - Test node.invoke handler
  - Test node.register handler
  - Test error handling for non-existent node
  - Test error handling for missing capabilities
  - Test error handling for permission denied

### Implementation Details

#### Node Handler Class

```typescript
class NodeHandler {
  private nodeRegistry: NodeRegistry;
  private connectionManager: ConnectionManager;
  private logger: FastifyBaseLogger;

  constructor(
    nodeRegistry: NodeRegistry,
    connectionManager: ConnectionManager,
    logger: FastifyBaseLogger,
  );

  // Handler functions
  async handleList(
    connectionId: string,
    request: NodeListRequest,
    context: HandlerContext,
  ): Promise<{ nodes: Node[] } | ErrorResponse>;

  async handleDescribe(
    connectionId: string,
    request: NodeDescribeRequest,
    context: HandlerContext,
  ): Promise<Node | ErrorResponse>;

  async handleInvoke(
    connectionId: string,
    request: NodeInvokeRequest,
    context: HandlerContext,
  ): Promise<{ result: unknown } | ErrorResponse>;

  async handleRegister(
    connectionId: string,
    request: NodeRegisterRequest,
    context: HandlerContext,
  ): Promise<NodeRegisteredResponse | ErrorResponse>;

  async handleUnregister(
    connectionId: string,
    request: NodeUnregisterRequest,
    context: HandlerContext,
  ): Promise<{ success: boolean } | ErrorResponse>;
}
```

#### Capability Invocation

```typescript
async function invokeNodeCapability(
  nodeId: string,
  capability: string,
  params: Record<string, unknown>,
  nodeRegistry: NodeRegistry,
  connectionManager: ConnectionManager,
): Promise<unknown> {
  const node = nodeRegistry.getNode(nodeId);
  if (!node) {
    throw new Error('Node not found');
  }

  if (!node.capabilities.includes(capability)) {
    throw new Error('Node does not have capability');
  }

  if (!node.connectionId) {
    throw new Error('Node is not connected');
  }

  // Send invocation request to node
  const message: WSMessage = {
    id: generateId(),
    type: 'node.invoke',
    timestamp: new Date().toISOString(),
    payload: {
      nodeId,
      capability,
      params,
    },
  };

  connectionManager.send(node.connectionId, message);

  // Wait for response (implementation depends on response mechanism)
  // This might involve a promise that resolves when response is received
  return await waitForNodeResponse(node.connectionId, message.id);
}
```

#### Permission Checks

```typescript
async function checkNodeInvokePermission(
  connectionId: string,
  nodeId: string,
  capability: string,
  connectionManager: ConnectionManager,
): Promise<boolean> {
  const connection = connectionManager.getConnection(connectionId);
  if (!connection || !connection.authenticated) {
    return false;
  }

  // Check if connection has node.invoke capability
  if (!connection.capabilities.includes('node.invoke')) {
    return false;
  }

  // Additional permission checks can be added here
  return true;
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Task 4.1 (node registry)

### Success Criteria

- All node handlers work correctly
- Capability invocation works
- Permission checks are enforced
- Error handling is comprehensive
- All operations are tested

---

## Task 4.3: Create Pairing Service

### Description

Implement pairing service that manages device pairing requests, approval flow, and token generation.

### Expected Results

- `apps/server/src/websocket/pairing-service.ts`
- Manages pairing requests
- Generates pairing codes
- Handles approval/denial
- Generates scoped tokens

### Files to Create

- `apps/server/src/websocket/pairing-service.ts`

### Files to Reference/Reuse

- Task 1.6 (auth middleware) - For token generation
- Task 1.2 (configuration) - For pairing configuration
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/pairing-service.test.ts`
  - Test pairing request creation
  - Test pairing code generation
  - Test pairing request approval
  - Test pairing request denial
  - Test token generation
  - Test token validation
  - Test pairing request expiration
  - Test pairing request cleanup

### Implementation Details

#### Pairing Request Types

```typescript
type PairingRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

type PairingRequest = {
  requestId: string;
  pairingCode: string;
  deviceName: string;
  deviceType: NodeType;
  capabilities: string[];
  metadata?: Record<string, unknown>;
  status: PairingRequestStatus;
  requestedAt: string;
  expiresAt: string;
  approvedAt?: string;
  approvedBy?: string;
  deniedAt?: string;
  deniedBy?: string;
  nodeId?: string;
  token?: string;
  scopes?: string[];
};
```

#### Pairing Service Class

```typescript
class PairingService {
  private requests: Map<string, PairingRequest>;
  private codeIndex: Map<string, string>; // pairingCode -> requestId
  private config: PairingConfig;
  private authMiddleware: AuthMiddleware;
  private logger: FastifyBaseLogger;

  constructor(
    config: PairingConfig,
    authMiddleware: AuthMiddleware,
    logger: FastifyBaseLogger,
  );

  // Request lifecycle
  createRequest(
    deviceName: string,
    deviceType: NodeType,
    capabilities: string[],
    metadata?: Record<string, unknown>,
  ): PairingRequest;

  approveRequest(
    requestId: string,
    approvedBy: string,
    scopes?: string[],
  ): PairingRequest;

  denyRequest(requestId: string, deniedBy: string): PairingRequest;

  getRequest(requestId: string): PairingRequest | undefined;
  getRequestByCode(pairingCode: string): PairingRequest | undefined;
  getPendingRequests(): PairingRequest[];
  getAllRequests(): PairingRequest[];

  // Token management
  generateToken(requestId: string, scopes: string[]): string;
  validateToken(token: string): JWTPayload | null;
  revokeToken(token: string): void;

  // Cleanup
  cleanupExpiredRequests(): number;
  clear(): void;
}
```

#### Pairing Code Generator

```typescript
class PairingCodeGenerator {
  private length: number;
  private charset: string;

  constructor(length: number);

  generate(): string;
  validate(code: string): boolean;
}
```

#### Token Generator

```typescript
class PairingTokenGenerator {
  private secret: string;
  private defaultExpiry: number;
  private maxExpiry: number;

  constructor(secret: string, defaultExpiry: number, maxExpiry: number);

  generate(nodeId: string, scopes: string[], expiry?: number): string;

  validate(token: string): JWTPayload | null;
  refresh(refreshToken: string): string | null;
  revoke(token: string): void;
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.2 (configuration)
- Task 1.6 (auth middleware)

### Success Criteria

- Pairing requests are managed correctly
- Pairing codes are generated securely
- Approval flow works
- Tokens are generated and validated
- Expired requests are cleaned up
- All operations are tested

---

## Task 4.4: Create Pairing Handler

### Description

Implement WebSocket message handlers for pairing operations: request, status, approve, and deny.

### Expected Results

- `apps/server/src/websocket/handlers/pairing.ts`
- Handles all pairing-related WebSocket messages
- Integrates with PairingService
- Manages pairing flow

### Files to Create

- `apps/server/src/websocket/handlers/pairing.ts`

### Files to Reference/Reuse

- Task 4.3 (pairing service)
- Task 1.1 (shared types)
- Task 1.4 (connection manager)

### Expected Tests

- `apps/server/src/websocket/handlers/pairing.test.ts`
  - Test pairing.request handler
  - Test pairing.status handler
  - Test pairing.approve handler
  - Test pairing.deny handler
  - Test error handling for invalid code
  - Test error handling for expired request
  - Test error handling for insufficient permissions

### Implementation Details

#### Pairing Handler Class

```typescript
class PairingHandler {
  private pairingService: PairingService;
  private connectionManager: ConnectionManager;
  private nodeRegistry: NodeRegistry;
  private logger: FastifyBaseLogger;

  constructor(
    pairingService: PairingService,
    connectionManager: ConnectionManager,
    nodeRegistry: NodeRegistry,
    logger: FastifyBaseLogger,
  );

  // Handler functions
  async handleRequest(
    connectionId: string,
    request: PairingRequest,
    context: HandlerContext,
  ): Promise<PairingRequestedEvent | ErrorResponse>;

  async handleStatus(
    connectionId: string,
    request: PairingStatusRequest,
    context: HandlerContext,
  ): Promise<PairingStatusResponse | ErrorResponse>;

  async handleApprove(
    connectionId: string,
    request: PairingApproveRequest,
    context: HandlerContext,
  ): Promise<PairingApprovedResponse | ErrorResponse>;

  async handleDeny(
    connectionId: string,
    request: PairingDenyRequest,
    context: HandlerContext,
  ): Promise<{ success: boolean } | ErrorResponse>;

  async handleList(
    connectionId: string,
    request: PairingListRequest,
    context: HandlerContext,
  ): Promise<{ requests: PairingRequest[] } | ErrorResponse>;
}
```

#### Pairing Flow

```typescript
async function handlePairingFlow(
  connectionId: string,
  deviceName: string,
  deviceType: NodeType,
  capabilities: string[],
  pairingService: PairingService,
  connectionManager: ConnectionManager,
): Promise<void> {
  // Create pairing request
  const request = pairingService.createRequest(
    deviceName,
    deviceType,
    capabilities,
  );

  // Send pairing requested event to connection
  const event: PairingRequestedEvent = {
    type: 'pairing.requested',
    payload: {
      requestId: request.requestId,
      pairingCode: request.pairingCode,
      deviceName: request.deviceName,
      deviceType: request.deviceType,
      capabilities: request.capabilities,
      requestedAt: request.requestedAt,
    },
  };

  connectionManager.send(connectionId, event as WSMessage);

  // Device should poll for status
  // When approved, device receives token and can register as node
}
```

#### Permission Checks

```typescript
async function checkPairingApprovePermission(
  connectionId: string,
  connectionManager: ConnectionManager,
): Promise<boolean> {
  const connection = connectionManager.getConnection(connectionId);
  if (!connection || !connection.authenticated) {
    return false;
  }

  // Check if connection has pairing.approve capability
  if (!connection.capabilities.includes('pairing.approve')) {
    return false;
  }

  return true;
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)
- Task 4.1 (node registry)
- Task 4.3 (pairing service)

### Success Criteria

- All pairing handlers work correctly
- Pairing flow works end-to-end
- Permission checks are enforced
- Error handling is comprehensive
- All operations are tested

---

## Task 4.5: Create Node Event Types

### Description

Define node-specific event types for WebSocket communication.

### Expected Results

- Node event types added to shared types
- Event types are properly typed
- Type guards for node events

### Files to Modify

- `packages/shared-types/src/websocket.ts`

### Files to Reference/Reuse

- Task 1.1 (shared types)
- Task 4.1 (node registry types)

### Expected Tests

- `packages/shared-types/src/websocket.test.ts` (update existing tests)
  - Test node event type guards
  - Test node event validation
  - Test node event serialization

### Implementation Details

#### Node Event Types

```typescript
// Node registered event
type NodeRegisteredEvent = {
  type: 'node.registered';
  payload: {
    nodeId: string;
    name: string;
    type: NodeType;
    capabilities: string[];
    registeredAt: string;
  };
};

// Node online event
type NodeOnlineEvent = {
  type: 'node.online';
  payload: {
    nodeId: string;
    capabilities: string[];
    metadata?: Record<string, unknown>;
    onlineAt: string;
  };
};

// Node offline event
type NodeOfflineEvent = {
  type: 'node.offline';
  payload: {
    nodeId: string;
    offlineAt: string;
  };
};

// Node invoked event
type NodeInvokedEvent = {
  type: 'node.invoked';
  payload: {
    nodeId: string;
    capability: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: WSError;
    invokedAt: string;
  };
};

// Node updated event
type NodeUpdatedEvent = {
  type: 'node.updated';
  payload: {
    nodeId: string;
    updates: Record<string, unknown>;
    updatedAt: string;
  };
};

// Node unregistered event
type NodeUnregisteredEvent = {
  type: 'node.unregistered';
  payload: {
    nodeId: string;
    unregisteredAt: string;
  };
};

// Union type
type NodeEvent =
  | NodeRegisteredEvent
  | NodeOnlineEvent
  | NodeOfflineEvent
  | NodeInvokedEvent
  | NodeUpdatedEvent
  | NodeUnregisteredEvent;

// Type guards
function isNodeEvent(msg: unknown): msg is NodeEvent;
function isNodeRegisteredEvent(msg: unknown): msg is NodeRegisteredEvent;
function isNodeOnlineEvent(msg: unknown): msg is NodeOnlineEvent;
function isNodeOfflineEvent(msg: unknown): msg is NodeOfflineEvent;
function isNodeInvokedEvent(msg: unknown): msg is NodeInvokedEvent;
```

### Dependencies

- Task 1.1 (shared types)
- Task 4.1 (node registry)

### Success Criteria

- All node event types are defined
- Type guards work correctly
- Events can be serialized/deserialized
- Tests cover all event types

---

## Task 4.6: Integrate Node & Pairing Handlers with Message Router

### Description

Register node and pairing handlers with message router.

### Expected Results

- Node handlers registered in message router
- Pairing handlers registered in message router
- End-to-end node operations work via WebSocket
- End-to-end pairing flow works via WebSocket

### Files to Modify

- `apps/server/src/websocket/index.ts` - Gateway plugin
- `apps/server/src/websocket/message-router.ts` - Message router

### Files to Reference/Reuse

- Task 4.2 (node handler)
- Task 4.4 (pairing handler)
- Task 1.5 (message router)

### Expected Tests

- `apps/server/src/websocket/node-pairing-integration.test.ts`
  - Test end-to-end node registration
  - Test end-to-end node invocation
  - Test end-to-end pairing request
  - Test end-to-end pairing approval
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

  // Create services
  const nodeRegistry = new NodeRegistry(app.log);
  const pairingService = new PairingService(
    config.pairing,
    authMiddleware,
    app.log,
  );

  // Create handlers
  const nodeHandler = new NodeHandler(nodeRegistry, connectionManager, app.log);

  const pairingHandler = new PairingHandler(
    pairingService,
    connectionManager,
    nodeRegistry,
    app.log,
  );

  // Register handlers with message router
  messageRouter.registerHandler(
    'node.list',
    nodeHandler.handleList.bind(nodeHandler),
  );
  messageRouter.registerHandler(
    'node.describe',
    nodeHandler.handleDescribe.bind(nodeHandler),
  );
  messageRouter.registerHandler(
    'node.invoke',
    nodeHandler.handleInvoke.bind(nodeHandler),
  );
  messageRouter.registerHandler(
    'node.register',
    nodeHandler.handleRegister.bind(nodeHandler),
  );
  messageRouter.registerHandler(
    'node.unregister',
    nodeHandler.handleUnregister.bind(nodeHandler),
  );

  messageRouter.registerHandler(
    'pairing.request',
    pairingHandler.handleRequest.bind(pairingHandler),
  );
  messageRouter.registerHandler(
    'pairing.status',
    pairingHandler.handleStatus.bind(pairingHandler),
  );
  messageRouter.registerHandler(
    'pairing.approve',
    pairingHandler.handleApprove.bind(pairingHandler),
  );
  messageRouter.registerHandler(
    'pairing.deny',
    pairingHandler.handleDeny.bind(pairingHandler),
  );
  messageRouter.registerHandler(
    'pairing.list',
    pairingHandler.handleList.bind(pairingHandler),
  );

  // Start cleanup tasks
  const cleanupInterval = setInterval(() => {
    pairingService.cleanupExpiredRequests();
    nodeRegistry.cleanupStaleNodes(config.heartbeatInterval * 2);
  }, 60000); // Every minute

  // Cleanup
  fastify.addHook('onClose', async () => {
    clearInterval(cleanupInterval);
    pairingService.clear();
    nodeRegistry.clear();
  });
};
```

### Dependencies

- All previous Phase 4 tasks
- Task 1.5 (message router)

### Success Criteria

- All node handlers are registered
- All pairing handlers are registered
- Node operations work end-to-end
- Pairing flow works end-to-end
- Integration tests pass

---

## Task 4.7: Create Node & Pairing Integration Tests

### Description

Create comprehensive integration tests for node and pairing operations via WebSocket.

### Expected Results

- Integration test suite for node operations
- Integration test suite for pairing operations
- Tests cover all handlers
- Tests cover error cases

### Files to Create

- `apps/server/src/websocket/integration/node-pairing-integration.test.ts`

### Files to Reference/Reuse

- Task 4.1-4.6 (node/pairing components)

### Expected Tests

#### Node Registration Tests

- Test node registration via WebSocket
- Test node registration with capabilities
- Test node registration with metadata
- Test node registration error handling
- Test node unregistration

#### Node Query Tests

- Test listing all nodes
- Test describing a specific node
- Test querying nodes by capability
- Test querying nodes by type
- Test error for non-existent node

#### Node Invocation Tests

- Test invoking a node capability
- Test invoking with parameters
- Test invocation error handling
- Test permission denied for invocation
- Test concurrent invocations

#### Pairing Request Tests

- Test creating a pairing request
- Test receiving pairing code
- Test pairing request with capabilities
- Test pairing request expiration
- Test error handling for invalid request

#### Pairing Approval Tests

- Test approving a pairing request
- Test approving with custom scopes
- Test denying a pairing request
- Test listing pending requests
- Test permission denied for approval

#### Pairing Flow Tests

- Test end-to-end pairing flow
- Test device receives token after approval
- Test device registers as node with token
- Test expired pairing request handling

#### Event Tests

- Test receiving node.registered event
- Test receiving node.online event
- Test receiving node.offline event
- Test receiving node.invoked event
- Test receiving pairing.requested event
- Test receiving pairing.approved event

#### Error Handling Tests

- Test invalid node ID
- Test invalid pairing code
- Test missing permissions
- Test rate limiting
- Test connection timeout

### Dependencies

- All previous Phase 4 tasks

### Success Criteria

- All integration tests pass
- Tests cover happy paths
- Tests cover error cases
- Tests are maintainable and clear
- Test coverage >90% for node/pairing code

---

## Phase 4 Completion Criteria

- All tasks completed and tested
- Node operations work via WebSocket
- Pairing flow works end-to-end
- Capability system is functional
- Token generation and validation works
- All tests passing with >90% coverage
- Documentation updated

---

## Next Phase

After completing Phase 4, proceed to **Phase 5: Configuration & Presence** which will implement configuration management, presence system, and related events.
