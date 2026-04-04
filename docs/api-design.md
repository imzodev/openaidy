---
summary: "Suggested API design for OpenAidy core services"
read_when:
  - You are designing OpenAidy server routes and real-time contracts
  - You need a starting point for sessions, cron, channels, pairing, instances, and MCP APIs
title: "OpenAidy API Design"
---

# OpenAidy API Design

This document proposes the initial API surface for OpenAidy.

## Transport choices

Recommended transport split:

- REST for CRUD and administrative operations
- WebSocket or Server-Sent Events for live updates and stream events
- optional MCP server transport for external automation and tool access

## WebSocket API

The WebSocket gateway provides real-time, bidirectional communication. Connect to `/ws` with a valid JWT token:

```
wss://api.openaidy.com/ws?token=<jwt-token>
```

### Connection Lifecycle

- `connection.established` - Sent when connection is ready
- `heartbeat` - Keep-alive ping/pong
- `error` - Error notifications

### Message Types

All messages follow a consistent format:

```typescript
{
  id: string;          // Unique request ID
  type: string;        // Message type (e.g., "session.create")
  timestamp: string;   // ISO 8601 timestamp
  payload: object;     // Message-specific data
}
```

### Session Operations

| Type | Description |
|------|-------------|
| `session.create` | Create a new session |
| `session.get` | Get session details |
| `session.list` | List sessions |
| `session.delete` | Delete a session |
| `session.subscribe` | Subscribe to session events |
| `session.unsubscribe` | Unsubscribe from session |
| `session.message` | Send message to session |
| `session.stream.start` | Streaming started |
| `session.stream.delta` | Stream token chunk |
| `session.stream.done` | Stream completed |

### Agent & Provider Operations

| Type | Description |
|------|-------------|
| `agent.list` | List available agents |
| `agent.get` | Get agent details |
| `provider.list` | List providers |
| `provider.models` | Get provider models |

### Node & Pairing Operations

| Type | Description |
|------|-------------|
| `node.list` | List registered nodes |
| `node.register` | Register a node |
| `node.invoke` | Invoke node capability |
| `pairing.request` | Request pairing |
| `pairing.approve` | Approve pairing |

### Presence & Config Operations

| Type | Description |
|------|-------------|
| `presence.update` | Update presence status |
| `presence.get` | Get presence |
| `config.get` | Get configuration |
| `config.update` | Update configuration |

For complete protocol reference, see [WebSocket Protocol](./websocket-protocol).

## Auth model

Use:

- user session tokens for operator UI
- device tokens for paired runtimes
- scoped plugin permissions enforced server-side

All mutation APIs should perform role and capability checks.

## Sessions API

### REST endpoints

- `POST /api/sessions`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/sessions/:sessionId/messages`
- `GET /api/sessions/:sessionId/messages`
- `GET /api/sessions/:sessionId/runs`
- `POST /api/sessions/:sessionId/dispatch`

### Event stream examples

- `session.created`
- `session.message.appended`
- `session.run.started`
- `session.run.delta`
- `session.run.completed`
- `session.run.failed`

## Scheduler API

### REST endpoints

- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/:jobId`
- `PATCH /api/jobs/:jobId`
- `DELETE /api/jobs/:jobId`
- `POST /api/jobs/:jobId/run`
- `GET /api/jobs/:jobId/runs`

### Event examples

- `job.created`
- `job.updated`
- `job.started`
- `job.completed`
- `job.failed`
- `job.disabled`

## Channels API

### REST endpoints

- `GET /api/channels`
- `GET /api/channels/accounts`
- `POST /api/channels/accounts`
- `GET /api/channels/accounts/:accountId`
- `PATCH /api/channels/accounts/:accountId`
- `POST /api/channels/accounts/:accountId/connect`
- `POST /api/channels/accounts/:accountId/disconnect`
- `POST /api/channels/accounts/:accountId/send`

### Event examples

- `channel.account.created`
- `channel.account.updated`
- `channel.account.health.changed`
- `channel.message.received`
- `channel.message.sent`

## Instances API

### REST endpoints

- `GET /api/instances`
- `GET /api/instances/:instanceId`
- `POST /api/instances/:instanceId/heartbeat`
- `GET /api/instances/:instanceId/capabilities`

### Event examples

- `instance.online`
- `instance.offline`
- `instance.updated`

## Pairing API

### REST endpoints

- `POST /api/pairing/requests`
- `GET /api/pairing/requests`
- `POST /api/pairing/requests/:requestId/approve`
- `POST /api/pairing/requests/:requestId/reject`
- `GET /api/devices`
- `GET /api/devices/:deviceId`
- `POST /api/devices/:deviceId/revoke`
- `POST /api/devices/:deviceId/rotate-token`

### Event examples

- `pairing.requested`
- `pairing.approved`
- `pairing.rejected`
- `device.revoked`
- `device.token.rotated`

## Config API

### REST endpoints

- `GET /api/config`
- `PUT /api/config`
- `GET /api/config/schema`
- `GET /api/plugins/:pluginId/config/schema`
- `PUT /api/plugins/:pluginId/config`

## Plugin API

### REST endpoints

- `GET /api/plugins`
- `POST /api/plugins/install`
- `POST /api/plugins/:pluginId/enable`
- `POST /api/plugins/:pluginId/disable`
- `DELETE /api/plugins/:pluginId`
- `GET /api/plugins/:pluginId`
- `GET /api/plugins/:pluginId/permissions`
- `PUT /api/plugins/:pluginId/permissions`

## MCP API

### REST endpoints

- `GET /api/mcp/servers`
- `POST /api/mcp/servers`
- `GET /api/mcp/servers/:serverId`
- `POST /api/mcp/servers/:serverId/discover`
- `GET /api/mcp/servers/:serverId/tools`
- `POST /api/mcp/servers/:serverId/tools/:toolName/invoke`

### MCP server exposure

OpenAidy can also expose selected platform operations as MCP tools, such as:

- list sessions
- read session transcript
- dispatch agent
- create scheduled job
- list instances
- inspect pairing requests

## Suggested REST response patterns

Use predictable response envelopes for administrative endpoints.

Example:

```json
{
  "data": {},
  "error": null,
  "meta": {}
}
```

For stream events, use compact typed event frames.

Example:

```json
{
  "event": "session.run.delta",
  "ts": 1760000000000,
  "payload": {}
}
```

## Recommended validation rules

- validate all request bodies with Zod
- reject unknown capability grants
- keep session and job identifiers opaque
- prevent plugin config writes unless the plugin schema validates
- ensure device approval and token rotation actions are audited

## Recommended API order for implementation

Build first:

- sessions
- dispatch
- jobs
- instances
- pairing
- config
- plugins
- MCP

This order supports a working operator experience while preserving room for future extensibility.
