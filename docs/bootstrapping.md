---
summary: "Practical bootstrap guide for starting OpenAidy from scratch"
read_when:
  - You are initializing the OpenAidy repository
  - You want concrete steps, packages, and commands for the initial foundation
  - You need a recommended first vertical slice for implementation
title: "Bootstrapping OpenAidy"
---

# Bootstrapping OpenAidy

This document describes how to start OpenAidy from scratch using Node.js and TypeScript without Next.js.

The goal is to create a strong foundation that is:

- fast to develop
- easy to reason about
- plugin-friendly
- ready for sessions, scheduling, channels, pairing, and MCP

## Recommended stack

### Monorepo

Use:

- pnpm workspaces

Optional later:

- Turborepo if the repo grows enough to justify more build orchestration

### Backend

Use:

- Fastify
- TypeScript
- Zod
- Pino
- PostgreSQL
- Drizzle ORM
- Server-Sent Events for streaming
- WebSocket for app events

### Frontend

Use:

- SolidJS
- Vite
- TypeScript
- Tailwind CSS
- TanStack Query for Solid
- Solid Router
- SolidUI

### Testing and tooling

Use:

- Vitest
- ESLint
- Prettier
- tsx for local TypeScript execution

## Prerequisites

Recommended versions:

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+ for local development

Optional:

- Docker for running PostgreSQL locally

## Initial repository layout

```text
openaidy/
  apps/
    server/
    web/
  packages/
    shared-types/
    db/
    config/
    sdk/
    plugin-sdk/
    ui-sdk/
    runtime/
  plugins/
    example-tool/
    example-panel/
    example-channel/
  docs/
  scripts/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

## Step 1: initialize the repository

Create the repository root and initialize the workspace.

Suggested root files:

### `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
  - plugins/*
```

### Root `package.json`

Recommended scripts:

```json
{
  "name": "openaidy",
  "private": true,
  "packageManager": "pnpm@10.23.0",
  "scripts": {
    "dev": "pnpm --parallel --filter ./apps/server --filter ./apps/web dev",
    "dev:server": "pnpm --filter ./apps/server dev",
    "dev:web": "pnpm --filter ./apps/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "format": "prettier --write ."
  }
}
```

### Root `tsconfig.base.json`

Start with strict TypeScript settings and reuse them across apps and packages.

Recommended baseline:

- `strict: true`
- `module: ESNext`
- `moduleResolution: Bundler`
- `target: ES2022`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`

## Step 2: install core tooling

Suggested root dev dependencies:

```bash
pnpm add -D typescript tsx vitest eslint prettier @types/node
```

Optional later:

```bash
pnpm add -D turbo
```

## Step 3: create the server app

### Packages to install in `apps/server`

```bash
pnpm add fastify @fastify/cors @fastify/websocket @fastify/sensible zod pino nanoid eventemitter3 croner drizzle-orm pg
pnpm add -D drizzle-kit
```

### Suggested structure

```text
apps/server/
  src/
    app.ts
    server.ts
    routes/
    auth/
    sessions/
    dispatch/
    scheduler/
    channels/
    instances/
    pairing/
    plugins/
    mcp/
    lib/
  package.json
  tsconfig.json
```

### Responsibilities of the server app

The server app should own:

- HTTP API
- WebSocket server
- SSE endpoints for streaming
- auth and capability checks
- session lifecycle
- scheduler
- instance presence
- pairing
- plugin loading
- MCP registry and adapters

## Step 4: create the web app

### Packages to install in `apps/web`

```bash
pnpm add solid-js @solidjs/router @tanstack/solid-query zod lucide-solid
pnpm add -D vite vite-plugin-solid tailwindcss
```

### Suggested structure

```text
apps/web/
  src/
    app/
    routes/
    components/
    features/
      sessions/
      scheduler/
      instances/
      pairing/
      plugins/
      config/
    lib/
    state/
    api/
  package.json
  tsconfig.json
  vite.config.ts
```

### Responsibilities of the web app

The web app should own:

- session browsing and operator views
- live run streaming
- scheduler UI
- pairing approvals
- instance health UI
- plugin panel host
- config editor

## Step 5: create the shared packages

### `packages/shared-types`

Use this for:

- ids
- DTOs
- event envelopes
- capability types

Keep it small and runtime-light.

### `packages/db`

Use this for:

- Drizzle schema
- migrations
- repositories
- database connection helpers

Suggested first schema groups:

- sessions
- session messages
- session runs
- scheduled jobs
- job runs
- instances
- devices
- pairing requests

### `packages/config`

Use this for:

- config schema
- environment parsing
- secret provider interfaces

### `packages/sdk`

Use this for:

- public client helpers
- API request and response types
- stream event contracts

### `packages/plugin-sdk`

Use this for:

- plugin manifest types
- registration APIs
- permissions and capability contracts
- lifecycle hook contracts

### `packages/ui-sdk`

Use this for:

- panel registration metadata
- frontend bridge types
- panel mount context

### `packages/runtime`

Use this for:

- provider abstraction
- tool execution interfaces
- runtime stream event types

## Step 6: set up the database

Recommended production choice:

- PostgreSQL

For local development, you can either:

- run PostgreSQL locally
- run PostgreSQL through Docker

Suggested first tasks:

- create a connection helper
- configure Drizzle schema files
- generate the first migration
- implement repository helpers for sessions and jobs

## Step 7: set up logging and validation

From the start, use:

- Pino for structured logs
- Zod for request and contract validation

Validate:

- API payloads
- plugin manifests
- config updates
- channel event normalization
- scheduler payloads

## Step 8: decide the realtime model

Recommended split:

### Server-Sent Events

Use SSE for:

- agent text streaming
- run progress deltas
- lightweight live session updates

### WebSocket

Use WebSocket for:

- pairing request notifications
- instance presence updates
- channel health changes
- scheduler updates
- operator live dashboards

This split keeps the agent stream path simple while still supporting live application events.

## Step 9: define the first plugin contracts early

Before building many features, define the first versions of:

- tool plugin manifest
- channel plugin manifest
- UI panel manifest
- permission model

Do not wait until later to decide plugin boundaries. Early plugin contracts prevent the core from becoming too coupled.

## Step 10: build the first vertical slice

The first vertical slice should be small but complete.

Recommended slice:

- create a session
- list sessions
- append a message to a session
- dispatch a fake or simple agent run
- stream output to the UI
- persist the transcript and run state

This gives you:

- working API
- working UI
- shared schemas
- persistence
- realtime updates

before you add more systems.

## Step 11: build the second vertical slice

After the session flow works, build scheduling.

Recommended slice:

- create a scheduled job
- persist it
- run it at the right time
- record job run history
- trigger a dispatch into a session or isolated run

This makes the product immediately more useful and validates the scheduler architecture early.

## Step 12: add instances and pairing

Once sessions and jobs work, add:

- instance registration
- heartbeat updates
- device pairing requests
- approval and rejection flows
- scoped device tokens

This creates the trust and operations model that later supports channel bridges, workers, and operator clients.

## Step 13: add one real channel through the plugin API

Pick one channel and implement it only through public plugin contracts.

Good candidates:

- Telegram
- Discord
- webhook channel

Success criteria:

- inbound messages normalize into session events
- outbound responses are delivered back correctly
- session core does not need channel-specific hacks

## Step 14: add MCP support

Recommended order:

- consume one external MCP server first
- then expose selected platform operations as MCP tools

Start small:

- register MCP server
- discover tools
- invoke tools through a typed adapter

Later:

- expose session listing
- expose dispatch
- expose scheduler actions

## Package summary

### Root dev dependencies

```bash
pnpm add -D typescript tsx vitest eslint prettier @types/node
```

### Server dependencies

```bash
pnpm add fastify @fastify/cors @fastify/websocket @fastify/sensible zod pino nanoid eventemitter3 croner drizzle-orm pg
pnpm add -D drizzle-kit
```

### Web dependencies

```bash
pnpm add solid-js @solidjs/router @tanstack/solid-query zod lucide-solid
pnpm add -D vite vite-plugin-solid tailwindcss
```

## Anti-patterns to avoid at bootstrap time

Avoid these early mistakes:

- building too many channels before sessions are stable
- introducing too many services on day one
- using internal imports instead of public SDKs for plugins
- overcomplicating auth before the pairing model is clear
- making the UI depend on hidden backend runtime state
- overengineering a plugin marketplace before plugin contracts exist

## Recommended first milestone

A good first milestone is:

- monorepo running
- server and web apps booting
- Postgres connected
- one session can be created
- one message can be persisted
- one fake dispatch can stream output
- one basic operator screen can display transcript updates

If you reach that milestone with clean types and clear module boundaries, the rest of the system becomes much easier to build.
