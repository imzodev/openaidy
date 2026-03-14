---
summary: "Landing page for OpenAidy project documentation"
read_when:
  - You want an overview of the OpenAidy docs set
  - You are starting work on the project and want to know where to begin
title: "OpenAidy Docs"
---

# OpenAidy Docs

This section collects the planning and foundation documents for OpenAidy.

Use these docs to move from product idea to implementation foundation.

## Start here

- [What is OpenAidy](./overview) — product overview, goals, capabilities, and target users.
- [Bootstrapping OpenAidy](./bootstrapping) — practical setup guide for the initial repository, stack, packages, and first vertical slice.
- [Bootstrap Checklist](./bootstrap-checklist) — short execution checklist for setting up the initial foundation.

## Architecture and planning

- [OpenAidy Architecture](./architecture) — core services, subsystem boundaries, data flow, event model, and security model.
- [OpenAidy MVP Roadmap](./mvp-roadmap) — phased implementation plan for reaching a practical MVP.
- [OpenAidy Data Model](./data-model) — recommended relational schema and persistence boundaries.

## Extension model

- [OpenAidy Plugin SDK](./plugin-sdk) — public plugin contracts, permissions, manifests, and lifecycle design.
- [OpenAidy API Design](./api-design) — suggested API surface for sessions, scheduler, channels, pairing, config, plugins, and MCP.

## Recommended reading order

If you are just starting:

1. Read [What is OpenAidy](./overview).
2. Read [OpenAidy Architecture](./architecture).
3. Read [Bootstrapping OpenAidy](./bootstrapping).
4. Use [Bootstrap Checklist](./bootstrap-checklist) while creating the repo.
5. Use [OpenAidy MVP Roadmap](./mvp-roadmap) to sequence implementation.
6. Refer to [OpenAidy Data Model](./data-model), [OpenAidy Plugin SDK](./plugin-sdk), and [OpenAidy API Design](./api-design) as implementation references.

## Intended outcome

After reading this section, you should be able to:

- explain what OpenAidy is and what it should do
- choose the initial technical foundation
- set up the repository and packages
- implement the first working vertical slice
- preserve a plugin-first architecture from the start
