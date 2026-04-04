# WebSocket Client SDK Documentation

This document provides complete API reference and usage examples for the OpenAidy WebSocket Client SDK.

## Installation

```bash
npm install @openaidy/sdk
# or
pnpm add @openaidy/sdk
# or
yarn add @openaidy/sdk
```

## Quick Start

```typescript
import { createWebSocketClient } from '@openaidy/sdk';

// Create client
const client = createWebSocketClient({
  url: 'wss://api.openaidy.com/ws',
  token: 'your-jwt-token',
});

// Connect
await client.connect();

// Create a session
const session = await client.createSession({ agentId: 'agent-1' });

// Send a message
const response = await client.sendMessage(
  session.payload.sessionId,
  'Hello, how can you help me?'
);

console.log(response.payload.content);
```

## API Reference

### createWebSocketClient(options)

Creates a new WebSocket client instance.

```typescript
import { createWebSocketClient, WebSocketClient } from '@openaidy/sdk';

const client = createWebSocketClient({
  url: string;              // WebSocket server URL
  token?: string;           // JWT authentication token
  autoReconnect?: boolean;  // Enable auto-reconnect (default: true)
  reconnectInterval?: number;  // Reconnect interval in ms (default: 1000)
  maxReconnectAttempts?: number;  // Max reconnect attempts (default: 10)
  heartbeatInterval?: number;  // Heartbeat interval in ms (default: 30000)
  requestTimeout?: number;  // Request timeout in ms (default: 30000)
  logger?: Logger;          // Custom logger
  clientId?: string;        // Client ID for presence tracking
});
```

### Client Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | - | WebSocket server URL (required) |
| `token` | `string` | - | JWT authentication token |
| `autoReconnect` | `boolean` | `true` | Enable automatic reconnection |
| `reconnectInterval` | `number` | `1000` | Initial reconnect interval (ms) |
| `maxReconnectAttempts` | `number` | `10` | Maximum reconnection attempts |
| `heartbeatInterval` | `number` | `30000` | Heartbeat interval (ms) |
| `requestTimeout` | `number` | `30000` | Request timeout (ms) |
| `logger` | `Logger` | No-op logger | Custom logger instance |
| `clientId` | `string` | - | Client ID for presence |

## Connection Methods

### connect()

Establishes a WebSocket connection.

```typescript
await client.connect();
```

Returns a Promise that resolves when connected.

### disconnect()

Closes the WebSocket connection.

```typescript
client.disconnect();
```

### reconnect()

Disconnects and reconnects to the server.

```typescript
await client.reconnect();
```

### isConnected()

Returns whether the client is currently connected.

```typescript
if (client.isConnected()) {
  console.log('Client is connected');
}
```

### getState()

Returns the current connection state.

```typescript
type WebSocketClientState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'reconnecting';

const state = client.getState();
```

### getConnectionId()

Returns the server-assigned connection ID.

```typescript
const connectionId = client.getConnectionId();
// Returns: "conn_abc123" or null if not connected
```

## Authentication

### authenticate(token)

Authenticates with a new token.

```typescript
await client.authenticate('new-jwt-token');
```

### refreshAuth()

Refreshes authentication with the current token.

```typescript
await client.refreshAuth();
```

## Session Operations

### createSession(options?)

Creates a new chat session.

```typescript
type SessionCreateOptions = {
  agentId?: string;      // Agent to use
  providerId?: string;   // Provider to use
  modelId?: string;      // Model to use
  title?: string;        // Session title
  metadata?: Record<string, unknown>;  // Custom metadata
};

const session = await client.createSession({
  agentId: 'agent-1',
  providerId: 'openai',
  modelId: 'gpt-4',
  title: 'My Chat Session',
});
```

### getSession(sessionId)

Retrieves session details.

```typescript
const session = await client.getSession('session-123');
console.log(session.payload.session.title);
```

### listSessions(options?)

Lists available sessions.

```typescript
const result = await client.listSessions({
  status: 'active',  // Filter by status
  offset: 0,         // Pagination offset
  limit: 10,         // Max results
});

console.log(result.payload.sessions);
console.log(`Total: ${result.payload.total}`);
```

### deleteSession(sessionId)

Deletes a session.

```typescript
const result = await client.deleteSession('session-123');
console.log(`Deleted: ${result.payload.deleted}`);
```

### sendMessage(sessionId, content, options?)

Sends a message to a session.

```typescript
type MessageOptions = {
  stream?: boolean;      // Enable streaming (default: false)
  providerId?: string;   // Override provider
  modelId?: string;      // Override model
  metadata?: Record<string, unknown>;  // Custom metadata
};

// Non-streaming
const response = await client.sendMessage(
  'session-123',
  'What is the weather today?'
);

// Streaming
const response = await client.sendMessage(
  'session-123',
  'Tell me a story',
  { stream: true }
);
```

### subscribeToSession(sessionId, events?)

Subscribes to session events.

```typescript
const result = await client.subscribeToSession(
  'session-123',
  ['session.message', 'session.updated']  // Optional event filter
);
```

### unsubscribeFromSession(sessionId)

Unsubscribes from session events.

```typescript
await client.unsubscribeFromSession('session-123');
```

## Agent Operations

### listAgents()

Lists all available agents.

```typescript
const result = await client.listAgents();

result.payload.agents.forEach(agent => {
  console.log(`${agent.id}: ${agent.name}`);
  console.log(`  Capabilities: ${agent.capabilities.join(', ')}`);
});
```

### getAgent(agentId)

Gets details for a specific agent.

```typescript
const result = await client.getAgent('agent-1');
const agent = result.payload.agent;

console.log(agent.name);
console.log(agent.description);
console.log(agent.systemPrompt);
```

### queryAgents(filter?)

Queries agents with filters.

```typescript
type AgentQueryFilter = {
  status?: string;      // Filter by status
  capability?: string;  // Filter by capability
  tags?: string[];      // Filter by tags
};

const result = await client.queryAgents({
  capability: 'code',
  status: 'available',
});
```

## Provider Operations

### listProviders()

Lists all available providers.

```typescript
const result = await client.listProviders();

result.payload.providers.forEach(provider => {
  console.log(`${provider.id}: ${provider.name}`);
});
```

### getProvider(providerId)

Gets details for a specific provider.

```typescript
const result = await client.getProvider('openai');
console.log(result.payload.provider.name);
```

### getProviderModels(providerId)

Lists models available from a provider.

```typescript
const result = await client.getProviderModels('openai');

result.payload.models.forEach(model => {
  console.log(`${model.id}: ${model.name}`);
});
```

## Node Operations

### listNodes()

Lists all registered nodes.

```typescript
const result = await client.listNodes();

result.payload.nodes.forEach(node => {
  console.log(`${node.nodeId}: ${node.name}`);
  console.log(`  Status: ${node.status}`);
  console.log(`  Capabilities: ${node.capabilities.join(', ')}`);
});
```

### getNode(nodeId)

Gets details for a specific node.

```typescript
const result = await client.getNode('node-phone-1');
const node = result.payload.node;

console.log(node.name);
console.log(node.type);  // 'mobile', 'desktop', 'browser'
console.log(node.status);
```

### invokeNode(nodeId, capability, params)

Invokes a capability on a node.

```typescript
const result = await client.invokeNode(
  'node-phone-1',
  'camera',
  { action: 'capture', quality: 'high' }
);

console.log(result.payload.result);
```

### registerNode(node)

Registers a new node.

```typescript
const result = await client.registerNode({
  nodeId: 'my-device',
  name: 'My Device',
  capabilities: ['camera', 'microphone'],
  metadata: { os: 'iOS', version: '17.0' },
});
```

### unregisterNode(nodeId)

Unregisters a node.

```typescript
await client.unregisterNode('my-device');
```

## Configuration Operations

### getConfig(path?)

Gets configuration.

```typescript
// Get all config
const result = await client.getConfig();

// Get specific path
const result = await client.getConfig('app.theme');
```

### updateConfig(updates)

Updates configuration.

```typescript
const result = await client.updateConfig({
  'app.theme': 'dark',
  'server.port': 4000,
});
```

### watchConfig(paths?)

Watches for configuration changes.

```typescript
await client.watchConfig(['app', 'server']);

// Listen for changes
client.on('config.updated', (data) => {
  console.log('Config updated:', data.payload.updates);
});
```

### unwatchConfig()

Stops watching configuration changes.

```typescript
await client.unwatchConfig();
```

## Presence Operations

### updatePresence(status, metadata?)

Updates presence status.

```typescript
type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

await client.updatePresence('online', {
  device: 'desktop',
  location: 'office',
});
```

### getPresence(options?)

Gets presence information.

```typescript
// Get own presence
const result = await client.getPresence();

// Get presence by connection ID
const result = await client.getPresence({ connectionId: 'conn-123' });

// Get presence by client ID
const result = await client.getPresence({ clientId: 'user-456' });
```

### getAllPresence()

Gets all presence entries.

```typescript
const result = await client.getAllPresence();

result.payload.presence.forEach(p => {
  console.log(`${p.clientId}: ${p.status}`);
});
```

### subscribeToPresence()

Subscribes to presence events.

```typescript
await client.subscribeToPresence();

// Listen for presence changes
client.on('presence.changed', (data) => {
  console.log(`${data.payload.clientId} is now ${data.payload.status}`);
});
```

### unsubscribeFromPresence()

Unsubscribes from presence events.

```typescript
await client.unsubscribeFromPresence();
```

## Pairing Operations

### requestPairing(clientId, capabilities)

Requests device pairing.

```typescript
const result = await client.requestPairing('my-phone', ['camera', 'gps']);

console.log(`Pairing code: ${result.payload.pairingCode}`);
console.log(`Expires at: ${result.payload.expiresAt}`);
```

### getPairingStatus(code)

Checks pairing status.

```typescript
const result = await client.getPairingStatus('123456');
console.log(`Status: ${result.payload.status}`);
```

### approvePairing(code, capabilities?)

Approves a pairing request.

```typescript
const result = await client.approvePairing('123456', ['camera']);

console.log(`Node ID: ${result.payload.nodeId}`);
console.log(`Token: ${result.payload.token}`);
```

### denyPairing(code)

Denies a pairing request.

```typescript
await client.denyPairing('123456');
```

## Event Handling

### on(eventType, handler)

Subscribes to an event type. Returns an unsubscribe function.

```typescript
const unsubscribe = client.on('session.message', (data) => {
  console.log('Message:', data);
});

// Later: stop listening
unsubscribe();
```

### off(eventType, handler)

Unsubscribes from an event type.

```typescript
const handler = (data) => console.log(data);
client.on('test.event', handler);

// Unsubscribe
client.off('test.event', handler);
```

### once(eventType, handler)

Subscribes to an event once.

```typescript
client.once('connection.established', (data) => {
  console.log('Connected!', data.connectionId);
});
```

### onError(handler)

Subscribes to error events.

```typescript
const unsubscribe = client.onError((error) => {
  console.error('WebSocket error:', error.message);
});
```

### onStateChange(handler)

Subscribes to connection state changes.

```typescript
const unsubscribe = client.onStateChange((state) => {
  console.log('State:', state);
  // 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting'
});
```

## Event Types

| Event Type | Description | Payload |
|------------|-------------|---------|
| `connection.established` | Connection ready | `{ connectionId, heartbeatInterval }` |
| `session.created` | Session created | `{ sessionId, agentId }` |
| `session.message` | Message received | `{ sessionId, messageId, content }` |
| `session.stream.start` | Stream started | `{ runId }` |
| `session.stream.delta` | Stream token | `{ delta }` |
| `session.stream.done` | Stream complete | `{ runId }` |
| `presence.changed` | Presence update | `{ clientId, status, metadata }` |
| `config.updated` | Config changed | `{ updates, updatedAt }` |
| `error` | Error occurred | `{ message, code }` |
| `stateChange` | Connection state changed | `WebSocketClientState` |
| `close` | Connection closed | `{ code, reason }` |

## Cleanup

### destroy()

Destroys the client and releases all resources.

```typescript
client.destroy();
```

This will:
- Disconnect the WebSocket
- Clear all event handlers
- Reject all pending requests
- Clear heartbeat timer

## TypeScript Types

All types are exported from the package:

```typescript
import {
  // Client
  WebSocketClient,
  WebSocketClientOptions,
  WebSocketClientState,
  
  // Event handlers
  EventHandler,
  ErrorHandler,
  StateChangeHandler,
  
  // Options
  SessionCreateOptions,
  MessageOptions,
  AgentQueryFilter,
  
  // Events
  ConnectionEstablishedEvent,
  SessionEvent,
  PresenceChangedEvent,
  ConfigUpdatedEvent,
  ClientEvent,
  
  // Utilities
  Logger,
  PendingRequest,
  defaultWebSocketClientOptions,
  noopLogger,
} from '@openaidy/sdk';
```

## Examples

### Basic Chat Application

```typescript
import { createWebSocketClient } from '@openaidy/sdk';

async function main() {
  const client = createWebSocketClient({
    url: 'wss://api.openaidy.com/ws',
    token: process.env.OPENAIDY_TOKEN!,
  });

  await client.connect();

  // Create session
  const session = await client.createSession({
    agentId: 'assistant',
  });

  // Subscribe to messages
  client.on('session.message', (data) => {
    console.log('Assistant:', data.payload.content);
  });

  // Send message
  await client.sendMessage(
    session.payload.sessionId,
    'Hello! Can you help me?'
  );

  // Keep running
  process.on('SIGINT', () => {
    client.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
```

### Streaming Response Handler

```typescript
const client = createWebSocketClient({ url: 'ws://localhost:3000/ws' });
await client.connect();

// Handle stream events
client.on('session.stream.start', () => {
  process.stdout.write('Assistant: ');
});

client.on('session.stream.delta', (data) => {
  process.stdout.write(data.payload.delta);
});

client.on('session.stream.done', () => {
  process.stdout.write('\n');
});

// Send streaming message
const session = await client.createSession({ agentId: 'agent-1' });
await client.sendMessage(
  session.payload.sessionId,
  'Tell me a short story about a robot',
  { stream: true }
);
```

### Multi-Device Presence

```typescript
const client = createWebSocketClient({
  url: 'ws://localhost:3000/ws',
  clientId: 'user-123',
});

await client.connect();

// Subscribe to presence changes
await client.subscribeToPresence();

client.on('presence.changed', (data) => {
  const { clientId, status, metadata } = data.payload;
  console.log(`${clientId} is ${status} (${metadata?.device})`);
});

// Update own presence
await client.updatePresence('online', {
  device: 'desktop',
  app: 'web-client',
});

// Later: set away
await client.updatePresence('away');
```

### Device Pairing Flow

```typescript
// On the device requesting pairing
const deviceClient = createWebSocketClient({
  url: 'ws://localhost:3000/ws',
});

await deviceClient.connect();

const pairing = await deviceClient.requestPairing('my-phone', ['camera']);
console.log(`Enter code on desktop: ${pairing.payload.pairingCode}`);

// On the desktop approving pairing
const desktopClient = createWebSocketClient({
  url: 'ws://localhost:3000/ws',
});

await desktopClient.connect();

// User enters the code
const result = await desktopClient.approvePairing('123456', ['camera']);

console.log(`Approved! Node ID: ${result.payload.nodeId}`);
console.log(`Token for device: ${result.payload.token}`);

// Device can now use the token
await deviceClient.authenticate(result.payload.token);
```

### Error Handling

```typescript
const client = createWebSocketClient({
  url: 'ws://localhost:3000/ws',
  autoReconnect: true,
  maxReconnectAttempts: 5,
});

// Handle errors
client.onError((error) => {
  console.error('Error:', error.message);
  
  // Check error code
  if (error.message.includes('AUTH_FAILED')) {
    // Redirect to login
  }
});

// Handle state changes
client.onStateChange((state) => {
  if (state === 'reconnecting') {
    console.log('Connection lost, reconnecting...');
  }
  
  if (state === 'error') {
    console.log('Failed to connect after max attempts');
  }
});

try {
  await client.connect();
  const session = await client.createSession();
} catch (error) {
  console.error('Failed:', error);
}
```

### Custom Logger

```typescript
const client = createWebSocketClient({
  url: 'ws://localhost:3000/ws',
  logger: {
    info: (msg, data) => console.log(`[INFO] ${msg}`, data),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data),
    debug: (msg, data) => console.debug(`[DEBUG] ${msg}`, data),
  },
});
```

## Best Practices

### Connection Management

```typescript
// ✅ Good: Reuse connection
const client = createWebSocketClient({ url: '...' });
await client.connect();

// Use for multiple operations
await client.createSession();
await client.listAgents();
await client.sendMessage(/* ... */);

// ❌ Bad: New connection per operation
for (const message of messages) {
  const client = createWebSocketClient({ url: '...' });
  await client.connect();
  await client.sendMessage(/* ... */);
  client.destroy();
}
```

### Event Cleanup

```typescript
// ✅ Good: Store and cleanup subscriptions
const subscriptions = [
  client.on('event1', handler1),
  client.on('event2', handler2),
];

// Cleanup when done
subscriptions.forEach(unsub => unsub());

// ✅ Good: Use destroy() for full cleanup
client.destroy();
```

### Error Handling

```typescript
// ✅ Good: Handle errors
try {
  const result = await client.getSession(sessionId);
} catch (error) {
  if (error.message.includes('NOT_FOUND')) {
    // Session doesn't exist
  }
}

// ✅ Good: Use error handler
client.onError((error) => {
  // Global error handling
});
```

### Performance

```typescript
// ✅ Good: Batch operations
const sessions = await client.listSessions({ limit: 100 });

// ✅ Good: Use streaming for long responses
await client.sendMessage(sessionId, longPrompt, { stream: true });

// ❌ Bad: Many small requests
for (const id of sessionIds) {
  await client.getSession(id);
}
```

## Migration Guide

### From v1.x to v2.x

```typescript
// v1.x
const ws = new WebSocket('ws://...');
ws.send(JSON.stringify({ type: 'session.create', payload: {} }));

// v2.x
const client = createWebSocketClient({ url: 'ws://...' });
await client.connect();
await client.createSession();
```

### From REST API

```typescript
// REST
const response = await fetch('/api/sessions', { method: 'POST' });
const session = await response.json();

// WebSocket
const session = await client.createSession();
```

## Troubleshooting

### Connection Issues

```typescript
client.onStateChange((state) => {
  if (state === 'reconnecting') {
    console.log('Reconnecting...');
  }
});

client.onError((error) => {
  console.error('Connection error:', error);
});
```

### Authentication Failures

```typescript
client.onError((error) => {
  if (error.message.includes('AUTH_FAILED')) {
    // Token invalid or expired
    // Redirect to login
  }
});
```

### Timeout Issues

```typescript
const client = createWebSocketClient({
  url: 'ws://...',
  requestTimeout: 60000,  // Increase timeout to 60s
});
```
