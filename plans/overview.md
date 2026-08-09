---
summary: 'Product overview for OpenAidy'
read_when:
  - You want a high-level explanation of what OpenAidy is
  - You need a product-facing summary of its purpose, features, and design goals
  - You want onboarding material before reading architecture or implementation docs
title: 'What is OpenAidy'
---

# What is OpenAidy

OpenAidy is a plugin-first AI operations platform for running agents, orchestrating automated work, connecting messaging channels, and extending both the backend and UI through stable public APIs.

At a high level, OpenAidy is designed to help individuals and teams:

- run AI agents in persistent sessions
- schedule and automate agent work
- connect agents to messaging channels and external systems
- manage trusted devices and runtime instances
- extend the platform with plugins, custom tools, UI panels, and integrations
- connect to MCP servers and expose selected platform capabilities through MCP

The goal is to provide a practical set of agent-platform capabilities while making the system easier to extend, easier to reason about, and less tightly coupled internally.

## What problem it solves

Many agent platforms are either:

- good at chat, but weak at automation
- good at automation, but weak at real-time operator workflows
- good for one internal product team, but hard to extend safely

OpenAidy is intended to solve that by combining:

- real-time session management
- scheduled and event-driven agent execution
- channel integrations
- device and runtime pairing
- plugin-based extensibility
- MCP interoperability

in one platform with explicit contracts.

## Core idea

OpenAidy should be a small, stable orchestration core with a large extension surface.

The core is responsible for:

- authentication and authorization
- session lifecycle
- scheduler and dispatch
- pairing and trusted devices
- instance presence
- configuration
- plugin lifecycle
- MCP integration

Extensions are responsible for:

- channels
- tools
- provider adapters
- UI panels
- automation triggers and actions
- specialized dashboards

This keeps the product flexible without requiring plugins to rely on private implementation details.

## Main capabilities

## Real-time Communication

OpenAidy provides a WebSocket gateway for real-time, bidirectional communication:

- **Instant messaging** - Real-time message delivery without polling
- **Streaming responses** - Token-by-token streaming of AI responses
- **Event subscriptions** - Subscribe to session, agent, node, and presence events
- **Low latency** - Persistent connections eliminate HTTP overhead
- **Automatic reconnection** - Robust handling of connection drops

For details, see [WebSocket Protocol](./websocket-protocol) and [WebSocket Client SDK](./websocket-client-sdk).

## Sessions

Sessions are the main container for conversations, agent runs, and transcripts.

OpenAidy should support:

- creating and managing persistent sessions
- storing transcript history and artifacts
- linking sessions to channels, jobs, or external triggers
- resuming context over time
- streaming live agent output to the operator UI

## Agent dispatch

Agents should be dispatchable manually or automatically.

OpenAidy should support:

- manual dispatch from the UI or API
- dispatch into an existing session
- isolated runs for scheduled jobs or webhook triggers
- provider-agnostic execution through runtime adapters

## Scheduler and cron

OpenAidy should support recurring and one-off automation.

Examples:

- daily summaries
- periodic checks
- delayed reminders
- background maintenance runs
- event-triggered workflows

The scheduler should support:

- cron expressions
- one-shot jobs
- retries
- delivery policies
- run history

## Channels

OpenAidy should connect agents to messaging platforms through channel plugins.

Examples:

- Telegram
- Discord
- Slack
- WhatsApp
- email
- webhooks
- internal chat surfaces

The platform should normalize inbound and outbound messaging while keeping channel-specific behavior inside plugins.

## Instances and runtime presence

OpenAidy should track connected runtimes and operator clients as instances.

Examples:

- operator dashboards
- worker nodes
- channel bridge runtimes
- local agent runtimes

This should make it possible to:

- see what is online
- route work to compatible runtimes
- debug operational state
- manage capability-aware dispatch

## Device pairing

OpenAidy should include a trust and pairing system for browsers, workers, and connected runtimes.

This should support:

- pairing requests
- approvals and rejections
- scoped device tokens
- token rotation and revoke flows
- operator visibility into trusted devices

## Configuration

OpenAidy should make configuration easy to understand and safe to change.

It should support:

- typed config schemas
- plugin-defined config sections
- validation before apply
- secrets separation
- UI and API-based config management

## Plugin system

The plugin system is a central feature of OpenAidy.

Plugin types should include:

- channel plugins
- tool plugins
- UI plugins
- automation plugins
- provider plugins

The plugin model should emphasize:

- stable SDK contracts
- explicit permissions
- narrow host contexts
- versioned manifests
- optional isolation for third-party plugins

## MCP integration

OpenAidy should treat MCP as a first-class interoperability layer.

It should support:

- using MCP servers as external tool and resource providers
- exposing selected OpenAidy operations as MCP tools
- mapping MCP tools into agent workflows
- combining plugin and MCP-based integrations cleanly

## Key product principles

### Plugin-first design

Extensions should integrate through stable contracts, not private module imports.

### Real operational workflows

The product should work well for ongoing operations, not just one-off prompts.

### Strong typing and explicit contracts

Contracts should be typed and validated across API, plugin, config, and runtime boundaries.

### Boring core, flexible edges

The central services should be small and reliable. Product flexibility should come from plugins and well-defined public APIs.

### Security by capability

Permissions for plugins, devices, and runtimes should be explicit, inspectable, and enforceable.

## Example use cases

### Personal operator workspace

A single user runs agents from a web UI, schedules recurring jobs, and connects a messaging channel for alerts and conversational control.

### Team operations dashboard

A small team uses OpenAidy to monitor sessions, review scheduled tasks, pair trusted devices, and extend the dashboard with custom internal panels.

### Channel-driven automation

A business connects one or more messaging channels so incoming messages can create or resume sessions and trigger agent workflows.

### Extensible AI platform

Developers build plugins for custom tools, provider adapters, and dashboards without needing to fork the core platform.

### MCP-enabled control plane

OpenAidy consumes external MCP servers for tools and resources while also exposing selected platform operations to other MCP-capable environments.

## Intended audience

OpenAidy is aimed at:

- individual operators running personal AI workflows
- teams building internal AI operations tooling
- developers creating plugins and integrations
- organizations that want agent orchestration with a flexible extension model

## Why Node.js and TypeScript

OpenAidy is intended to use Node.js and TypeScript because they provide a good balance of:

- runtime performance for orchestration and real-time systems
- strong compatibility with AI SDKs and web tooling
- shared contracts across frontend, backend, and plugin SDKs
- fast iteration for product and platform development

## Summary

OpenAidy is intended to be an extensible agent platform with:

- persistent sessions
- agent dispatch
- scheduler and cron jobs
- channels
- instances and presence
- device pairing
- easy configuration
- plugin SDKs
- MCP integration
- **real-time WebSocket communication**

The main differentiator is that these capabilities should be built around public contracts and extension points from the start, rather than added through tightly coupled internal mechanisms.
