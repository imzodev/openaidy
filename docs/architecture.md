---
summary: "Core architecture for OpenAidy as a plugin-first agent platform"
read_when:
  - You are defining the system boundaries for OpenAidy
  - You need a high-level view of services, runtimes, and extension points
title: "OpenAidy Architecture"
---

# OpenAidy Architecture

OpenAidy should be a plugin-first agent platform built around a small core and a stable set of extension contracts. The goal is to preserve strong agent-platform capabilities while reducing coupling between the UI, channels, runtime, and third-party integrations.

## Goals

- Fast Node.js and TypeScript runtime for orchestration and real-time features.
- Stable extension APIs for channels, tools, UI panels, automations, and providers.
- Strict capability-based permissions for plugins and connected devices.
- Clear separation between control-plane logic and optional AI-heavy worker services.
- A configuration and operational model that is easy to understand and automate.

## Non-goals

- Reproducing legacy internal abstractions from older systems.
- Allowing plugins to import random private modules from the core.
- Making browser addons depend on the same runtime state and auth tricks as the core UI.

## Main subsystems

### Core API server

The core API server owns:

- authentication and session tokens
- authorization and capability checks
- session lifecycle
- scheduler and cron orchestration
- instance registry and presence
- device pairing
- plugin lifecycle
- MCP client and MCP server bridges
- configuration loading and validation
- **WebSocket gateway for real-time communication**

Recommended stack:

- Node.js 22+
- TypeScript
- Fastify
- WebSocket + Server-Sent Events
- Zod for contracts and validation

### WebSocket gateway

The WebSocket gateway provides real-time, bidirectional communication between clients and the OpenAidy server. It enables:

- **Real-time messaging** - Instant message delivery without polling
- **Streaming responses** - Token-by-token streaming of AI responses
- **Event subscriptions** - Subscribe to session, agent, node, and presence events
- **Low latency** - Persistent connection eliminates HTTP overhead

Key components:

- **Connection Manager** - Manages connections, heartbeats, rate limiting
- **Message Router** - Routes messages to appropriate handlers
- **Authentication Middleware** - JWT validation and capability extraction
- **Handlers** - Session, Agent, Provider, Node, Pairing, Config, Presence
- **Services** - NodeRegistry, PairingService, PresenceManager, StreamManager

For detailed architecture, see [WebSocket Architecture](./websocket-architecture).

### Session engine

The session engine is the source of truth for chat history, agent dispatch, and transcript state.

Responsibilities:

- create and resolve sessions
- append immutable transcript entries
- store agent runs and artifacts
- support channel-bound and standalone sessions
- expose a stable API for querying history and current state

### Scheduler

The scheduler is responsible for cron jobs, one-off delayed work, retries, delivery policies, and dispatch triggers.

Responsibilities:

- persist job definitions
- acquire execution locks
- emit dispatch requests
- record run results and retries
- deliver outputs to sessions, channels, or webhooks

### Channel runtime

Channels should be implemented as plugins. The core should only know about channel capabilities and transport-neutral events.

Responsibilities:

- normalize inbound messages into core events
- send outbound messages on request
- maintain account-level channel state
- report health and pairing status

### Instance registry

Instances represent connected runtimes such as operator UIs, worker nodes, and channel bridges.

Responsibilities:

- register and identify running instances
- track last-seen timestamps and heartbeat health
- surface capabilities and version metadata
- support routing of work to compatible runtimes

### Device pairing

The pairing subsystem establishes trust between the server and connected runtimes or operator devices.

Responsibilities:

- create pairing requests
- approve or deny pairing
- issue scoped device tokens
- rotate or revoke access
- store role and scope grants

### Plugin platform

Plugins should be isolated from the core and loaded through typed manifests and SDK contracts.

Plugin categories:

- channel plugins
- tool plugins
- UI plugins
- automation plugins
- provider plugins

The core should expose registration APIs instead of private module access.

### MCP integration

OpenAidy should support both directions:

- using external MCP servers as tool/resource providers
- exposing OpenAidy features as an MCP server

This enables composability with other agent tools and local automation environments.

## Data flow

### Inbound channel message

1. Channel plugin receives a transport-specific event.
2. Channel plugin normalizes it to a core message envelope.
3. Core resolves the target session.
4. Dispatch service creates an agent run request.
5. Runtime emits stream events to the UI, channel, or webhook.
6. Transcript and run state are persisted.

### Scheduled dispatch

1. Scheduler selects due jobs.
2. A lock is acquired.
3. A dispatch request is emitted with job context.
4. Dispatch runtime executes the agent turn.
5. Results are persisted and optionally delivered.
6. The scheduler records success, failure, retry, or disable state.

### Device pairing

1. New runtime or operator client requests pairing.
2. Core verifies identity proof.
3. Approval UI or policy resolves the request.
4. Core stores roles, scopes, and metadata.
5. Device token is issued for future reconnects.

## Internal event model

Use an internal event bus for coarse-grained domain events.

Examples:

- `session.created`
- `session.message.appended`
- `dispatch.requested`
- `dispatch.completed`
- `job.scheduled`
- `job.started`
- `job.finished`
- `instance.online`
- `instance.offline`
- `device.pair.requested`
- `device.pair.approved`
- `plugin.loaded`
- `plugin.unloaded`

The event bus should connect modules without creating direct dependency chains for every operation.

## Security model

### Core principles

- All plugin capabilities must be explicitly declared.
- Device tokens should be scoped by role and granted capabilities.
- Session APIs must enforce per-role access.
- Plugins should not be able to read arbitrary secrets by default.
- UI extensions should receive only the data they are permitted to access.

### Capability examples

- `sessions.read`
- `sessions.write`
- `dispatch.run`
- `channels.send`
- `channels.receive`
- `jobs.schedule`
- `config.read`
- `config.write`
- `mcp.use`
- `secrets.read`

## Recommended deployment model

### Core service

A single Fastify service can own:

- API routes
- WebSocket events
- scheduler
- pairing
- config
- MCP registry

### Optional worker services

Add separate workers if needed for:

- document ingestion
- embeddings
- Python-native AI libraries
- heavy background processing

The core should remain usable without those workers.

## Recommended MVP scope

Build these first:

- auth and capabilities
- sessions and transcript store
- dispatch runtime
- scheduler
- config service
- instance presence
- pairing
- one channel plugin
- MCP client bridge

Postpone these until later:

- plugin marketplace
- remote third-party UI sandboxing
- complex multi-tenant controls
- many channels at once

## Success criteria

OpenAidy is on the right path if:

- new channels can be built without changing core session code
- scheduled jobs can dispatch agents without channel-specific hacks
- device pairing is understandable and auditable
- UI panels can be added through a supported plugin API
- MCP tools can be discovered and used without custom glue for each server
- core auth and transport logic stay small and boring
