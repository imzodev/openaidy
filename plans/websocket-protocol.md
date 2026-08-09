# WebSocket Protocol Documentation

This document describes the WebSocket protocol for the OpenAidy control plane.

## Overview

### What is the WebSocket Gateway?

The WebSocket gateway provides real-time, bidirectional communication between clients and the OpenAidy server. It enables:

- **Real-time messaging** - Instant message delivery without polling
- **Streaming responses** - Token-by-token streaming of AI responses
- **Event subscriptions** - Subscribe to session, agent, node, and presence events
- **Low latency** - Persistent connection eliminates HTTP overhead

### Why WebSocket vs REST?

| Feature          | REST                      | WebSocket             |
| ---------------- | ------------------------- | --------------------- |
| Communication    | Request/Response          | Bidirectional         |
| Latency          | HTTP overhead per request | Persistent connection |
| Streaming        | Not supported             | Native streaming      |
| Real-time events | Polling required          | Push-based            |
| Connection       | Stateless                 | Stateful              |

**Use WebSocket when:**

- You need real-time updates (chat, streaming)
- You want to subscribe to events
- Low latency is important
- You're building interactive applications

**Use REST when:**

- You need simple CRUD operations
- Caching is important
- You're doing batch operations
- HTTP proxies/load balancers are required

### When to Use WebSocket vs SSE

**Use WebSocket when:**

- Bidirectional communication is needed
- You need to send messages from the client
- Low latency for both directions matters

**Use Server-Sent Events (SSE) when:**

- Only server-to-client updates are needed
- Simpler HTTP-based protocol is preferred
- Automatic reconnection is desired

## Connection

### Connection URL

```
ws://localhost:3000/ws
wss://your-domain.com/ws  (production)
```

### Connection Lifecycle

1. **Client connects** - Opens WebSocket connection
2. **Server sends `connection.established`** - Confirms connection with ID
3. **Optional authentication** - Client authenticates with token
4. **Normal operation** - Exchange messages
5. **Heartbeat** - Periodic ping/pong to detect stale connections
6. **Close** - Clean connection close

### Authentication

Include JWT token in the connection URL:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws?token=YOUR_JWT_TOKEN');
```

### Connection Established

After connecting, the server sends:

```json
{
  "id": "msg_123",
  "type": "connection.established",
  "timestamp": "2026-03-29T12:00:00.000Z",
  "payload": {
    "connectionId": "conn_abc123",
    "heartbeatInterval": 30000
  }
}
```

### Heartbeat/Ping-Pong

Send periodic ping messages to keep the connection alive:

```json
{
  "id": "req_123",
  "type": "ping",
  "timestamp": "2026-03-29T12:00:30.000Z",
  "payload": {}
}
```

Server responds with `pong` or updates connection heartbeat.

### Reconnection Strategy

Recommended reconnection strategy:

1. **Immediate reconnect** - First attempt immediately
2. **Exponential backoff** - 1s, 2s, 4s, 8s, ... up to 30s
3. **Max attempts** - Give up after 10 failed attempts
4. **Jitter** - Add random delay to prevent thundering herd

```javascript
const reconnect = (attempt) => {
  const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
  const jitter = Math.random() * 1000;
  setTimeout(connect, delay + jitter);
};
```

## Message Protocol

### Message Envelope Structure

All messages follow this structure:

```typescript
interface WSMessage<T = string, P = unknown> {
  id: string; // Unique message ID
  type: T; // Message type (e.g., "session.create")
  timestamp: string; // ISO 8601 timestamp
  payload: P; // Message-specific payload
}
```

### Request-Response Correlation

Requests include an `id` field. Responses include the same `id`:

**Request:**

```json
{
  "id": "req_abc123",
  "type": "session.create",
  "timestamp": "2026-03-29T12:00:00.000Z",
  "payload": { "agentId": "agent-1" }
}
```

**Response:**

```json
{
  "id": "req_abc123",
  "type": "session.created",
  "timestamp": "2026-03-29T12:00:00.100Z",
  "payload": {
    "sessionId": "session_xyz",
    "agentId": "agent-1",
    "createdAt": "2026-03-29T12:00:00.100Z"
  }
}
```

### Error Handling

Errors are returned with `type: "error"`:

```json
{
  "id": "req_abc123",
  "type": "error",
  "timestamp": "2026-03-29T12:00:00.100Z",
  "payload": {
    "requestId": "req_abc123",
    "error": {
      "code": "NOT_FOUND",
      "message": "Session not found",
      "details": { "sessionId": "non-existent" }
    }
  }
}
```

### Error Codes

| Code                      | Description                 |
| ------------------------- | --------------------------- |
| `NOT_FOUND`               | Resource not found          |
| `AUTH_FAILED`             | Authentication failed       |
| `AUTH_REQUIRED`           | Authentication required     |
| `TOKEN_EXPIRED`           | JWT token has expired       |
| `TOKEN_INVALID`           | JWT token is invalid        |
| `FORBIDDEN`               | Permission denied           |
| `INSUFFICIENT_CAPABILITY` | Missing required capability |
| `INVALID_REQUEST`         | Invalid request format      |
| `INVALID_PAYLOAD`         | Invalid payload data        |
| `UNKNOWN_MESSAGE_TYPE`    | Unknown message type        |
| `RATE_LIMITED`            | Rate limit exceeded         |
| `ALREADY_EXISTS`          | Resource already exists     |
| `CONNECTION_LIMIT`        | Maximum connections reached |
| `INTERNAL_ERROR`          | Internal server error       |

## Session Operations

### Creating a Session

**Request:**

```json
{
  "id": "req_123",
  "type": "session.create",
  "timestamp": "2026-03-29T12:00:00.000Z",
  "payload": {
    "agentId": "agent-1",
    "providerId": "openai",
    "modelId": "gpt-4",
    "title": "My Chat Session",
    "metadata": { "source": "web" }
  }
}
```

**Response:**

```json
{
  "id": "req_123",
  "type": "session.created",
  "timestamp": "2026-03-29T12:00:00.100Z",
  "payload": {
    "sessionId": "session_abc",
    "agentId": "agent-1",
    "createdAt": "2026-03-29T12:00:00.100Z"
  }
}
```

### Getting Session Details

**Request:**

```json
{
  "id": "req_124",
  "type": "session.get",
  "timestamp": "2026-03-29T12:01:00.000Z",
  "payload": {
    "sessionId": "session_abc"
  }
}
```

**Response:**

```json
{
  "id": "req_124",
  "type": "session.get",
  "timestamp": "2026-03-29T12:01:00.050Z",
  "payload": {
    "session": {
      "id": "session_abc",
      "title": "My Chat Session",
      "status": "active",
      "agentId": "agent-1",
      "createdAt": "2026-03-29T12:00:00.100Z",
      "updatedAt": "2026-03-29T12:01:00.000Z"
    }
  }
}
```

### Listing Sessions

**Request:**

```json
{
  "id": "req_125",
  "type": "session.list",
  "timestamp": "2026-03-29T12:02:00.000Z",
  "payload": {
    "status": "active",
    "offset": 0,
    "limit": 10
  }
}
```

**Response:**

```json
{
  "id": "req_125",
  "type": "session.list",
  "timestamp": "2026-03-29T12:02:00.050Z",
  "payload": {
    "sessions": [
      { "id": "session_abc", "title": "My Chat", "status": "active" },
      { "id": "session_def", "title": "Another Chat", "status": "active" }
    ],
    "total": 2
  }
}
```

### Deleting a Session

**Request:**

```json
{
  "id": "req_126",
  "type": "session.delete",
  "timestamp": "2026-03-29T12:03:00.000Z",
  "payload": {
    "sessionId": "session_abc"
  }
}
```

**Response:**

```json
{
  "id": "req_126",
  "type": "session.delete",
  "timestamp": "2026-03-29T12:03:00.050Z",
  "payload": {
    "sessionId": "session_abc",
    "deleted": true
  }
}
```

### Sending a Message

**Non-streaming:**

```json
{
  "id": "req_127",
  "type": "session.message",
  "timestamp": "2026-03-29T12:04:00.000Z",
  "payload": {
    "sessionId": "session_abc",
    "role": "user",
    "content": "Hello, how are you?",
    "stream": false
  }
}
```

**Response:**

```json
{
  "id": "req_127",
  "type": "session.message",
  "timestamp": "2026-03-29T12:04:01.000Z",
  "payload": {
    "sessionId": "session_abc",
    "messageId": "msg_xyz",
    "role": "assistant",
    "content": "I'm doing well, thank you! How can I help you today?",
    "usage": {
      "promptTokens": 10,
      "completionTokens": 15,
      "totalTokens": 25
    },
    "finishReason": "stop"
  }
}
```

### Streaming Responses

**Streaming request:**

```json
{
  "id": "req_128",
  "type": "session.message",
  "timestamp": "2026-03-29T12:05:00.000Z",
  "payload": {
    "sessionId": "session_abc",
    "role": "user",
    "content": "Tell me a story",
    "stream": true
  }
}
```

**Stream events:**

```json
{ "type": "session.stream.start", "payload": { "runId": "run_123" } }
{ "type": "session.stream.delta", "payload": { "delta": "Once" } }
{ "type": "session.stream.delta", "payload": { "delta": " upon" } }
{ "type": "session.stream.delta", "payload": { "delta": " a time..." } }
{ "type": "session.stream.done", "payload": { "runId": "run_123" } }
```

### Subscribing to Session Events

**Request:**

```json
{
  "id": "req_129",
  "type": "session.subscribe",
  "timestamp": "2026-03-29T12:06:00.000Z",
  "payload": {
    "sessionId": "session_abc",
    "events": ["session.message", "session.updated"]
  }
}
```

**Response:**

```json
{
  "id": "req_129",
  "type": "session.subscribed",
  "timestamp": "2026-03-29T12:06:00.050Z",
  "payload": {
    "sessionId": "session_abc",
    "subscriptionId": "sub_xyz"
  }
}
```

## Agent Operations

### Listing Agents

**Request:**

```json
{
  "id": "req_130",
  "type": "agent.list",
  "timestamp": "2026-03-29T12:07:00.000Z",
  "payload": {}
}
```

**Response:**

```json
{
  "id": "req_130",
  "type": "agent.list",
  "timestamp": "2026-03-29T12:07:00.050Z",
  "payload": {
    "agents": [
      {
        "id": "agent-1",
        "name": "General Assistant",
        "description": "A helpful general-purpose assistant",
        "capabilities": ["chat", "code"]
      },
      {
        "id": "agent-2",
        "name": "Code Helper",
        "description": "Specialized in coding tasks",
        "capabilities": ["chat", "code", "debug"]
      }
    ]
  }
}
```

### Getting Agent Details

**Request:**

```json
{
  "id": "req_131",
  "type": "agent.get",
  "timestamp": "2026-03-29T12:08:00.000Z",
  "payload": {
    "agentId": "agent-1"
  }
}
```

**Response:**

```json
{
  "id": "req_131",
  "type": "agent.get",
  "timestamp": "2026-03-29T12:08:00.050Z",
  "payload": {
    "agent": {
      "id": "agent-1",
      "name": "General Assistant",
      "description": "A helpful general-purpose assistant",
      "systemPrompt": "You are a helpful assistant...",
      "capabilities": ["chat", "code"],
      "enabled": true
    }
  }
}
```

### Querying Agents

**Request:**

```json
{
  "id": "req_132",
  "type": "agent.query",
  "timestamp": "2026-03-29T12:09:00.000Z",
  "payload": {
    "filter": {
      "status": "available",
      "capability": "code"
    }
  }
}
```

**Response:**

```json
{
  "id": "req_132",
  "type": "agent.query",
  "timestamp": "2026-03-29T12:09:00.050Z",
  "payload": {
    "agents": [
      { "id": "agent-1", "name": "General Assistant" },
      { "id": "agent-2", "name": "Code Helper" }
    ]
  }
}
```

## Provider Operations

### Listing Providers

**Request:**

```json
{
  "id": "req_133",
  "type": "provider.list",
  "timestamp": "2026-03-29T12:10:00.000Z",
  "payload": {}
}
```

**Response:**

```json
{
  "id": "req_133",
  "type": "provider.list",
  "timestamp": "2026-03-29T12:10:00.050Z",
  "payload": {
    "providers": [
      {
        "id": "openai",
        "name": "OpenAI",
        "vendorFamily": "openai",
        "capabilities": ["chat", "streaming", "embeddings"]
      },
      {
        "id": "anthropic",
        "name": "Anthropic",
        "vendorFamily": "anthropic",
        "capabilities": ["chat", "streaming"]
      }
    ]
  }
}
```

### Getting Provider Details

**Request:**

```json
{
  "id": "req_134",
  "type": "provider.get",
  "timestamp": "2026-03-29T12:11:00.000Z",
  "payload": {
    "providerId": "openai"
  }
}
```

**Response:**

```json
{
  "id": "req_134",
  "type": "provider.get",
  "timestamp": "2026-03-29T12:11:00.050Z",
  "payload": {
    "provider": {
      "id": "openai",
      "name": "OpenAI",
      "vendorFamily": "openai",
      "capabilities": ["chat", "streaming", "embeddings"]
    }
  }
}
```

### Listing Provider Models

**Request:**

```json
{
  "id": "req_135",
  "type": "provider.models",
  "timestamp": "2026-03-29T12:12:00.000Z",
  "payload": {
    "providerId": "openai"
  }
}
```

**Response:**

```json
{
  "id": "req_135",
  "type": "provider.models",
  "timestamp": "2026-03-29T12:12:00.050Z",
  "payload": {
    "providerId": "openai",
    "models": [
      { "id": "gpt-4", "name": "GPT-4", "capabilities": ["chat", "streaming"] },
      {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini",
        "capabilities": ["chat", "streaming"]
      },
      {
        "id": "gpt-3.5-turbo",
        "name": "GPT-3.5 Turbo",
        "capabilities": ["chat", "streaming"]
      }
    ]
  }
}
```

## Node Operations

### Listing Nodes

**Request:**

```json
{
  "id": "req_136",
  "type": "node.list",
  "timestamp": "2026-03-29T12:13:00.000Z",
  "payload": {}
}
```

**Response:**

```json
{
  "id": "req_136",
  "type": "node.list",
  "timestamp": "2026-03-29T12:13:00.050Z",
  "payload": {
    "nodes": [
      {
        "nodeId": "node-phone-1",
        "name": "My Phone",
        "type": "mobile",
        "status": "online",
        "capabilities": ["camera", "microphone", "gps"]
      }
    ]
  }
}
```

### Getting Node Details

**Request:**

```json
{
  "id": "req_137",
  "type": "node.get",
  "timestamp": "2026-03-29T12:14:00.000Z",
  "payload": {
    "nodeId": "node-phone-1"
  }
}
```

**Response:**

```json
{
  "id": "req_137",
  "type": "node.get",
  "timestamp": "2026-03-29T12:14:00.050Z",
  "payload": {
    "node": {
      "nodeId": "node-phone-1",
      "name": "My Phone",
      "type": "mobile",
      "status": "online",
      "capabilities": ["camera", "microphone", "gps"],
      "metadata": { "os": "iOS", "version": "17.0" }
    }
  }
}
```

### Invoking Node Capabilities

**Request:**

```json
{
  "id": "req_138",
  "type": "node.invoke",
  "timestamp": "2026-03-29T12:15:00.000Z",
  "payload": {
    "nodeId": "node-phone-1",
    "capability": "camera",
    "params": { "action": "capture" }
  }
}
```

**Response:**

```json
{
  "id": "req_138",
  "type": "node.invoked",
  "timestamp": "2026-03-29T12:15:01.000Z",
  "payload": {
    "result": {
      "success": true,
      "imageUri": "file:///photos/img_123.jpg"
    }
  }
}
```

### Registering a Node

**Request:**

```json
{
  "id": "req_139",
  "type": "node.register",
  "timestamp": "2026-03-29T12:16:00.000Z",
  "payload": {
    "nodeId": "node-desktop-1",
    "name": "My Desktop",
    "type": "desktop",
    "capabilities": ["screen", "keyboard", "mouse"]
  }
}
```

**Response:**

```json
{
  "id": "req_139",
  "type": "node.registered",
  "timestamp": "2026-03-29T12:16:00.050Z",
  "payload": {
    "nodeId": "node-desktop-1"
  }
}
```

## Pairing Operations

### Creating a Pairing Request

**Request:**

```json
{
  "id": "req_140",
  "type": "pairing.request",
  "timestamp": "2026-03-29T12:17:00.000Z",
  "payload": {
    "clientId": "my-phone-client",
    "capabilities": ["camera", "microphone"]
  }
}
```

**Response:**

```json
{
  "id": "req_140",
  "type": "pairing.requested",
  "timestamp": "2026-03-29T12:17:00.050Z",
  "payload": {
    "requestId": "pair_abc",
    "pairingCode": "123456",
    "expiresAt": "2026-03-29T12:22:00.000Z"
  }
}
```

### Checking Pairing Status

**Request:**

```json
{
  "id": "req_141",
  "type": "pairing.status",
  "timestamp": "2026-03-29T12:18:00.000Z",
  "payload": {
    "code": "123456"
  }
}
```

**Response:**

```json
{
  "id": "req_141",
  "type": "pairing.status",
  "timestamp": "2026-03-29T12:18:00.050Z",
  "payload": {
    "status": "pending",
    "requestId": "pair_abc"
  }
}
```

### Approving a Pairing Request

**Request:**

```json
{
  "id": "req_142",
  "type": "pairing.approve",
  "timestamp": "2026-03-29T12:19:00.000Z",
  "payload": {
    "code": "123456",
    "capabilities": ["camera"]
  }
}
```

**Response:**

```json
{
  "id": "req_142",
  "type": "pairing.approved",
  "timestamp": "2026-03-29T12:19:00.050Z",
  "payload": {
    "nodeId": "node_xyz",
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### Denying a Pairing Request

**Request:**

```json
{
  "id": "req_143",
  "type": "pairing.deny",
  "timestamp": "2026-03-29T12:20:00.000Z",
  "payload": {
    "code": "123456"
  }
}
```

**Response:**

```json
{
  "id": "req_143",
  "type": "pairing.denied",
  "timestamp": "2026-03-29T12:20:00.050Z",
  "payload": {
    "requestId": "pair_abc"
  }
}
```

## Configuration Operations

### Getting Configuration

**Request:**

```json
{
  "id": "req_144",
  "type": "config.get",
  "timestamp": "2026-03-29T12:21:00.000Z",
  "payload": {}
}
```

**With path:**

```json
{
  "id": "req_145",
  "type": "config.get",
  "timestamp": "2026-03-29T12:21:30.000Z",
  "payload": {
    "path": "app"
  }
}
```

**Response:**

```json
{
  "id": "req_144",
  "type": "config.get",
  "timestamp": "2026-03-29T12:21:00.050Z",
  "payload": {
    "config": {
      "app": { "name": "OpenAidy", "version": "1.0.0" },
      "server": { "port": 3000 }
    }
  }
}
```

### Updating Configuration

**Request:**

```json
{
  "id": "req_146",
  "type": "config.update",
  "timestamp": "2026-03-29T12:22:00.000Z",
  "payload": {
    "updates": {
      "app.theme": "dark"
    }
  }
}
```

**Response:**

```json
{
  "id": "req_146",
  "type": "config.update",
  "timestamp": "2026-03-29T12:22:00.050Z",
  "payload": {
    "success": true,
    "config": { "app": { "name": "OpenAidy", "theme": "dark" } }
  }
}
```

### Watching for Configuration Changes

**Request:**

```json
{
  "id": "req_147",
  "type": "config.watch",
  "timestamp": "2026-03-29T12:23:00.000Z",
  "payload": {
    "paths": ["app", "server"]
  }
}
```

**Response:**

```json
{
  "id": "req_147",
  "type": "config.watch",
  "timestamp": "2026-03-29T12:23:00.050Z",
  "payload": {
    "watching": true,
    "paths": ["app", "server"]
  }
}
```

**Event when config changes:**

```json
{
  "type": "config.updated",
  "timestamp": "2026-03-29T12:24:00.000Z",
  "payload": {
    "updates": { "app.theme": "light" },
    "updatedAt": "2026-03-29T12:24:00.000Z"
  }
}
```

## Presence Operations

### Updating Presence

**Request:**

```json
{
  "id": "req_148",
  "type": "presence.update",
  "timestamp": "2026-03-29T12:25:00.000Z",
  "payload": {
    "status": "online",
    "metadata": {
      "device": "desktop",
      "location": "office"
    }
  }
}
```

**Response:**

```json
{
  "id": "req_148",
  "type": "presence.update",
  "timestamp": "2026-03-29T12:25:00.050Z",
  "payload": {
    "success": true,
    "presence": {
      "connectionId": "conn_abc",
      "status": "online",
      "metadata": { "device": "desktop" }
    }
  }
}
```

**Status values:** `online`, `away`, `busy`, `offline`

### Getting Presence Information

**Request:**

```json
{
  "id": "req_149",
  "type": "presence.get",
  "timestamp": "2026-03-29T12:26:00.000Z",
  "payload": {}
}
```

**Response:**

```json
{
  "id": "req_149",
  "type": "presence.get",
  "timestamp": "2026-03-29T12:26:00.050Z",
  "payload": {
    "presence": {
      "connectionId": "conn_abc",
      "status": "online",
      "metadata": { "device": "desktop" }
    }
  }
}
```

### Subscribing to Presence Events

**Request:**

```json
{
  "id": "req_150",
  "type": "presence.subscribe",
  "timestamp": "2026-03-29T12:27:00.000Z",
  "payload": {}
}
```

**Response:**

```json
{
  "id": "req_150",
  "type": "presence.subscribe",
  "timestamp": "2026-03-29T12:27:00.050Z",
  "payload": {
    "subscribed": true
  }
}
```

**Event when presence changes:**

```json
{
  "type": "presence.changed",
  "timestamp": "2026-03-29T12:28:00.000Z",
  "payload": {
    "clientId": "user-123",
    "status": "away",
    "metadata": { "device": "desktop" }
  }
}
```

## Security

### Authentication Flow

1. **Obtain JWT token** - From login or API key exchange
2. **Connect with token** - Include in WebSocket URL
3. **Token validated** - Server validates signature and expiration
4. **Capabilities extracted** - Token contains user capabilities
5. **Connection established** - Ready for operations

### Authorization

Operations require specific capabilities:

| Capability       | Operations                                      |
| ---------------- | ----------------------------------------------- |
| `session.read`   | session.get, session.list                       |
| `session.write`  | session.create, session.delete, session.message |
| `agent.read`     | agent.list, agent.get, agent.query              |
| `provider.read`  | provider.list, provider.get, provider.models    |
| `node.read`      | node.list, node.get                             |
| `node.write`     | node.register, node.unregister, node.invoke     |
| `config.read`    | config.get                                      |
| `config.write`   | config.update                                   |
| `presence.read`  | presence.get, presence.getAll                   |
| `presence.write` | presence.update                                 |
| `*`              | All operations                                  |

### Token Management

- **Expiration**: Tokens expire after configured time (default: 24h)
- **Refresh**: Obtain new token before expiration
- **Revocation**: Tokens can be revoked server-side

### Capability-Based Access Control

```json
{
  "sub": "user-123",
  "capabilities": ["session.read", "session.write", "agent.read"],
  "exp": 1711708800
}
```

## Best Practices

### Connection Management

- **Reuse connections** - Keep connection open, don't reconnect per request
- **Handle disconnects** - Implement reconnection with backoff
- **Clean up** - Close connection when done
- **Monitor state** - Track connection state changes

### Error Handling

```javascript
client.onError((error) => {
  console.error('WebSocket error:', error);
  // Implement reconnection or notify user
});
```

### Performance Optimization

- **Batch requests** - Combine multiple requests when possible
- **Limit subscriptions** - Only subscribe to needed events
- **Use streaming** - Stream long responses instead of waiting
- **Cache data** - Cache agent/provider lists

### Security Considerations

- **Token storage** - Store tokens securely (not in localStorage for web)
- **TLS** - Always use `wss://` in production
- **Capability scope** - Request minimum required capabilities
- **Token refresh** - Refresh tokens before expiration

## Examples

### Basic Connection Example

```javascript
import { createWebSocketClient } from '@openaidy/sdk';

const client = createWebSocketClient({
  url: 'wss://api.example.com/ws',
  token: 'your-jwt-token',
});

await client.connect();

// Listen for events
client.on('session.message', (data) => {
  console.log('New message:', data);
});

// Create a session and send a message
const session = await client.createSession({ agentId: 'agent-1' });
const response = await client.sendMessage(session.payload.sessionId, 'Hello!');

console.log('Response:', response.payload.content);

// Clean up
client.disconnect();
```

### Streaming Message Example

```javascript
const client = createWebSocketClient({
  url: 'wss://api.example.com/ws',
  token: 'your-jwt-token',
});

await client.connect();

// Subscribe to stream events
client.on('session.stream.delta', (data) => {
  process.stdout.write(data.payload.delta);
});

client.on('session.stream.done', (data) => {
  console.log('\nStream complete!');
});

// Send streaming message
await client.sendMessage(sessionId, 'Tell me a story', { stream: true });
```

### Node Invocation Example

```javascript
const client = createWebSocketClient({ url: 'ws://localhost:3000/ws' });
await client.connect();

// List available nodes
const nodes = await client.listNodes();
const cameraNode = nodes.payload.nodes.find((n) =>
  n.capabilities.includes('camera'),
);

if (cameraNode) {
  // Invoke camera capability
  const result = await client.invokeNode(cameraNode.nodeId, 'camera', {
    action: 'capture',
    quality: 'high',
  });

  console.log('Photo captured:', result.payload.imageUri);
}
```

### Presence Subscription Example

```javascript
const client = createWebSocketClient({ url: 'ws://localhost:3000/ws' });
await client.connect();

// Subscribe to presence changes
await client.subscribeToPresence();

client.on('presence.changed', (data) => {
  console.log(`${data.payload.clientId} is now ${data.payload.status}`);
});

// Update own presence
await client.updatePresence('online', { device: 'mobile' });
```
