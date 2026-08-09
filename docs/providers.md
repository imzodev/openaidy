---
summary: 'Connecting LLM providers — cloud, local, and custom OpenAI-compatible endpoints'
read_when:
  - You are setting up a provider for your agents to use
title: 'Providers'
---

# Providers

OpenAidy talks to LLMs through a pluggable provider abstraction, so agents aren't locked to a single vendor. Configure providers through **Settings → Providers** in the web UI, via the config file, or with the CLI (`openaidy providers list/connect/disconnect`).

## Supported providers

| Provider      | Type               | Auth                                |
| ------------- | ------------------ | ----------------------------------- |
| OpenAI        | OpenAI-compatible  | API key                             |
| Anthropic     | Anthropic          | API key                             |
| Google Gemini | Gemini             | API key                             |
| Groq          | OpenAI-compatible  | API key                             |
| DeepSeek      | OpenAI-compatible  | API key                             |
| MiniMax       | OpenAI-compatible  | API key                             |
| OpenCode Go   | OpenAI / Anthropic | API key                             |
| Ollama        | OpenAI-compatible  | none — local (`localhost:11434/v1`) |
| LM Studio     | OpenAI-compatible  | none — local (`localhost:1234/v1`)  |

This is bring-your-own-key (BYOK): OpenAidy never bills you for model usage — you connect your own account and OpenAidy calls it directly.

## Local providers (Ollama, LM Studio)

Local providers ignore the `Authorization` header entirely. OpenAidy's UI skips the credential dialog for a local preset, and can auto-discover installed models by probing the local server (click **Discover models** in the provider modal).

Before connecting one, make sure the local server is running with at least one model loaded:

```bash
# Ollama — https://ollama.com
ollama serve
ollama pull llama3.2

# LM Studio — https://lmstudio.ai
# Start the local server from the LM Studio "Developer" tab (default port 1234).
```

Then: **Settings → Providers → Ollama (or LM Studio) → Discover models → Save**. Running on a non-default port or behind a tunnel? Use **Add Custom** instead with your full base URL.

## Custom providers

Any OpenAI-compatible, Anthropic, or Gemini-compatible endpoint can be added through **Add Custom** — provide an ID, display name, base URL, and (optionally) the name of an environment variable holding the API key.

## Per-model pricing overrides

If a model's built-in pricing is missing or out of date, you can override it per model ID in the config — see [Configuration](./config.md) — so the cost shown on the [Usage](./usage.md) page stays accurate.

## Related

- [Agents](./agents.md) — each agent/session picks a provider + model to run against
- [Configuration](./config.md) — where the default provider/model is set
