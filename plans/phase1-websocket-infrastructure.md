# Phase 1: WebSocket Infrastructure - Detailed Tasks

## Overview

This phase establishes the core WebSocket infrastructure including the gateway plugin, connection manager, message router, and basic middleware. All tasks are designed to be implemented incrementally with comprehensive testing.

---

## Task 1.1: Create Shared WebSocket Types

### Description

Define the core WebSocket message types and interfaces that will be shared between the server and client SDKs.

### Expected Results

- TypeScript types for all WebSocket messages (requests, responses, events)
- Error types and structures
- Type guards for message validation
- Exported from `packages/shared-types/src/websocket.ts`

### Files to Create

- `packages/shared-types/src/websocket.ts`

### Files to Reference/Reuse

- `packages/runtime/src/provider/index.ts` - For reference on event type patterns
- `apps/server/src/dispatch/events.ts` - For reference on RunEvent structure
- `packages/shared-types/src/events.ts` - Existing event types

### Expected Tests

- `packages/shared-types/src/websocket.test.ts`
  - Test message envelope validation
  - Test error type creation
  - Test type guards for all message types
  - Test serialization/deserialization

### Implementation Details

#### Core Types to Define

```typescript
// Message envelope
type WSMessage = {
  id: string;
  type: string;
  timestamp: string;
  payload: unknown;
  error?: WSError;
};

// Error structure
type WSError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

// Request types (client → server)
type WSRequest =
  | AuthAuthenticateRequest
  | AuthRefreshRequest
  | SessionCreateRequest
  | SessionGetRequest
  | SessionListRequest
  | SessionDeleteRequest
  | SessionMessageRequest
  | SessionSubscribeRequest
  | SessionUnsubscribeRequest
  | AgentListRequest
  | AgentGetRequest
  | ProviderListRequest
  | ProviderModelsRequest
  | ConfigGetRequest
  | ConfigUpdateRequest
  | NodeListRequest
  | NodeDescribeRequest
  | NodeInvokeRequest
  | NodeRegisterRequest
  | PairingRequest
  | PairingApproveRequest
  | PairingDenyRequest
  | PresenceUpdateRequest;

// Response types (server → client)
type WSResponse =
  | AuthAuthenticatedResponse
  | SessionCreatedResponse
  | SessionMessageResponse
  | SessionStreamStart
  | SessionStreamDelta
  | SessionStreamToolCall
  | SessionStreamUsage
  | SessionStreamEnd
  | SessionStreamError
  | AgentListResponse
  | ProviderListResponse
  | NodeRegisteredResponse
  | NodeInvokedResponse
  | NodeOnlineEvent
  | NodeOfflineEvent
  | PairingRequestedEvent
  | PairingApprovedResponse
  | ConfigUpdatedEvent
  | PresenceChangedEvent
  | ErrorResponse;

// Type guards
function isWSRequest(msg: unknown): msg is WSRequest;
function isWSResponse(msg: unknown): msg is WSResponse;
function isWSError(msg: unknown): msg is WSError;
```

#### Validation Functions

```typescript
function validateWSMessage(data: unknown): WSMessage | WSError;
function validateRequestType(type: string): type is WSRequest['type'];
function validateResponseType(type: string): type is WSResponse['type'];
```

### Dependencies

- None (standalone type definitions)

### Success Criteria

- All message types are defined with proper TypeScript typing
- Type guards correctly identify message types
- Validation functions catch malformed messages
- Tests achieve 100% coverage of type guards and validation

---

## Task 1.2: Create WebSocket Configuration Types

### Description

Define configuration types for the WebSocket gateway, including environment variables and runtime configuration.

### Expected Results

- TypeScript types for WebSocket configuration
- Environment variable validation schema
- Configuration loader with defaults
- Exported from `apps/server/src/websocket/types.ts`

### Files to Create

- `apps/server/src/websocket/types.ts`

### Files to Reference/Reuse

- `apps/server/src/lib/env.ts` - For reference on environment variable patterns
- `apps/server/src/lib/logger.ts` - For logger configuration patterns

### Expected Tests

- `apps/server/src/websocket/types.test.ts`
  - Test configuration defaults
  - Test environment variable parsing
  - Test configuration validation
  - Test invalid configuration handling

### Implementation Details

#### Configuration Types

```typescript
type WebSocketConfig = {
  enabled: boolean;
  port: number;
  path: string;
  maxConnections: number;
  heartbeatInterval: number;
  auth: {
    required: boolean;
    tokenExpiry: number;
    secret: string;
  };
  rateLimit: {
    max: number;
    window: number;
  };
};

type PairingConfig = {
  codeLength: number;
  codeExpiryMs: number;
  maxPendingRequests: number;
  defaultTokenExpiryMs: number;
  maxTokenExpiryMs: number;
  refreshTokenExpiryMs: number;
  maxAttemptsPerIp: number;
  attemptWindowMs: number;
  requireAdminApproval: boolean;
  autoApproveDomains?: string[];
  autoApproveCapabilities?: string[];
};
```

#### Environment Variables

```typescript
// apps/server/src/lib/env.ts additions
WS_ENABLED: boolean = true;
WS_PORT: number = 3000;
WS_PATH: string = '/ws';
WS_MAX_CONNECTIONS: number = 1000;
WS_HEARTBEAT_INTERVAL: number = 30000;
WS_AUTH_REQUIRED: boolean = true;
WS_TOKEN_EXPIRY: number = 86400000;
WS_TOKEN_SECRET: string;
WS_RATE_LIMIT_MAX: number = 100;
WS_RATE_LIMIT_WINDOW: number = 60000;
```

### Dependencies

- Task 1.1 (shared types)
- Existing env.ts module

### Success Criteria

- Configuration types are fully typed
- Environment variables are validated on startup
- Defaults are sensible and documented
- Invalid configuration causes clear error messages

---

## Task 1.3: Create WebSocket Gateway Plugin Entry Point

### Description

Create the Fastify plugin that registers the WebSocket endpoint and initializes the gateway infrastructure.

### Expected Results

- Fastify plugin at `apps/server/src/websocket/index.ts`
- WebSocket endpoint registered at `/ws`
- Plugin integrates with existing app structure
- Gateway initialized with configuration

### Files to Create

- `apps/server/src/websocket/index.ts`

### Files to Reference/Reuse

- `apps/server/src/app.ts` - For plugin registration pattern
- `apps/server/src/routes/health.ts` - For route registration pattern
- `apps/server/src/lib/logger.ts` - For logging

### Expected Tests

- `apps/server/src/websocket/index.test.ts`
  - Test plugin registration
  - Test WebSocket endpoint is accessible
  - Test configuration is applied
  - Test plugin cleanup on close

### Implementation Details

#### Plugin Structure

```typescript
import type { FastifyPluginAsync } from 'fastify';
import websocket from '@fastify/websocket';

export const websocketGatewayPlugin: FastifyPluginAsync = async (
  fastify,
  options,
) => {
  // Register WebSocket support
  await fastify.register(websocket);

  // Register WebSocket route
  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, async (connection, req) => {
      // Handle WebSocket connection
      await handleConnection(connection, req, fastify);
    });
  });

  // Initialize gateway services
  const gateway = createGateway(fastify);

  // Store gateway in app
  fastify.decorate('websocketGateway', gateway);

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    await gateway.shutdown();
  });
};
```

#### Gateway Factory

```typescript
function createGateway(fastify: FastifyInstance): WebSocketGateway {
  const config = loadConfig(fastify);
  const connectionManager = new ConnectionManager(config);
  const messageRouter = new MessageRouter(fastify);
  const authMiddleware = createAuthMiddleware(config);

  return {
    config,
    connectionManager,
    messageRouter,
    authMiddleware,
    shutdown: async () => {
      await connectionManager.closeAll();
    },
  };
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.2 (configuration)
- Existing Fastify app structure

### Success Criteria

- Plugin registers successfully with Fastify
- WebSocket endpoint accepts connections
- Gateway services are initialized
- Cleanup happens on app shutdown

---

## Task 1.4: Create Connection Manager

### Description

Implement the connection manager that tracks active WebSocket connections, handles authentication, and manages connection lifecycle.

### Expected Results

- `apps/server/src/websocket/connection-manager.ts`
- Tracks active connections with metadata
- Handles connection authentication
- Manages connection lifecycle (connect, disconnect, heartbeat)
- Implements rate limiting per connection

### Files to Create

- `apps/server/src/websocket/connection-manager.ts`

### Files to Reference/Reuse

- `apps/server/src/dispatch/events.ts` - For EventEmitter pattern
- `apps/server/src/lib/logger.ts` - For logging
- Task 1.2 (configuration types)

### Expected Tests

- `apps/server/src/websocket/connection-manager.test.ts`
  - Test connection registration
  - Test connection removal
  - Test authentication
  - Test heartbeat handling
  - Test rate limiting
  - Test connection limit enforcement
  - Test broadcast to connections
  - Test send to specific connection

### Implementation Details

#### Connection Context

```typescript
type ConnectionContext = {
  id: string;
  socket: WebSocket;
  authenticated: boolean;
  clientId?: string;
  capabilities: string[];
  subscriptions: Set<string>;
  lastHeartbeat: number;
  createdAt: number;
  metadata: Record<string, unknown>;
};
```

#### Connection Manager Class

```typescript
class ConnectionManager {
  private connections: Map<string, ConnectionContext>;
  private config: WebSocketConfig;
  private rateLimiters: Map<string, RateLimiter>;

  constructor(config: WebSocketConfig);

  // Connection lifecycle
  registerConnection(socket: WebSocket): string;
  removeConnection(connectionId: string): void;
  getConnection(connectionId: string): ConnectionContext | undefined;
  getAllConnections(): ConnectionContext[];

  // Authentication
  authenticate(connectionId: string, token: string): Promise<boolean>;
  setClientIdentity(
    connectionId: string,
    clientId: string,
    capabilities: string[],
  ): void;

  // Subscriptions
  subscribe(connectionId: string, topic: string): void;
  unsubscribe(connectionId: string, topic: string): void;
  getSubscribers(topic: string): ConnectionContext[];

  // Messaging
  send(connectionId: string, message: WSMessage): boolean;
  broadcast(message: WSMessage, exclude?: string[]): void;
  sendToTopic(topic: string, message: WSMessage): void;

  // Heartbeat
  updateHeartbeat(connectionId: string): void;
  checkStaleConnections(): void;

  // Cleanup
  closeAll(): Promise<void>;
}
```

#### Rate Limiter

```typescript
class RateLimiter {
  private max: number;
  private window: number;
  private requests: number[];

  constructor(max: number, window: number);

  check(): boolean;
  reset(): void;
}
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.2 (configuration)
- Existing logger

### Success Criteria

- Connections are tracked and managed
- Authentication state is maintained
- Heartbeats prevent stale connections
- Rate limiting prevents abuse
- All operations are tested

---

## Task 1.5: Create Message Router

### Description

Implement the message router that routes incoming WebSocket messages to appropriate handlers and manages request-response correlation.

### Expected Results

- `apps/server/src/websocket/message-router.ts`
- Routes messages to handlers based on type
- Correlates requests with responses
- Handles unknown message types
- Provides error responses for invalid messages

### Files to Create

- `apps/server/src/websocket/message-router.ts`

### Files to Reference/Reuse

- `apps/server/src/websocket/connection-manager.ts` - For connection access
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/message-router.test.ts`
  - Test message routing to correct handler
  - Test request-response correlation
  - Test unknown message type handling
  - Test invalid message handling
  - Test error response generation
  - Test handler registration

### Implementation Details

#### Handler Interface

```typescript
type MessageHandler = (
  connectionId: string,
  message: WSRequest,
  context: HandlerContext,
) => Promise<WSResponse | void>;

type HandlerContext = {
  connectionManager: ConnectionManager;
  services: AppServices;
  logger: FastifyBaseLogger;
};
```

#### Message Router Class

```typescript
class MessageRouter {
  private handlers: Map<string, MessageHandler>;
  private pendingRequests: Map<string, PendingRequest>;

  constructor();

  // Handler registration
  registerHandler(messageType: string, handler: MessageHandler): void;
  unregisterHandler(messageType: string): void;

  // Message routing
  async route(
    connectionId: string,
    message: WSMessage,
    context: HandlerContext,
  ): Promise<void>;

  // Request correlation
  createRequestId(): string;
  trackRequest(requestId: string, connectionId: string): void;
  completeRequest(requestId: string, response: WSResponse): void;
  failRequest(requestId: string, error: WSError): void;

  // Cleanup
  clearPendingRequests(connectionId: string): void;
}
```

#### Pending Request Tracking

```typescript
type PendingRequest = {
  connectionId: string;
  createdAt: number;
  timeout?: NodeJS.Timeout;
};
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.4 (connection manager)

### Success Criteria

- Messages route to correct handlers
- Request-response correlation works
- Unknown messages generate errors
- Handler registration is flexible
- All operations are tested

---

## Task 1.6: Create Authentication Middleware

### Description

Implement authentication middleware that validates tokens, extracts client identity, and enforces capability-based authorization.

### Expected Results

- `apps/server/src/websocket/middleware/auth.ts`
- Validates JWT tokens
- Extracts client identity and capabilities
- Enforces capability checks
- Provides authentication context to handlers

### Files to Create

- `apps/server/src/websocket/middleware/auth.ts`

### Files to Reference/Reuse

- `apps/server/src/websocket/connection-manager.ts` - For connection access
- Task 1.2 (configuration)
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/middleware/auth.test.ts`
  - Test valid token authentication
  - Test invalid token rejection
  - Test expired token rejection
  - Test capability checking
  - Test missing capability rejection
  - Test admin capability bypass
  - Test token extraction

### Implementation Details

#### Token Payload

```typescript
type JWTPayload = {
  sub: string; // Client ID
  type: 'access' | 'refresh' | 'pairing';
  scopes: string[];
  exp: number;
  iat: number;
};
```

#### Auth Middleware Class

```typescript
class AuthMiddleware {
  private config: WebSocketConfig;
  private jwtSecret: string;

  constructor(config: WebSocketConfig);

  // Token validation
  async validateToken(token: string): Promise<JWTPayload | null>;
  async generateToken(payload: JWTPayload): Promise<string>;
  async refreshToken(refreshToken: string): Promise<string | null>;

  // Capability checking
  hasCapability(scopes: string[], capability: string): boolean;
  hasAnyCapability(scopes: string[], capabilities: string[]): boolean;
  hasAllCapabilities(scopes: string[], capabilities: string[]): boolean;

  // Middleware function
  async authenticate(
    connectionId: string,
    token: string,
    connectionManager: ConnectionManager,
  ): Promise<{ clientId: string; capabilities: string[] } | null>;

  // Authorization check
  authorize(
    requiredCapability: string,
    connectionId: string,
    connectionManager: ConnectionManager,
  ): boolean;
}
```

#### Capability Constants

```typescript
const CAPABILITIES = {
  SESSIONS_READ: 'sessions.read',
  SESSIONS_WRITE: 'sessions.write',
  SESSIONS_STREAM: 'sessions.stream',
  SESSIONS_DELETE: 'sessions.delete',
  AGENTS_READ: 'agents.read',
  AGENTS_INVOKE: 'agents.invoke',
  PROVIDERS_READ: 'providers.read',
  PROVIDERS_INVOKE: 'providers.invoke',
  NODE_INVOKE: 'node.invoke',
  NODE_DESCRIBE: 'node.describe',
  CONFIG_READ: 'config.read',
  CONFIG_WRITE: 'config.write',
  PAIRING_APPROVE: 'pairing.approve',
  PAIRING_DENY: 'pairing.deny',
  SYSTEM_RUN: 'system.run',
  SYSTEM_NOTIFY: 'system.notify',
  ADMIN: '*', // Wildcard for all capabilities
} as const;
```

### Dependencies

- Task 1.1 (shared types)
- Task 1.2 (configuration)
- Task 1.4 (connection manager)

### Success Criteria

- Tokens are validated correctly
- Capabilities are enforced
- Admin wildcard works
- Invalid tokens are rejected
- All operations are tested

---

## Task 1.7: Create Rate Limiting Middleware

### Description

Implement rate limiting middleware that enforces per-connection and global rate limits to prevent abuse.

### Expected Results

- `apps/server/src/websocket/middleware/rate-limit.ts`
- Enforces per-connection rate limits
- Enforces global rate limits
- Tracks rate limit violations
- Provides rate limit headers/info

### Files to Create

- `apps/server/src/websocket/middleware/rate-limit.ts`

### Files to Reference/Reuse

- Task 1.2 (configuration)
- Task 1.4 (connection manager)

### Expected Tests

- `apps/server/src/websocket/middleware/rate-limit.test.ts`
  - Test per-connection rate limiting
  - Test global rate limiting
  - Test rate limit reset after window
  - Test rate limit violation detection
  - Test concurrent connection limiting
  - Test IP-based rate limiting

### Implementation Details

#### Rate Limit Info

```typescript
type RateLimitInfo = {
  remaining: number;
  reset: number;
  limit: number;
};

type RateLimitResult = {
  allowed: boolean;
  info: RateLimitInfo;
};
```

#### Rate Limiter Class

```typescript
class RateLimiter {
  private max: number;
  private window: number;
  private requests: number[];
  private resetTime: number;

  constructor(max: number, window: number);

  check(): RateLimitResult;
  recordRequest(): void;
  reset(): void;
  isExpired(): boolean;
}
```

#### Rate Limit Middleware

```typescript
class RateLimitMiddleware {
  private config: WebSocketConfig;
  private connectionLimiters: Map<string, RateLimiter>;
  private globalLimiter: RateLimiter;
  private ipLimiters: Map<string, RateLimiter>;

  constructor(config: WebSocketConfig);

  // Check rate limit
  checkConnection(connectionId: string): RateLimitResult;
  checkGlobal(): RateLimitResult;
  checkIP(ip: string): RateLimitResult;

  // Record request
  recordRequest(connectionId: string, ip: string): void;

  // Cleanup
  cleanupStaleLimiters(): void;
  resetConnection(connectionId: string): void;
}
```

### Dependencies

- Task 1.2 (configuration)
- Task 1.4 (connection manager)

### Success Criteria

- Rate limits are enforced
- Limits reset correctly
- Multiple limiter types work
- Cleanup prevents memory leaks
- All operations are tested

---

## Task 1.8: Create Error Handler

### Description

Implement a centralized error handler that formats errors consistently and sends appropriate error responses to clients.

### Expected Results

- `apps/server/src/websocket/errors.ts`
- Formats errors consistently
- Maps error codes to messages
- Logs errors appropriately
- Sends error responses

### Files to Create

- `apps/server/src/websocket/errors.ts`

### Files to Reference/Reuse

- `packages/runtime/src/errors/index.ts` - For error pattern reference
- Task 1.1 (shared types)

### Expected Tests

- `apps/server/src/websocket/errors.test.ts`
  - Test error creation
  - Test error formatting
  - Test error code mapping
  - Test error response generation
  - Test error logging

### Implementation Details

#### Error Codes

```typescript
const ERROR_CODES = {
  // Authentication errors
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // Authorization errors
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_CAPABILITY: 'INSUFFICIENT_CAPABILITY',

  // Request errors
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNKNOWN_MESSAGE_TYPE: 'UNKNOWN_MESSAGE_TYPE',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // Connection errors
  CONNECTION_LIMIT: 'CONNECTION_LIMIT',
  CONNECTION_CLOSED: 'CONNECTION_CLOSED',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Server errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
```

#### Error Handler Class

```typescript
class WSErrorHandler {
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger);

  // Error creation
  createError(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): WSError;

  // Error formatting
  formatError(error: unknown): WSError;

  // Error response
  createErrorResponse(requestId: string, error: WSError): ErrorResponse;

  // Error logging
  logError(error: unknown, context?: Record<string, unknown>): void;

  // Error mapping
  mapError(error: Error): { code: string; message: string };
}
```

### Dependencies

- Task 1.1 (shared types)
- Existing logger

### Success Criteria

- Errors are formatted consistently
- Error codes are mapped correctly
- Errors are logged appropriately
- Error responses are valid
- All operations are tested

---

## Task 1.9: Integrate Gateway with App

### Description

Integrate the WebSocket gateway with the existing Fastify app, register the plugin, and wire up services.

### Expected Results

- Gateway plugin registered in [`apps/server/src/app.ts`](apps/server/src/app.ts)
- WebSocket endpoint accessible
- Services available to gateway
- Configuration loaded from env

### Files to Modify

- `apps/server/src/app.ts`
- `apps/server/src/lib/env.ts`

### Files to Reference/Reuse

- Existing app.ts structure
- All previous tasks in Phase 1

### Expected Tests

- `apps/server/src/app.test.ts` (update existing tests)
  - Test gateway plugin registration
  - Test WebSocket endpoint availability
  - Test service injection
  - Test configuration loading

### Implementation Details

#### App.ts Modifications

```typescript
// Import gateway plugin
import { websocketGatewayPlugin } from './websocket';

// In buildApp function:
export async function buildApp() {
  const app = Fastify({ logger: loggerOptions });

  // ... existing initialization ...

  // Register WebSocket gateway
  await app.register(websocketGatewayPlugin);

  // ... existing route registrations ...

  return app;
}
```

#### Environment Variables

Add to [`apps/server/src/lib/env.ts`](apps/server/src/lib/env.ts):

```typescript
WS_ENABLED: boolean = true;
WS_PORT: number = 3000;
WS_PATH: string = '/ws';
WS_MAX_CONNECTIONS: number = 1000;
WS_HEARTBEAT_INTERVAL: number = 30000;
WS_AUTH_REQUIRED: boolean = true;
WS_TOKEN_EXPIRY: number = 86400000;
WS_TOKEN_SECRET: string =
  process.env.WS_TOKEN_SECRET || 'change-me-in-production';
WS_RATE_LIMIT_MAX: number = 100;
WS_RATE_LIMIT_WINDOW: number = 60000;
```

### Dependencies

- All previous Phase 1 tasks

### Success Criteria

- Gateway plugin loads without errors
- WebSocket endpoint accepts connections
- Services are accessible to gateway
- Configuration is applied
- Existing tests still pass

---

## Phase 1 Completion Criteria

- All tasks completed and tested
- WebSocket endpoint is accessible
- Connections can be established
- Authentication middleware works
- Rate limiting is enforced
- Error handling is consistent
- Integration with app is complete
- All tests passing with >80% coverage
- Documentation updated

---

## Next Phase

After completing Phase 1, proceed to **Phase 2: Session Integration** which will implement session management endpoints and integrate with the existing SessionMessageService.
