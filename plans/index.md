---
summary: 'Landing page for Aidy project documentation'
read_when:
  - You want an overview of the Aidy docs set
  - You are starting work on the project and want to know where to begin
title: 'Aidy Docs'
---

# Aidy Docs

This section collects the planning and foundation documents for Aidy.

Use these docs to move from product idea to implementation foundation.

## Start here

- [What is Aidy](./overview) — product overview, goals, capabilities, and target users.
- [Bootstrapping Aidy](./bootstrapping) — practical setup guide for the initial repository, stack, packages, and first vertical slice.
- [Bootstrap Checklist](./bootstrap-checklist) — short execution checklist for setting up the initial foundation.

## Architecture and planning

- [Aidy Architecture](./architecture) — core services, subsystem boundaries, data flow, event model, and security model.
- [Aidy Data Model](./data-model) — recommended relational schema and persistence boundaries.

## Extension model

- [Aidy Plugin SDK](./plugin-sdk) — public plugin contracts, permissions, manifests, and lifecycle design.
- [Aidy API Design](./api-design) — suggested API surface for sessions, scheduler, channels, pairing, config, plugins, and MCP.

## WebSocket Control Plane

Real-time communication layer for Aidy:

- [WebSocket Protocol](./websocket-protocol) — complete protocol reference, message types, examples, and best practices.
- [WebSocket Client SDK](./websocket-client-sdk) — TypeScript client SDK API reference and usage examples.
- [WebSocket Integration Guide](./websocket-integration-guide) — integration patterns for web, mobile, CLI, and services.
- [WebSocket Architecture](./websocket-architecture) — component architecture, data flows, and design decisions.

## Recommended reading order

If you are just starting:

1. Read [What is Aidy](./overview).
2. Read [Aidy Architecture](./architecture).
3. Read [Bootstrapping Aidy](./bootstrapping).
4. Use [Bootstrap Checklist](./bootstrap-checklist) while creating the repo.
5. Refer to [Aidy Data Model](./data-model), [Aidy Plugin SDK](./plugin-sdk), and [Aidy API Design](./api-design) as implementation references.

## Intended outcome

After reading this section, you should be able to:

- explain what Aidy is and what it should do
- choose the initial technical foundation
- set up the repository and packages
- implement the first working vertical slice
- preserve a plugin-first architecture from the start
