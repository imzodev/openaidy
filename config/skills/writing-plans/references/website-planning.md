# Website Planning for OpenAidy

When planning a website for OpenAidy (landing page, docs site, marketing), always start with a **three-destination structure**:

| URL                 | Purpose                | Status check           |
| ------------------- | ---------------------- | ---------------------- |
| `openaidy.com`      | Marketing landing page | Check current state    |
| `app.openaidy.com`  | Operator dashboard     | Link from landing page |
| `docs.openaidy.com` | Documentation site     | Often missing          |

## Always verify before claiming

Before describing what OpenAidy has or doesn't have, **check the repo first**:

```bash
# Current landing page
cat apps/web/src/App.tsx
ls apps/web/src/components/pages/

# Docs structure
ls docs/

# Install scripts (may be on a feature branch)
git branch | grep installer
git diff main..feat/installer --name-only | grep -E "^install"
```

**Never say "OpenAidy has X" without reading the files.** If you don't know, explore first.

## Landing page sections (openaidy.com)

1. **Hero** — one-liner + quick install command
2. **What is OpenAidy** — plugin-first AI operations platform summary
3. **Core features** — Sessions, Agent dispatch, Scheduler/cron, Channels, Device pairing, Plugin system, MCP
4. **Real-time WebSocket** — highlight streaming/real-time
5. **Install section** — curl/powershell install commands
6. **Architecture teaser** — Node.js + TypeScript, plugin SDK, MCP
7. **Links to app + docs**
8. **Footer** — GitHub, license

## Docs site (docs.openaidy.com)

Existing markdown in `/docs/`:

- Overview, Architecture, Data Model
- Plugin SDK, API Design
- WebSocket protocol + client SDK
- Bootstrapping, MVP Roadmap
- Channels, Skills, Addons, Pulses, Recurring tasks, Memory, CLI

**Recommended:** VitePress → GitHub Pages. Lightweight, markdown-native.

## Landing Page: Critical Location Rule

**The landing page MUST be at the repo root level (`/landing`), NOT inside `apps/`.**

- ✅ Correct: `/tmp/openaidy/landing/` (sibling to `apps/`, `packages/`, `plugins/`)
- ❌ Wrong: `/tmp/openaidy/apps/landing/` (user explicitly rejected this)

If the user says "same level as apps", they mean repo root, not nested under `apps/`.

### Standalone Landing App Pattern

When building a public landing page separate from the authenticated web app:

- **Stack:** Vite + React + TypeScript (no backend, no API, no auth)
- **Location:** `/landing` at repo root
- **Port:** Default 5173, configurable via `server.port` in `vite.config.ts`
- **pnpm workspace:** Add `- landing` to `pnpm-workspace.yaml` (packages at repo root are NOT auto-discovered)
- **Docs:** VitePress in `/landing/docs/` pointing at existing `/docs/` MD files via `src: '../../docs'` in VitePress config
- **Banner assets:** Copy to `/landing/public/` (served as static files)
- **Shared state:** Zero shared state with `apps/web` — completely independent build and runtime
- **Git:** `git add landing/` on its own commit, push to feature branch, PR targets upstream

### Vite Server Host Fix

Vite defaults to binding `[::1]:5173` (IPv6 only). In some environments `127.0.0.1` fails while `[::1]` works. Always set `server.host: '0.0.0.0'` in `vite.config.ts` to bind all interfaces:

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
});
```

## Install scripts

Already exist in `feat/installer` branch:

- `install.sh` — macOS/Linux
- `install.ps1` — Windows

Serve via `openaidy.com/install.sh` and `openaidy.com/install.ps1`.

## Decision questions before building

1. Static HTML or SolidJS/Vite page in existing monorepo?
2. Domain already configured?
3. Hosting: GitHub Pages, Vercel, or other?
4. Docs: VitePress, Docusaurus, or GitBook?
