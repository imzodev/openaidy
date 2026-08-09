---
summary: 'openaidy.json, the Settings UI tabs, and the execution tuning knobs'
read_when:
  - You want to change defaults, tune retry/context limits, or edit the raw config
title: 'Configuration'
---

# Configuration

OpenAidy's configuration lives in one file — `openaidy.json`, under your `OPENAIDY_HOME` directory (`~/.openaidy` by default). You can edit it through **Settings** in the web UI, or directly as JSON.

## Settings tabs

| Tab           | What it configures                                                                       |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Defaults**  | The default provider, model, and agent used when none is specified                       |
| **Providers** | Connected LLM providers — see [Providers](./providers.md)                                |
| **Agents**    | Agent profiles — system prompt, model, tools, skills, MCP servers, workspace permissions |
| **Execution** | Subtask retry and dependency-context limits — see below                                  |
| **About**     | Version info and update checks                                                           |
| **Raw JSON**  | Direct view/edit of the full config file                                                 |

## Execution tuning

The **Execution** tab controls two things that affect how [tasks](./tasks.md) run:

- **Max retries** — how many times a failed subtask retries before it's marked failed outright. Raise this for flaky subtasks (e.g. ones depending on an unreliable external tool); lower it for subtasks that should fail fast instead of retrying a deterministic failure.
- **Dependency-context limits** — a per-dependency cap and a combined total cap, in characters, on how much of a completed dependency subtask's result gets carried into the next subtask's prompt. If a downstream subtask needs more of the source material from an upstream one (a long research result feeding a drafting step, for example), raise these; the defaults exist so a single large result can't unboundedly grow the next prompt.

Changes here take effect on the next subtask run — no restart needed.

## Channels and MCP servers

Configured [channels](./channels.md) and [MCP servers](./mcp-servers.md) also live in `openaidy.json`, but are managed from their own pages (Channels, MCP) rather than Settings.

## Per-model pricing overrides

If a model's built-in cost-per-token reference is missing or wrong, you can add an override keyed by model ID directly in the raw config — this feeds the cost numbers on the [Usage](./usage.md) page.

## Editing the raw file

Everything above is stored the same way whether you use a tab or the Raw JSON view — there's no hidden state. If you edit `openaidy.json` directly on disk instead of through the UI, restart the server (or reload config) to pick up the change.
