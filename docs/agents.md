---
summary: 'How agents work in Aidy — dispatch, providers, sessions, and streaming'
read_when:
  - You want to understand how Aidy runs AI agents
  - You are setting up your first agent or choosing a model provider
  - You want to know how to send messages and get streaming responses
title: 'Agents'
---

# Agents

An agent in Aidy is a language model-powered process that runs inside a session. Agents receive messages, produce responses, and can be connected to channels so they reply to real conversations automatically.

## How agents relate to sessions

Sessions are the conversation container. An agent is the runtime that powers a session.

When you send a message to a session, Aidy dispatches an agent run — the agent reads the message history, generates a response, and the response is appended to the transcript.

You can have multiple sessions, each using the same or a different agent configuration. The agent is selected per-session or per-dispatch, not globally.

## Provider adapters

Aidy is provider-agnostic. It talks to AI providers through typed adapter contracts, so you can swap models or providers without changing session logic.

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

Aidy streams agent output token by token over a WebSocket connection. This lets you display responses as they are generated, just like ChatGPT — it's how the web UI itself renders every reply.

To receive streaming events:

1. Open a WebSocket connection to the server
2. Subscribe to `run.delta` events for token deltas
3. Subscribe to `run.completed` events when the agent finishes

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
- `reasoningEffort` — how hard the model thinks (see below)

## Thinking effort

How hard the model thinks before answering: **Auto** (the model's own default), **Off**, **Low**, **Medium**, **High** or **Max**.

- **Per agent:** the agent's detail panel on the Agents page has a **Thinking** setting (`reasoningEffort` in the agent's config). Pulses, reminders and workflows run with it too.
- **Per conversation:** the brain button next to the agent picker in the chat overrides it for that conversation (remembered in the browser). On mobile it's icon-only.

Only models whose thinking control is documented show the setting, and each shows only the levels it accepts. A level the model lacks moves to the closest one (DeepSeek has no Medium, so it uses High). Other models get nothing sent, so a parameter they'd reject can never break a chat.

| Models | What is sent |
| --- | --- |
| DeepSeek V4, `deepseek-reasoner` (direct or through a gateway such as OpenCode Go) | `thinking.type` (`disabled` for Off) + `reasoning_effort` (`low` / `high` / `max`) |
| OpenAI o-series | `reasoning_effort` (`low` / `medium` / `high`) |
| Gemini 2.5 | `thinkingConfig.thinkingBudget` (0 for Off on Flash; Pro can't turn thinking off) |
| Gemini 3 | `thinkingConfig.thinkingLevel` (`low` / `high`) |
| Claude 4.6+ and 5.x | `output_config.effort`. Thinking itself isn't turned on yet, so this tunes depth and token spend |

Other families (MiMo, GLM, Kimi, Qwen, MiniMax) are left out until their parameters are confirmed; they're added in `REASONING_MODEL_RULES` (`packages/shared-types/src/reasoning.ts`).

## Skills

Skills are reusable system-prompt fragments attached to agents. They let you give an agent persistent instructions without modifying the core prompt.

Bundled skills are seeded automatically from `config/skills/` on first startup. Custom skills live in `AIDY_HOME/skills/` and override bundled skills of the same name.

To create a custom skill, add a directory with a `SKILL.md` file:

```
.aidy/skills/my-skill/SKILL.md
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
