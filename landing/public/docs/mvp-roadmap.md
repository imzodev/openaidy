---
summary: 'Suggested MVP roadmap for OpenAidy'
read_when:
  - You want to plan the first implementation phases for OpenAidy
  - You need a sequence that preserves fast progress without excessive coupling
title: 'OpenAidy MVP Roadmap'
---

# OpenAidy MVP Roadmap

This roadmap focuses on delivering the main platform capabilities in a cleaner, plugin-first architecture.

## Guiding rules

- Build the core contracts before building many integrations.
- Prefer one complete vertical slice over many partial systems.
- Keep channels and UI extensions on supported APIs from the beginning.
- Ship pairing, auth, and scheduler early so the platform can grow safely.

## Phase 0: repo bootstrap

### Outcomes

- monorepo structure exists
- dev environment works
- shared TypeScript tooling is stable
- database migrations run locally
- Fastify server and SolidJS app boot successfully

### Deliverables

- pnpm workspace
- base tsconfig
- linting, formatting, test runner
- Fastify app skeleton
- SolidJS app shell
- Postgres or SQLite local development setup

## Phase 1: sessions and dispatch

### Outcomes

- sessions can be created and listed
- transcript entries can be appended
- agent dispatch can run against a session
- UI can stream agent output

### Deliverables

- `SessionService`
- `DispatchService`
- transcript store
- basic operator UI for sessions
- one model provider adapter
- stream events over SSE or WebSocket

### Acceptance criteria

- a user can create a session
- a message can trigger an agent run
- the transcript persists across restart

## Phase 2: scheduler and cron

### Outcomes

- delayed and recurring jobs work
- jobs can target sessions or isolated runs
- execution history is visible

### Deliverables

- `SchedulerService`
- persisted scheduled jobs
- job locking and retry logic
- cron UI and API

### Acceptance criteria

- one-shot jobs execute reliably after restart
- recurring jobs do not double-run under normal locking behavior
- failures and retries are visible in history

## Phase 3: instances and presence

### Outcomes

- connected runtimes are visible
- instance capabilities are tracked
- heartbeats update liveness

### Deliverables

- `InstanceRegistry`
- heartbeat API
- presence table and UI
- instance capability model

### Acceptance criteria

- operator UI can list online instances
- stale instances are marked offline
- dispatch can target compatible runtimes

## Phase 4: device pairing

### Outcomes

- devices and runtimes can request pairing
- approvals are auditable
- scoped device tokens support reconnects

### Deliverables

- `PairingService`
- `DeviceRegistry`
- pairing request store
- approval UI
- token rotation and revoke flows

### Acceptance criteria

- an unpaired runtime can request trust
- an operator can approve or reject the request
- approved runtimes reconnect without a fresh manual approval every time

## Phase 5: first channel plugin

### Outcomes

- one real channel runs entirely through plugin APIs
- sessions can be routed from channel messages
- outbound delivery works

### Deliverables

- channel plugin SDK
- one first-party channel plugin
- channel account UI
- message normalization contract

### Acceptance criteria

- inbound messages create or resume sessions
- agent responses can be sent back through the channel
- core session logic does not depend on channel-specific code

## Phase 6: configuration system

### Outcomes

- users can edit config safely
- config is validated and versioned
- plugins can declare config schema and UI metadata

### Deliverables

- `ConfigService`
- schema-based validation with Zod
- config editor UI
- secrets abstraction

### Acceptance criteria

- invalid config is rejected with actionable errors
- plugin settings are validated before enablement
- config changes can be applied without hidden side effects

## Phase 7: MCP integration

### Outcomes

- external MCP servers can be used as tool providers
- OpenAidy exposes selected features as MCP tools

### Deliverables

- `McpRegistry`
- MCP client bridge
- MCP server bridge
- tool and resource adapters

### Acceptance criteria

- an MCP server can be registered and queried
- discovered tools can be used in agent dispatch
- external clients can call selected OpenAidy MCP endpoints

## What to postpone

Postpone these until the core is stable:

- marketplace and plugin catalog
- untrusted remote UI extensions
- broad multi-tenant features
- many channels at once
- advanced policy engine
- embedded Python worker system

## Suggested sequence by week

### Week 1

- repo bootstrap
- session schema
- session CRUD
- basic dispatch flow

### Week 2

- transcript persistence
- streaming UI
- first provider adapter
- basic tests

### Week 3

- scheduler models
- due-job executor
- run history
- cron UI skeleton

### Week 4

- instance presence
- heartbeat flow
- routing by capability

### Week 5

- pairing request flow
- approvals UI
- device token lifecycle

### Week 6

- first real channel plugin
- inbound and outbound message path

### Week 7

- configuration editor
- plugin config schemas
- secret handling

### Week 8

- MCP client bridge
- MCP server basics
- integration polish

## MVP definition

OpenAidy reaches MVP when it can:

- run and persist sessions
- dispatch agents manually and on schedule
- route at least one real channel through plugin APIs
- show instances and pairing state
- manage config cleanly
- consume at least one MCP server
