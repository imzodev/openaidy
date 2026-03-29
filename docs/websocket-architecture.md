# WebSocket Gateway Architecture Documentation

This document describes the architecture of the OpenAidy WebSocket gateway.

## Overview

### Design Goals

1. **Real-time Communication** - Enable bidirectional real-time communication between clients and server
2. **Scalability** - Support thousands of concurrent connections
3. **Reliability** - Automatic reconnection, heartbeat monitoring, graceful degradation
4. **Security** - JWT-based authentication, capability-based authorization
5. **Extensibility** - Plugin-based handler registration, middleware pipeline
6. **Type Safety** - Full TypeScript support with shared types

### Non-Goals

- Replacing REST API entirely (complementary, not replacement)
- Binary protocol support (JSON-based for simplicity)
- Cross-server message routing (single server design)
- Offline message queuing (stateless connections)

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Fastify Server                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  WebSocket Gateway Plugin                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │                   Gateway Core                      │  │  │
│  │  │  ┌─────────────┐    ┌──────────────────────────┐   │  │  │
│  │  │  │  Connection │    │     Message Router       │   │  │  │
│  │  │  │   Manager   │────▶                          │   │  │  │
│  │  │  └─────────────┘    └──────────┬───────────────┘   │  │  │
│  │  │                                │                    │  │  │
│  │  │  ┌────────────────────────────┼────────────────┐  │  │  │
│  │  │  │         Middleware Pipeline               │  │  │  │
│  │  │  │  ┌──────────┐  ┌─────────┐  ┌────────────┐ │  │  │  │
│  │  │  │  │   Auth   │─▶│  Rate   │─▶│   Error    │ │  │  │  │
│  │  │  │  │Middleware│  │ Limiter │  │  Handler   │ │  │  │  │
│  │  │  │  └──────────┘  └─────────┘  └────────────┘ │  │  │  │
│  │  │  └────────────────────────────┼────────────────┘  │  │  │
│  │  │                               │                    │  │  │
│  │  │  ┌────────────────────────────┼────────────────┐  │  │  │
│  │  │  │              Handlers                       │  │  │  │
│  │  │  │  ┌────────┐  ┌────────┐  ┌────────┐        │  │  │  │
│  │  │  │  │Session │  │ Agent  │  │Provider│        │  │  │  │
│  │  │  │  │Handler │  │Handler │  │Handler │        │  │  │  │
│  │  │  │  └────────┘  └────────┘  └────────┘        │  │  │  │
│  │  │  │  ┌────────┐  ┌────────┐  ┌────────┐        │  │  │  │
│  │  │  │  │  Node  │  │Pairing │  │ Config │        │  │  │  │
│  │  │  │  │Handler │  │Handler │  │Handler │        │  │  │  │
│  │  │  │  └────────┘  └────────┘  └────────┘        │  │  │  │
│  │  │  │  ┌────────┐                                 │  │  │  │
│  │  │  │  │Presence│                                 │  │  │  │
│  │  │  │  │Handler │                                 │  │  │  │
│  │  │  │  └────────┘                                 │  │  │  │
│  │  │  └─────────────────────────────────────────────┘  │  │  │
│  │  └───────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Connection Manager

**File:** `apps/server/src/websocket/connection-manager.ts`

**Purpose:** Manages WebSocket connections and their lifecycle.

**Responsibilities:**
- Register and track connections
- Assign unique connection IDs
- Monitor connection health (heartbeats)
- Rate limiting per connection
- Connection metadata management

**Key Properties:**
```typescript
class ConnectionManager {
  private connections: Map<string, ConnectionContext>;
  private config: WebSocketConfig;
  
  // Indexes for efficient lookups
  private connectionsByUser: Map<string, Set<string>>;
  private connectionsByCapability: Map<string, Set<string>>;
}
```

**Connection Context:**
```typescript
type ConnectionContext = {
  id: string;
  status: 'connected' | 'disconnected';
  authenticated: boolean;
  capabilities: string[];
  subscriptions: Set<string>;
  lastHeartbeat: number;
  createdAt: number;
  metadata: Record<string, unknown>;
  socket?: WebSocket;
  clientId?: string;
};
```

### 2. Message Router

**File:** `apps/server/src/websocket/message-router.ts`

**Purpose:** Routes incoming messages to appropriate handlers.

**Responsibilities:**
- Register message handlers by type
- Route messages to correct handlers
- Track pending requests for correlation
- Handle unknown message types

**Key Properties:**
```typescript
class MessageRouter {
  private handlers: Map<string, MessageHandler>;
  private logger: Logger;
  private pendingRequests: Map<string, PendingRequest>;
}
```

**Routing Logic:**
```typescript
async route(connectionId: string, message: WSMessage, context: HandlerContext): Promise<WSResponse | void> {
  const handler = this.handlers.get(message.type);
  
  if (!handler) {
    return createErrorResponse(
      message.id,
      WS_ERROR_CODES.UNKNOWN_MESSAGE_TYPE,
      `Unknown message type: ${message.type}`
    );
  }
  
  return handler(connectionId, message, context);
}
```

### 3. Authentication Middleware

**File:** `apps/server/src/websocket/middleware/auth.ts`

**Purpose:** Validates JWT tokens and extracts capabilities.

**Responsibilities:**
- Validate JWT signature and expiration
- Extract user identity and capabilities
- Handle token refresh

**Key Methods:**
```typescript
class AuthMiddleware {
  validateToken(token: string): Promise<AuthTokenPayload>;
  generateToken(payload: TokenPayload): Promise<string>;
  hasCapability(token: string, capability: string): boolean;
}
```

### 4. Rate Limiting Middleware

**File:** `apps/server/src/websocket/middleware/rate-limit.ts`

**Purpose:** Prevents abuse by limiting request frequency.

**Responsibilities:**
- Track requests per connection
- Enforce rate limits
- Allow burst handling

**Configuration:**
```typescript
type RateLimitConfig = {
  windowMs: number;      // Time window (default: 60000)
  maxRequests: number;   // Max requests per window (default: 100)
  skipFailed: boolean;   // Skip failed requests (default: false)
};
```

### 5. Error Handler

**File:** `apps/server/src/websocket/middleware/error.ts`

**Purpose:** Centralizes error handling and response formatting.

**Responsibilities:**
- Catch and format errors
- Map errors to error codes
- Log errors for debugging

## Handler Components

### Session Handler

**File:** `apps/server/src/websocket/handlers/session.ts`

**Handles:**
- `session.create` - Create new session
- `session.get` - Get session details
- `session.list` - List sessions
- `session.delete` - Delete session
- `session.message` - Send message to session

**Dependencies:**
- SessionService (from AppServices)

### Agent Handler

**File:** `apps/server/src/websocket/handlers/agent.ts`

**Handles:**
- `agent.list` - List available agents
- `agent.get` - Get agent details
- `agent.query` - Query agents by filter

**Dependencies:**
- AgentRegistry (from AppServices)

### Provider Handler

**File:** `apps/server/src/websocket/handlers/provider.ts`

**Handles:**
- `provider.list` - List providers
- `provider.get` - Get provider details
- `provider.models` - Get provider models

**Dependencies:**
- ProviderServices (from AppServices)

### Node Handler

**File:** `apps/server/src/websocket/handlers/node.ts`

**Handles:**
- `node.list` - List registered nodes
- `node.get` - Get node details
- `node.register` - Register a node
- `node.unregister` - Unregister a node
- `node.invoke` - Invoke node capability

**Dependencies:**
- NodeRegistry
- ConnectionManager

### Pairing Handler

**File:** `apps/server/src/websocket/handlers/pairing.ts`

**Handles:**
- `pairing.request` - Request pairing
- `pairing.status` - Check pairing status
- `pairing.approve` - Approve pairing
- `pairing.deny` - Deny pairing
- `pairing.list` - List pending requests

**Dependencies:**
- PairingService
- ConnectionManager
- NodeRegistry

### Config Handler

**File:** `apps/server/src/websocket/handlers/config.ts`

**Handles:**
- `config.get` - Get configuration
- `config.update` - Update configuration
- `config.watch` - Watch for changes
- `config.unwatch` - Stop watching

**Dependencies:**
- AppConfigService
- ConnectionManager

### Presence Handler

**File:** `apps/server/src/websocket/handlers/presence.ts`

**Handles:**
- `presence.update` - Update presence status
- `presence.get` - Get presence
- `presence.getAll` - Get all presence
- `presence.subscribe` - Subscribe to presence events
- `presence.unsubscribe` - Unsubscribe from events

**Dependencies:**
- PresenceManager
- ConnectionManager

## Service Components

### Node Registry

**File:** `apps/server/src/websocket/node-registry.ts`

**Purpose:** Tracks registered nodes and their capabilities.

**Key Features:**
- Register/unregister nodes
- Track node status (online/offline)
- Index nodes by capability
- Detect stale nodes

**Data Structure:**
```typescript
type Node = {
  nodeId: string;
  name: string;
  type: 'mobile' | 'desktop' | 'browser' | 'embedded';
  status: 'online' | 'offline' | 'stale';
  capabilities: string[];
  metadata: Record<string, unknown>;
  connectionId: string;
  registeredAt: number;
  lastSeen: number;
};

class NodeRegistry {
  private nodes: Map<string, Node>;
  private capabilityIndex: Map<string, Set<string>>;  // capability -> nodeIds
  private connectionIndex: Map<string, string>;       // connectionId -> nodeId
}
```

### Pairing Service

**File:** `apps/server/src/websocket/pairing-service.ts`

**Purpose:** Manages device pairing flow.

**Key Features:**
- Generate pairing codes
- Track pending requests
- Approve/deny requests
- Generate node tokens

**Pairing Flow:**
```
1. Device requests pairing → 6-digit code generated
2. Admin enters code → Approve/deny
3. On approval → Node ID and JWT token generated
4. Device uses token → Authenticated as node
```

### Presence Manager

**File:** `apps/server/src/websocket/presence-manager.ts`

**Purpose:** Tracks user presence across connections.

**Key Features:**
- Update presence status
- Track by connection, client, and status
- Manage subscribers for presence events
- Clean up stale presence

**Data Structure:**
```typescript
type PresenceInfo = {
  connectionId: string;
  clientId?: string;
  status: PresenceStatus;
  metadata?: Record<string, unknown>;
  updatedAt: number;
};

class PresenceManager {
  private presence: Map<string, PresenceInfo>;      // connectionId -> info
  private clientIndex: Map<string, Set<string>>;    // clientId -> connectionIds
  private statusIndex: Map<string, Set<string>>;    // status -> connectionIds
  private subscribers: Set<string>;                 // connectionIds
}
```

### Stream Manager

**File:** `apps/server/src/websocket/streaming.ts`

**Purpose:** Manages streaming responses.

**Key Features:**
- Subscribe connections to run streams
- Forward stream events to subscribers
- Handle stream completion
- Clean up on disconnect

### Subscription Manager

**File:** `apps/server/src/websocket/subscriptions.ts`

**Purpose:** Manages session subscriptions.

**Key Features:**
- Create/remove subscriptions
- Track subscriptions by connection
- Find subscriptions by session
- Clean up on disconnect

## Data Flows

### Connection Establishment Flow

```
Client                     Server
  │                          │
  ├─── Connect ────────────▶│
  │                          │
  │◀── connection.established│
  │                          │
  │◀────── heartbeat ────────│
  │         (periodic)        │
  │                          │
```

### Message Handling Flow

```
Client                     Server
  │                          │
  ├─── session.create ──────▶│
  │                          │
  │              ┌───────────┤
  │              │ Router    │
  │              └───────────┤
  │                    │     │
  │              ┌─────▼─────┤
  │              │ Auth MW   │
  │              └───────────┤
  │                    │     │
  │              ┌─────▼─────┤
  │              │ Handler   │
  │              └───────────┤
  │                    │     │
  │◀─── session.created ─────│
  │                          │
```

### Streaming Flow

```
Client                     Server                      LLM
  │                          │                          │
  ├─── session.message ─────▶│                          │
  │     (stream: true)       │                          │
  │                          │                          │
  │                          ├─── Invoke LLM ──────────▶│
  │                          │                          │
  │◀── session.stream.start ─│                          │
  │                          │                          │
  │                          │◀───── delta ─────────────│
  │◀── session.stream.delta ─│                          │
  │                          │                          │
  │                          │◀───── delta ─────────────│
  │◀── session.stream.delta ─│                          │
  │                          │                          │
  │                          │◀───── done ──────────────│
  │◀── session.stream.done ──│                          │
  │                          │                          │
```

### Pairing Flow

```
Device                     Server                      Admin
  │                          │                          │
  ├─── pairing.request ─────▶│                          │
  │                          │                          │
  │◀── pairing.requested ────│                          │
  │     (code: 123456)       │                          │
  │                          │                          │
  │                          │◀─── Enter code ──────────│
  │                          │                          │
  │                          ├─── pairing.approve ─────▶│
  │                          │                          │
  │                          │◀─── pairing.approved ────│
  │                          │     (nodeId, token)      │
  │                          │                          │
  │◀── (polling status) ─────│                          │
  │     approved + token     │                          │
  │                          │                          │
  ├─── Authenticate ────────▶│                          │
  │     (with token)         │                          │
  │                          │                          │
  │◀── Authenticated ────────│                          │
  │                          │                          │
```

### Event Broadcasting Flow

```
Client A                   Server                    Client B
  │                          │                          │
  ├─── presence.update ─────▶│                          │
  │                          │                          │
  │                          │ (update presence)        │
  │                          │                          │
  │                          ├── presence.changed ─────▶│
  │                          │   (to subscribers)       │
  │                          │                          │
  │◀── presence.update ──────│                          │
  │     (response)           │                          │
  │                          │                          │
```

## Design Decisions

### Why WebSocket?

**Pros:**
- Bidirectional communication
- Low latency for real-time features
- Native streaming support
- Single connection for multiple operations

**Cons:**
- More complex than REST
- Stateful connections
- Harder to cache

**Decision:** WebSocket is ideal for OpenAidy because:
- Real-time AI responses benefit from streaming
- Event subscriptions require persistent connections
- Low latency improves user experience
- The benefits outweigh the complexity

### Why This Message Protocol?

**Design Choices:**
1. **JSON-based** - Human-readable, easy to debug
2. **Request-response correlation** - Match requests with responses using IDs
3. **Type-based routing** - Handlers registered by message type
4. **Typed payloads** - TypeScript types in shared-types package

**Alternatives Considered:**
- Binary protocol (Protocol Buffers) - Too complex for this use case
- GraphQL subscriptions - Overkill for real-time messaging
- SSE (Server-Sent Events) - Unidirectional only

### Why Capability-Based Authorization?

**Benefits:**
- Fine-grained permissions
- Token-scoped access
- Easy to audit
- Composable capabilities

**Example:**
```json
{
  "sub": "user-123",
  "capabilities": ["session.read", "session.write", "agent.read"],
  "exp": 1711708800
}
```

### Why This Reconnection Strategy?

**Strategy:** Exponential backoff with jitter

**Benefits:**
- Prevents thundering herd
- Gives server time to recover
- Randomized for fairness
- Configurable max attempts

**Implementation:**
```typescript
const delay = Math.min(baseInterval * Math.pow(2, attempt), maxDelay);
const jitter = Math.random() * 1000;
setTimeout(reconnect, delay + jitter);
```

## Performance Characteristics

### Connection Limits

| Metric | Default | Configurable |
|--------|---------|--------------|
| Max Connections | 10,000 | `maxConnections` |
| Max per User | 10 | `maxConnectionsPerUser` |
| Max Subscriptions | 100 | `maxSubscriptions` |
| Max Message Size | 1MB | `maxMessageSize` |

### Message Throughput

| Scenario | Messages/sec |
|----------|--------------|
| Simple requests | 10,000+ |
| With streaming | 1,000+ |
| With subscriptions | 5,000+ |

### Memory Usage

| Component | Per Connection | Notes |
|-----------|---------------|-------|
| ConnectionContext | ~1KB | Metadata, subscriptions |
| Pending Requests | ~100 bytes | Per pending request |
| Subscriptions | ~50 bytes | Per subscription |
| Presence | ~200 bytes | Per presence entry |

### Latency

| Operation | Latency |
|-----------|---------|
| Connection establishment | <10ms |
| Message round-trip | <5ms |
| Event broadcast | <10ms |
| Heartbeat | <1ms |

## Security

### Authentication Flow

```
1. Client obtains JWT (from login or API key)
2. Client connects with token in URL: ws://host/ws?token=JWT
3. Server validates token signature and expiration
4. Server extracts user ID and capabilities
5. Connection marked as authenticated
6. Subsequent operations checked against capabilities
```

### Authorization Model

**Capability-Based Access Control:**

```typescript
// Token with capabilities
{
  "sub": "user-123",
  "capabilities": ["session.read", "session.write"],
  "iat": 1711708800,
  "exp": 1711795200
}

// Handler checks capability
if (!conn.capabilities.includes('session.write')) {
  return error(FORBIDDEN, 'Permission denied');
}
```

### Token Management

| Aspect | Implementation |
|--------|----------------|
| Expiration | 24 hours default |
| Refresh | New token before expiry |
| Revocation | Server-side blacklist |
| Storage | HttpOnly cookie or in-memory |

### Rate Limiting

**Per-Connection Limits:**
```typescript
{
  windowMs: 60000,      // 1 minute window
  maxRequests: 100,     // 100 requests per minute
  skipFailed: false,    // Count failed requests
}
```

## Extensibility

### Adding New Message Types

1. **Define Types** (in `packages/shared-types/src/websocket.ts`):
```typescript
export type MyNewRequest = WSMessage<'my.new', { param: string }>;
export type MyNewResponse = WSMessage<'my.newed', { result: string }>;
```

2. **Create Handler** (in `apps/server/src/websocket/handlers/my-new.ts`):
```typescript
export class MyNewHandler {
  async handleMyNew(
    connectionId: string,
    request: MyNewRequest,
    context: HandlerContext,
  ): Promise<MyNewResponse | ErrorResponse> {
    // Implementation
  }
}

export function registerMyNewHandlers(router: MessageRouter, handler: MyNewHandler) {
  router.registerHandler('my.new', (conn, msg, ctx) => handler.handleMyNew(conn, msg, ctx));
}
```

3. **Register in Gateway** (in `apps/server/src/websocket/index.ts`):
```typescript
const myNewHandler = new MyNewHandler(services, logger);
registerMyNewHandlers(messageRouter, myNewHandler);
```

### Adding New Middleware

```typescript
// 1. Define middleware
type Middleware = (
  connectionId: string,
  message: WSMessage,
  context: HandlerContext,
  next: () => Promise<WSResponse | void>,
) => Promise<WSResponse | void>;

// 2. Implement middleware
const loggingMiddleware: Middleware = async (conn, msg, ctx, next) => {
  ctx.logger.info(`Received: ${msg.type}`);
  const response = await next();
  ctx.logger.info(`Response: ${response?.type}`);
  return response;
};

// 3. Apply in router
messageRouter.use(loggingMiddleware);
```

### Adding New Events

```typescript
// 1. Define event type
export type MyNewEvent = WSMessage<'my.event', { data: unknown }>;

// 2. Broadcast from handler
const event: MyNewEvent = createWSMessage('my.event', { data: result });
for (const subscriberId of subscribers) {
  sendToConnection(subscriberId, event);
}
```

## Monitoring

### Metrics to Track

| Metric | Description |
|--------|-------------|
| `ws.connections.active` | Current active connections |
| `ws.connections.total` | Total connections created |
| `ws.messages.received` | Total messages received |
| `ws.messages.sent` | Total messages sent |
| `ws.errors` | Total errors |
| `ws.latency.avg` | Average message latency |
| `ws.subscriptions` | Active subscriptions |
| `ws.nodes.online` | Online nodes count |

### Logging

**Connection Events:**
```typescript
logger.info('Connection established', { connectionId, userAgent });
logger.info('Connection closed', { connectionId, code, reason });
logger.error('Connection error', { connectionId, error });
```

**Message Events:**
```typescript
logger.debug('Message received', { type, connectionId });
logger.debug('Message sent', { type, connectionId });
```

**Performance Events:**
```typescript
logger.info('Message processed', { type, duration, connectionId });
```

### Health Checks

```typescript
// Check gateway health
const health = {
  status: 'ok',
  connections: connectionManager.getConnectionCount(),
  subscriptions: subscriptionManager.getSubscriptionCount(),
  nodes: nodeRegistry.getOnlineNodes().length,
  uptime: process.uptime(),
};
```

## Summary

The WebSocket gateway provides a robust, scalable, and secure real-time communication layer for OpenAidy. Its component-based architecture ensures maintainability and extensibility, while the capability-based authorization model provides fine-grained access control. The design prioritizes developer experience with full TypeScript support and a comprehensive SDK for client applications.
