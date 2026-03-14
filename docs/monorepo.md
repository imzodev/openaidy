---
summary: "Suggested monorepo structure for OpenAidy"
read_when:
  - You are setting up the repository layout for OpenAidy
  - You want to define package boundaries before implementation
title: "OpenAidy Monorepo Structure"
---

# OpenAidy Monorepo Structure

This document proposes a pnpm workspace layout for OpenAidy. The goal is to keep the core small, share types cleanly, and let plugins depend on public SDK packages instead of internal files.

## Recommended tools

- pnpm workspaces
- TypeScript project references
- Turborepo only if build orchestration becomes large enough to justify it

## Top-level layout

```text
openaidy/
  apps/
    server/
    web/
    worker/
  packages/
    core/
    db/
    sdk/
    plugin-sdk/
    channel-sdk/
    ui-sdk/
    mcp/
    runtime/
    config/
    shared-types/
    testing/
  plugins/
    channel-telegram/
    channel-discord/
    dashboard-ops/
    provider-openai/
    automation-webhook/
  docs/
  scripts/
  pnpm-workspace.yaml
  package.json
  tsconfig.base.json
```

## Applications

### `apps/server`

The main Fastify service.

Responsibilities:

- REST API
- WebSocket server
- Server-Sent Events
- scheduler
- pairing endpoints
- plugin loading
- MCP registry
- auth and permissions

### `apps/web`

The operator UI.

Responsibilities:

- session views
- instance and presence UI
- pairing approvals
- scheduler UI
- plugin panel host
- configuration editor

### `apps/worker`

Optional worker process for background execution.

Responsibilities:

- heavy jobs
- queue consumers
- external bridge tasks
- future Python interop bridge if needed

## Core packages

### `packages/core`

The main domain layer.

Suggested directories:

```text
packages/core/
  src/
    auth/
    sessions/
    dispatch/
    scheduler/
    channels/
    instances/
    pairing/
    plugins/
    events/
    mcp/
```

### `packages/db`

Owns:

- database schema
- migrations
- repositories
- transaction helpers
- test fixtures for persistence

Recommended stack:

- Drizzle ORM
- PostgreSQL in production
- SQLite for lightweight local development if desired

### `packages/sdk`

General public SDK for first-party and third-party consumers.

Contains:

- shared client types
- API client helpers
- auth token shapes
- event types
- Zod schemas that are safe to publish

### `packages/plugin-sdk`

Public plugin registration API.

Contains:

- plugin manifest types
- plugin registration functions
- capability declarations
- lifecycle hooks
- common plugin context objects

### `packages/channel-sdk`

Shared abstractions for channel plugins.

Contains:

- inbound event shapes
- outbound message types
- account metadata contracts
- typing for pairing and transport health

### `packages/ui-sdk`

Public contracts for UI panels and dashboard integrations.

Contains:

- panel registration API
- typed bridge messages
- panel mount context
- permission-aware data access contracts

### `packages/mcp`

Owns:

- MCP client adapters
- MCP server bindings
- tool and resource mapping
- transport wrappers

### `packages/runtime`

Owns:

- agent runtime interfaces
- provider abstraction
- tool execution plumbing
- stream events

### `packages/config`

Owns:

- config schema
- config loaders
- env override helpers
- secret-source interfaces

### `packages/shared-types`

Contains only pure portable contracts used in many places.

Examples:

- IDs
- event envelopes
- capability types
- DTOs shared by web and server

Avoid putting runtime code here.

### `packages/testing`

Reusable test helpers.

Contains:

- fake plugin harnesses
- fixture builders
- fake event bus
- fake channel transport
- contract test utilities

## Plugins directory

Keep example and first-party plugins separate from the core.

Examples:

- `plugins/channel-telegram`
- `plugins/channel-discord`
- `plugins/dashboard-ops`
- `plugins/provider-openai`
- `plugins/automation-webhook`

The rule is simple:

- core packages define contracts
- plugins consume contracts
- plugins do not import from private core internals

## Dependency direction

Recommended dependency flow:

- `apps/*` can depend on `packages/*`
- `plugins/*` can depend on published SDK-style packages only
- `packages/core` can depend on `packages/shared-types`, `packages/config`, `packages/db`, `packages/runtime`, and `packages/mcp`
- `packages/shared-types` should depend on almost nothing

Avoid reverse dependencies where plugin-facing packages depend on app code.

## Versioning strategy

For early development:

- version the whole monorepo together

When plugin ecosystem grows:

- keep SDK packages versioned deliberately
- document compatibility policy for plugin manifests and capability contracts

## Publishing strategy

Potential publish targets:

- `@openaidy/sdk`
- `@openaidy/plugin-sdk`
- `@openaidy/channel-sdk`
- `@openaidy/ui-sdk`
- `@openaidy/mcp`

This makes third-party plugin development easier and reduces coupling to the main repo.

## Build strategy

Recommended build flow:

- build shared packages first
- build server and web apps after contracts stabilize
- run contract tests for SDK packages before integration tests

## Local developer experience

Provide top-level commands such as:

```bash
pnpm dev
pnpm dev:server
pnpm dev:web
pnpm test
pnpm build
pnpm plugin:test
```

The repository should feel friendly to both product development and plugin authors.
