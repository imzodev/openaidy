---
summary: 'OpenAidy documentation index'
read_when:
  - You are new to OpenAidy or looking for a specific topic
title: 'OpenAidy Docs'
---

# OpenAidy Docs

OpenAidy is a self-hosted AI agent platform — persistent sessions with streaming responses, structured multi-step tasks, scheduled automation, real messaging channels, and a plugin system, all running on one server you control.

New here? Start with [Getting Started](./getting-started.md).

## Core concepts

- [Agents](./agents.md) — how agents are dispatched, streamed, and configured
- [Sessions](./sessions.md) — the conversation model: types, status, runs
- [Providers](./providers.md) — connecting LLMs, cloud and local
- [Memories](./memories.md) — explicit, persistent recall across sessions
- [Skills](./skills.md) — reusable system-prompt fragments ([creating your own](./creating-skills.md))
- [Workspace](./workspace.md) — per-agent file access

## Automation

- [Tasks](./tasks.md) — multi-step work with a kanban board and a visual workflow graph (conditional branches, loops, approval gates)
- [Task Schedules](./task-schedules.md) — run a task automatically, recurring or one-shot
- [Pulses](./pulses.md) — a lighter-weight scheduled prompt, for when a full task is overkill

## Connecting the outside world

- [Channels](./channels.md) — WhatsApp and Discord, so agents can handle real conversations
- [MCP Servers](./mcp-servers.md) — give agents tools from external MCP servers
- [Addons](./addons/README.md) — build or install a mini-app inside OpenAidy, with its own [permission model](./addons/addon-permissions.md)

## Operating OpenAidy

- [Configuration](./config.md) — `openaidy.json`, the Settings UI, execution tuning
- [Access Tokens & Device Pairing](./access-tokens.md) — API credentials and approving new devices
- [Usage](./usage.md) — token and cost tracking
- [CLI Reference](./cli/README.md) — every `openaidy` command, install and bootstrap-admin guides
