---
summary: "Short execution checklist for bootstrapping OpenAidy"
read_when:
  - You want a concise checklist version of the bootstrap guide
  - You are setting up the initial OpenAidy repository and want a practical sequence
title: "OpenAidy Bootstrap Checklist"
---

# OpenAidy Bootstrap Checklist

Use this checklist while setting up the first version of the project.

## Repository foundation

- Create the repository root.
- Initialize `pnpm-workspace.yaml`.
- Add root `package.json` scripts for `dev`, `build`, `test`, `lint`, and `format`.
- Add `tsconfig.base.json` with strict TypeScript settings.
- Create top-level folders:
  - `apps/`
  - `packages/`
  - `plugins/`
  - `docs/`
  - `scripts/`

## Tooling

- Install root development dependencies:
  - `typescript`
  - `tsx`
  - `vitest`
  - `eslint`
  - `prettier`
  - `@types/node`
- Decide whether Turborepo is needed later.

## Server app

- Create `apps/server`.
- Install server dependencies:
  - `fastify`
  - `@fastify/cors`
  - `@fastify/websocket`
  - `@fastify/sensible`
  - `zod`
  - `pino`
  - `nanoid`
  - `eventemitter3`
  - `croner`
  - `drizzle-orm`
  - `pg`
- Install `drizzle-kit` as a dev dependency.
- Create the initial server structure:
  - `src/app.ts`
  - `src/server.ts`
  - `src/routes/`
  - `src/sessions/`
  - `src/dispatch/`
  - `src/scheduler/`
  - `src/instances/`
  - `src/pairing/`
  - `src/plugins/`
  - `src/mcp/`

## Web app

- Create `apps/web`.
- Install web dependencies:
  - `solid-js`
  - `@solidjs/router`
  - `@tanstack/solid-query`
  - `zod`
  - `lucide-solid`
- Install web dev dependencies:
  - `vite`
  - `vite-plugin-solid`
  - `tailwindcss`
- Add the initial web structure:
  - `src/app/`
  - `src/routes/`
  - `src/components/`
  - `src/features/sessions/`
  - `src/features/scheduler/`
  - `src/features/instances/`
  - `src/features/pairing/`
  - `src/features/plugins/`
  - `src/features/config/`

## Shared packages

- Create `packages/shared-types`.
- Create `packages/db`.
- Create `packages/config`.
- Create `packages/sdk`.
- Create `packages/plugin-sdk`.
- Create `packages/ui-sdk`.
- Create `packages/runtime`.

## Database

- Start PostgreSQL locally.
- Add database connection configuration.
- Create the first Drizzle schema files.
- Generate the first migration.
- Confirm migrations run locally.

## First schema groups

- Sessions
- Session messages
- Session runs
- Scheduled jobs
- Job runs
- Instances
- Devices
- Pairing requests

## Core contracts

- Define IDs and shared DTOs in `packages/shared-types`.
- Define API request and response schemas with `zod`.
- Define initial stream event envelope shapes.
- Define the first plugin manifest shape.
- Define the first capability model.

## Realtime

- Add SSE endpoint for agent output streaming.
- Add WebSocket support for application events.
- Define initial live event types for:
  - session updates
  - job updates
  - instance presence
  - pairing requests

## First vertical slice

- Create a session.
- List sessions.
- Append a message to a session.
- Dispatch a simple or fake agent run.
- Stream output to the UI.
- Persist transcript entries and run state.

## Second vertical slice

- Create a scheduled job.
- Persist it.
- Execute it at the right time.
- Record run history.
- Trigger dispatch into a session or isolated run.

## Architectural guardrails

- Keep plugin contracts public and typed.
- Do not let plugins import private core internals.
- Keep session state append-only where possible.
- Separate control-plane logic from heavy worker logic.
- Keep UI integration framework-aware but bridge contracts framework-agnostic.
- Avoid adding many channels before sessions and scheduler are stable.

## Bootstrap done when

You can consider bootstrap complete when:

- the monorepo builds
- server and web apps boot successfully
- the database migrates locally
- one session can be created and viewed
- one message can be appended and persisted
- one simple dispatch can stream output
- the first shared contracts are stable enough for plugin-facing APIs
