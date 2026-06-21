# OpenAidy Monorepo Patterns

## Repo Layout

```
/tmp/openaidy/
├── apps/
│   ├── server/       # Node.js API server (the "core")
│   └── web/          # Solid.js + Vite frontend
├── packages/
│   ├── config/       # Provider config schemas, Zod
│   ├── providers/    # ProviderProfile registry (NEW)
│   ├── runtime/      # Adapter contract
│   ├── sdk/          # Client SDK
│   └── shared-types/ # Shared TypeScript types
├── docs/providers/   # Implementation plans (NOT .hermes/plans/)
└── package.json     # pnpm monorepo
```

## Plan Location Convention

**Plans go in `docs/<feature>/`** — e.g. `docs/providers/registry-plan.md`.
**NOT** `.hermes/plans/` which is for Hermes-internal plans.

## Core Architecture: Server as Shared Core

The `apps/server` is the single source of truth. CLI, desktop, and addons all invoke it:

```
apps/server (HTTP API)
    ↑ CLI spawns it as subprocess
    ↑ Desktop (Tauri) spawns it as subprocess
    ↑ Frontend (Solid.js) calls it via HTTP
    ↑ Addons loaded by the server process
```

CLI and desktop both spawn `apps/server` as a subprocess on `127.0.0.1`. Frontend calls it over HTTP. Addons are loaded by the server.

## Provider Profile Registry

`packages/providers/` package structure:

```
packages/providers/src/
├── types.ts              # ProviderProfile class + Zod schema
├── hooks.ts              # HookContext, BuildExtraBodyHook, OnStreamChunkHook
├── registry.ts           # ProviderRegistry (singleton, lazy discovery)
├── index.ts              # Public re-exports
├── types.test.ts         # 27 tests
├── registry.test.ts      # 18 tests
├── deepseek/index.ts     # DeepSeekProfile (thinking hooks)
├── minimax/index.ts      # MiniMaxProfile (thinking block streaming)
├── groq/index.ts         # GroqProfile (passthrough)
└── openrouter/index.ts   # OpenRouterProfile (passthrough)
```

## pnpm Filter Syntax

When running commands on specific packages in this monorepo, use the **package.json `name` field**, not a scoped npm name:

```bash
# WRONG — no package named "@openaidy/web"
pnpm --filter @openaidy/web exec tsc --noEmit

# CORRECT — package.json has name="web"
pnpm --filter web exec tsc --noEmit

# WRONG — no package named "@openaidy/server"
pnpm --filter @openaidy/server exec tsc --noEmit

# CORRECT — package.json has name="server"
pnpm --filter server exec tsc --noEmit
```

**Always check `package.json` for the actual `name` field** before using `--filter`.

## Banner Image Asset

The OpenAidy banner lives at `docs/assets/banner.png` (1536×1024 PNG). From the web app at `apps/web/src/`, it is reachable at `../../../docs/assets/banner.png`. Use it in landing/empty-state pages:

```tsx
<div class="rounded-2xl overflow-hidden shadow-lg mb-8 border border-gray-200 dark:border-gray-700">
  <img
    src="../../../docs/assets/banner.png"
    alt="OpenAidy"
    class="w-full object-cover"
    style="max-height: 280px;"
  />
</div>
```

## Git / PR Conventions

- **Fork:** `agentjetsonimzodev/openaidy`
- **Upstream:** `imzodev/openaidy`
- **Branches:** `feat/<feature>`, `fix/<bug>`, `refactor/<thing>`
- **PRs:** From fork branch to upstream using `--head owner:branch`
- **Commits:** Conventional commits (`feat:`, `fix:`, `docs:`)
- **Hooks:** husky + lint-staged (pre-commit enforces linting)

## Desktop App Architecture

Desktop = Tauri shell + same `apps/server` subprocess. See `docs/desktop/` for full plan.

## Key Technologies

| Layer    | Tech                                  |
| -------- | ------------------------------------- |
| Frontend | Solid.js + Vite + TailwindCSS         |
| Server   | Node.js (Fastify or similar)          |
| Database | PostgreSQL (server), SQLite (desktop) |
| Config   | Zod + YAML (`openaidy.yaml`)          |
| Bundler  | Tauri 2.x (desktop)                   |

## Installer Pattern

OpenAidy ships a portable shell installer (`install.sh` at repo root) with no external dependencies. The pattern:

### Self-contained toolchain

- **Node.js** — downloaded and managed in `$OPENAIDY_HOME/node/`. No system Node needed. Arch-detected tarball fetched from nodejs.org, extracted to `~/.openaidy/node/`. Binaries symlinked to `~/.local/bin/`.
- **pnpm** — downloaded and managed in `$OPENAIDY_HOME/pnpm/`. No global install. Fetched via `curl -fsSL https://get.pnpm.io/install.sh | bash`.
- **Git** — auto-installed via apt/Homebrew/xcode-select if missing.

### Installation sequence

1. Detect OS/distro, verify Git → install if missing
2. Verify Node.js (or download + extract portable Node)
3. Install pnpm into `$OPENAIDY_HOME/pnpm/`
4. Clone or update the repo (shallow, single branch)
5. `pnpm install` → `pnpm build`
6. Drop a shell wrapper at `~/.local/bin/openaidy` that invokes `node --import tsx <repo>/packages/cli/bin/openaidy.ts`

### CLI wrapper pattern

```sh
#!/bin/sh
OPENAIDY_HOME="${OPENAIDY_HOME:-$HOME/.openaidy}"
export PATH="$OPENAIDY_HOME/node/bin:$OPENAIDY_HOME/pnpm:$PATH"
exec node --import tsx "$OPENAIDY_HOME/packages/cli/bin/openaidy.ts" "$@"
```

### Arguments supported

- `--dir <path>` — custom install root (default: `~/.openaidy`)
- `--branch <name>` — branch to clone (default: `main`)
- `--skip-build` — skip the pnpm build step
- `--skip-setup` — skip post-install setup
- `--non-interactive` — run fully non-interactive

### Install URL

When hosting: `https://openaidy.dev/install.sh` — curl piped to bash is the canonical install method.
