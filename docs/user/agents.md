---
summary: 'How agents work in OpenAidy — dispatch, providers, sessions, and streaming'
read_when:
  - You want to understand how OpenAidy runs AI agents
  - You are setting up your first agent or choosing a model provider
  - You want to know how to send messages and get streaming responses
title: 'Agents'
---

# Agents

An agent in OpenAidy is a language model-powered process that runs inside a session. Agents receive messages, produce responses, and can be connected to channels so they reply to real conversations automatically.

## How agents relate to sessions

Sessions are the conversation container. An agent is the runtime that powers a session.

When you send a message to a session, OpenAidy dispatches an agent run — the agent reads the message history, generates a response, and the response is appended to the transcript.

You can have multiple sessions, each using the same or a different agent configuration. The agent is selected per-session or per-dispatch, not globally.

## Provider adapters

OpenAidy is provider-agnostic. It talks to AI providers through typed adapter contracts, so you can swap models or providers without changing session logic.

Supported provider patterns:

- OpenAI-compatible API endpoints
- Anthropic API
- Local models via llama.cpp or similar

Each provider adapter handles:

- credential management
- request construction
- streaming response parsing
- error normalization

## Sending a message

You can send a message to a session through the web UI or the REST API:

```
POST /api/sessions/:sessionId/messages
{ "role": "user", "content": "your message here" }
```

The API returns immediately. For streaming responses, subscribe to the session's event stream — tokens arrive in real time as they are generated.

## Streaming responses

OpenAidy streams agent output token by token over Server-Sent Events (SSE) or WebSocket. This lets you display responses as they are generated, just like ChatGPT.

To receive streaming events:

1. Open an SSE connection to the session's stream endpoint
2. Subscribe to `run.delta` events for token deltas
3. Subscribe to `run.complete` events when the agent finishes

The stream delivers plain text tokens. The UI is responsible for rendering them as they arrive.

## Dispatch modes

### Interactive dispatch

You send a message and wait for the agent to respond. The session is ongoing — the full transcript is available to the agent on every turn. Use this for chatbots, operator conversations, and channel-bound replies.

### Isolated dispatch

The agent runs without an ongoing session context. The job scheduler uses this mode to execute background tasks, cron jobs, and webhook-triggered workflows. Results are delivered to a session, a channel, or a webhook endpoint.

## Agent configuration

Each session or dispatch call can specify:

- `agentId` — which agent profile to use (determines the system prompt and provider)
- `model` — optionally override the model for this run
- `temperature` — control response randomness
- `maxTokens` — cap response length

## Skills

Skills are reusable system-prompt fragments attached to agents. They let you give an agent persistent instructions without modifying the core prompt.

Bundled skills are seeded automatically from `config/skills/` on first startup. Custom skills live in `OPENAIDY_HOME/skills/` and override bundled skills of the same name.

To create a custom skill, add a directory with a `SKILL.md` file:

```
.openaidy/skills/my-skill/SKILL.md
```

The file needs YAML frontmatter with `name`, `description`, and `version`, followed by the skill instructions.

## Monitoring runs

You can monitor active runs through the web UI or the instance registry. Each run records:

- start and end timestamps
- token usage
- model and provider
- status (running, complete, failed)

Run history is persisted so you can review past agent activity even after the server restarts.

## Intended outcome

After reading this, you should understand how agents are dispatched, how streaming works, and how to configure an agent for a session or a scheduled job.
