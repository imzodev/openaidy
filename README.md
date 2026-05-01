<p align="center">
  <img src="./docs/assets/banner.png" alt="OpenAidy" width="892" />
</p>

# OpenAidy

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
