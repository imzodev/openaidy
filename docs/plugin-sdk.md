---
summary: "Suggested plugin SDK contracts for OpenAidy"
read_when:
  - You are designing the public extension APIs for OpenAidy
  - You want stable plugin contracts for channels, tools, UI, and automations
title: "OpenAidy Plugin SDK"
---

# OpenAidy Plugin SDK

OpenAidy should expose a public SDK that allows third parties to build plugins without depending on private implementation details.

## Design rules

- Plugins register capabilities through public APIs.
- Plugins declare permissions explicitly.
- Plugin manifests are validated before load.
- Plugin lifecycle events are predictable.
- Plugins receive scoped context objects, not direct access to internal containers.

## Plugin categories

OpenAidy should support at least these plugin categories:

- channel plugins
- tool plugins
- UI plugins
- automation plugins
- provider plugins

A single plugin may expose more than one category if the manifest and capabilities allow it.

## Manifest shape

Suggested manifest fields:

- `id`
- `name`
- `version`
- `description`
- `author`
- `runtime`
- `entry`
- `categories`
- `permissions`
- `configSchema`
- `uiPanels`
- `channels`
- `tools`
- `automations`
- `providers`

## Permission model

Examples of plugin permissions:

- `sessions.read`
- `sessions.write`
- `dispatch.run`
- `channels.send`
- `jobs.schedule`
- `config.read`
- `config.write`
- `mcp.use`
- `http.fetch`
- `secrets.read`

The host should grant permissions explicitly and make them visible in the operator UI.

## Lifecycle hooks

Suggested lifecycle hooks:

- `onInstall`
- `onEnable`
- `onDisable`
- `onUpgrade`
- `onUnload`

These hooks should receive a narrow context and should not be required for simple plugins.

## Registration API

Suggested registration surface:

- `definePlugin()`
- `registerTool()`
- `registerChannel()`
- `registerPanel()`
- `registerAutomation()`
- `registerProvider()`

## Host context

Suggested host context capabilities:

- logger
- typed event emitter
- config access for that plugin
- scoped secret access
- session client
- dispatch client
- scheduler client
- channel delivery client
- MCP client access if permitted

## Tool plugin contract

A tool plugin should define:

- tool id
- display metadata
- input schema
- output schema
- execute function
- optional streaming support

The core should validate inputs and outputs using shared schemas.

## Channel plugin contract

A channel plugin should define:

- channel id
- account config schema
- inbound event normalizer
- outbound send function
- health check function
- optional pairing or login hooks

The core should handle session resolution and dispatch, not the channel plugin.

## UI plugin contract

UI plugins should register panels, not arbitrary code entry points with hidden assumptions.

Suggested UI panel metadata:

- panel id
- title
- route or mount key
- required permissions
- frontend bundle reference
- bridge contract version

Recommended modes:

- trusted internal panel mode
- sandboxed third-party panel mode

## Automation plugin contract

Automation plugins should define triggers and actions through supported contracts.

Examples:

- webhook trigger
- timer trigger
- channel event trigger
- session event trigger

## Provider plugin contract

Provider plugins should implement a stable inference interface.

Suggested methods:

- `listModels`
- `runText`
- `runStructured`
- `streamText`
- `embed`

This should allow the core runtime to remain provider-agnostic.

## Plugin isolation

Recommended options:

- trusted first-party plugins may run in-process during early development
- third-party plugins should run in worker threads or subprocesses

The SDK should not assume in-process execution even if the first implementation uses it.

## Versioning policy

The SDK should publish a compatibility contract.

Recommendations:

- semantic versioning for public SDK packages
- manifest `apiVersion`
- host-side compatibility checks before plugin load

## Contract testing

Plugin authors should have a contract test harness.

Recommended test helpers:

- fake host context
- manifest validation tests
- permission simulation
- sample event fixtures
- channel round-trip tests

## Example authoring flow

1. Create a plugin package.
2. Declare a manifest.
3. Register tools, channels, or panels with public APIs.
4. Validate config schema.
5. Run contract tests.
6. Install and enable in a local OpenAidy development environment.

## Anti-patterns

Avoid these patterns:

- plugins importing private core files
- plugins mutating global host state directly
- plugins assuming a specific transport or storage engine
- plugins bypassing permission checks through hidden host references
