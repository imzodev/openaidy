<p align="center">
  <img src="./docs/assets/banner.png" alt="OpenAidy" width="892" />
</p>

# OpenAidy — OpenAI Do-it Yourself

A plugin-first AI operations platform for running agents, orchestrating automated work, connecting messaging channels, and extending both the backend and UI through stable public APIs.

## What it does

- Run AI agents in persistent sessions with real-time streaming
- Schedule and automate agent work with cron and one-shot jobs
- Connect agents to messaging channels and external systems
- Manage trusted devices and runtime instances through a pairing system
- Extend the platform with plugins, custom tools, UI panels, and integrations
- Connect to any MCP server and expose platform capabilities through MCP

## Repository layout

```
openaidy/
  apps/
    server/       # Fastify REST + WebSocket API
    web/          # SolidJS operator UI
  packages/
    cli/          # CLI tooling
    config/       # Config schema and loaders
    db/           # Drizzle ORM schema, migrations, repositories
    runtime/      # Agent runtime and provider abstraction
    sdk/          # Public client SDK
    plugin-sdk/   # Public plugin registration API
    ui-sdk/       # Public UI panel contracts
    shared-types/ # Shared TypeScript contracts (DTOs, events, IDs)
  config/
    skills/       # Bundled default skills seeded on first run
  docs/           # Architecture and design documentation
  plugins/        # First-party and example plugins
```

## Prerequisites

- [Node.js](https://nodejs.org) v20+
- [pnpm](https://pnpm.io) v10+
- PostgreSQL (optional — SQLite is used by default)

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/imzodev/openaidy.git
   cd openaidy
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Configure environment variables**

   Copy the example env file and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Key variables:

   | Variable          | Default                   | Description                              |
   | ----------------- | ------------------------- | ---------------------------------------- |
   | `PORT`            | `3001`                    | HTTP server port                         |
   | `CORS_ORIGIN`     | `http://localhost:5173`   | Allowed CORS origin                      |
   | `DB_KIND`         | `sqlite`                  | Database backend: `sqlite` or `postgres` |
   | `DATABASE_URL`    | —                         | Required when `DB_KIND=postgres`         |
   | `SQLITE_PATH`     | `./data/openaidy.db`      | SQLite file path                         |
   | `OPENAIDY_HOME`   | `.openaidy/`              | Base directory for user data             |
   | `WS_TOKEN_SECRET` | `change-me-in-production` | **Change this in production**            |

4. **Run the development server**

   ```bash
   pnpm dev
   ```

   This starts both the API server (`http://localhost:3001`) and the web UI (`http://localhost:5173`) in parallel with hot reload.

   To run them separately:

   ```bash
   pnpm dev:server   # API only
   pnpm dev:web      # UI only
   ```

## Available scripts

| Command           | Description                       |
| ----------------- | --------------------------------- |
| `pnpm dev`        | Start server + web UI in parallel |
| `pnpm dev:server` | Start API server only             |
| `pnpm dev:web`    | Start web UI only                 |
| `pnpm build`      | Build all packages and apps       |
| `pnpm test`       | Run all tests                     |
| `pnpm lint`       | Lint all packages                 |
| `pnpm format`     | Format all files with Prettier    |

## Providers

OpenAidy talks to LLMs through a pluggable `Provider` abstraction. Configure providers through the UI (Settings → Providers) or via the config file. Presets ship in `packages/shared-types/src/providers-preset.ts`:

| Provider      | Type               | Auth                                    |
| ------------- | ------------------ | --------------------------------------- |
| OpenAI        | OpenAI-compatible  | API key                                 |
| Anthropic     | Anthropic          | API key                                 |
| Google Gemini | Gemini             | API key                                 |
| Groq          | OpenAI-compatible  | API key                                 |
| DeepSeek      | OpenAI-compatible  | API key                                 |
| MiniMax       | OpenAI-compatible  | API key                                 |
| OpenCode Go   | OpenAI / Anthropic | API key                                 |
| Ollama        | OpenAI-compatible  | **none — local** (`localhost:11434/v1`) |
| LM Studio     | OpenAI-compatible  | **none — local** (`localhost:1234/v1`)  |

### Local providers (Ollama, LM Studio)

Local providers expose an OpenAI-compatible endpoint on `localhost` and ignore the `Authorization` header. OpenAidy's UI:

- Skips the credential dialog when you pick a local preset card.
- Auto-discovers installed/loaded models by probing `{baseUrl}/models` (click **Discover models** in the provider modal).
- Sends a placeholder `Bearer` header that the local server ignores.

Before configuring, make sure the local server is running and has at least one model loaded:

```bash
# Ollama — https://ollama.com
ollama serve                # default port 11434
ollama pull llama3.2        # pull a model into the local store

# LM Studio — https://lmstudio.ai
# Start the local server from the LM Studio "Developer" tab (default port 1234).
```

Then in OpenAidy: **Settings → Providers → Ollama (or LM Studio) → Discover models → Save**.

If you run a local server on a non-default port or behind a tunnel, use **Add Custom** with `vendorFamily: openai-compatible` and your full base URL (e.g. `http://localhost:11435/v1`).

### Custom providers

Any OpenAI-compatible, Anthropic, or Gemini endpoint can be added through the **Add Custom** dialog in Settings → Providers. Provide a unique ID, display name, base URL, and (optionally) the name of an env var holding the API key.

## Skills

Skills are reusable system-prompt instructions attached to agents. Bundled skills from `config/skills/` are automatically seeded to `OPENAIDY_HOME/skills/` on server startup.

**Update policy:**

- If you have not modified a skill, app updates will propagate automatically when a newer version ships.
- If you have modified a skill locally, your changes are always preserved regardless of app updates.

To create a custom skill, add a directory under `OPENAIDY_HOME/skills/` with a `SKILL.md` file:

```
.openaidy/skills/my-skill/SKILL.md
```

```markdown
---
name: My Skill
description: What this skill does
version: 1.0.0
---

Your skill instructions here.
```

## MCP integration

OpenAidy connects to external MCP servers via stdio or HTTP transport. Configure servers through the UI or the REST API at `POST /api/mcp/servers`.

### Preinstalled servers

The following MCP servers ship preinstalled (reconciled into every install on startup from `config/openaidy.template.json`):

| Server              | Transport | Auth                              | Notes                                                                                                          |
| ------------------- | --------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GitHub              | http      | `${GITHUB_PERSONAL_ACCESS_TOKEN}` | [PAT](https://github.com/settings/tokens) with `repo` + `read:user` scopes                                     |
| Sequential Thinking | stdio     | none                              | step-by-step reasoning                                                                                         |
| Time                | stdio     | none                              | time + timezone conversion (`@guanxiong/mcp-server-time`)                                                      |
| Playwright Browser  | stdio     | none                              | Microsoft-maintained browser automation                                                                        |
| Context7 Docs       | http      | optional                          | [free tier](https://context7.com/dashboard) works without a key; higher rate limits with `${CONTEXT7_API_KEY}` |
| Brave Search        | stdio     | `${BRAVE_API_KEY}`                | [free tier](https://brave.com/search/api/) (~2000 req/month)                                                   |
| Tavily Search       | stdio     | `${TAVILY_API_KEY}`               | [free tier](https://tavily.com/)                                                                               |

#### Setting API keys

Servers that require a secret reference it as `${VAR_NAME}` in `headers` (http) or `env` (stdio). Two ways to satisfy:

1. **Set the env var before starting the server** — recommended. Secrets stay out of the config file:
   ```bash
   export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…
   export BRAVE_API_KEY=…
   openaidy start
   ```
2. **Edit the server via the UI** (`MCP` page → Edit) and replace `${VAR}` with the literal key. This persists the key in `~/.openaidy/config.json` — convenient but less secure.

A server whose `${VAR}` is unset sits in "Awaiting configuration" instead of trying (and failing) to connect — set the env var or paste the key to activate it.

#### Adding or removing preinstalled servers

Edit `config/openaidy.template.json` and add/remove entries. On the next server start, `apps/server/src/mcp/preinstall.ts` reconciles: new entries are added, updated entries replace pristine ones, and servers the user has deleted are not resurrected. User-edited entries are never clobbered.

## Architecture

See the [`docs/`](./docs/) directory for detailed documentation:

- [`docs/overview.md`](./docs/overview.md) — Product overview and design goals
- [`docs/architecture.md`](./docs/architecture.md) — System architecture
- [`docs/monorepo.md`](./docs/monorepo.md) — Monorepo structure and package boundaries
- [`docs/websocket-protocol.md`](./docs/websocket-protocol.md) — WebSocket protocol reference
- [`docs/websocket-client-sdk.md`](./docs/websocket-client-sdk.md) — WebSocket client SDK guide
- [`docs/api-design.md`](./docs/api-design.md) — REST API design principles

## Contributing

1. Create a feature branch from `main`
2. Make your changes — keep commits focused
3. Run `pnpm lint && pnpm test` before pushing
4. Open a pull request

**Code conventions:**

- Types go in `packages/shared-types` (shared) or `src/types.ts` (server-internal) — never exported from logic files
- All route handlers live in `apps/server/src/routes/`
- Each package exposes a public API through its `src/index.ts`

## License

MIT
