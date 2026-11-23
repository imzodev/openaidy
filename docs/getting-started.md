---
summary: 'Install Aidy, log in, connect a provider, and talk to your first agent'
read_when:
  - You are setting up Aidy for the first time
title: 'Getting Started'
---

# Getting Started

Aidy is a self-hosted AI agent platform: one server you run yourself, with a web UI, a REST + WebSocket API, and a CLI. This page gets you from nothing installed to chatting with your first agent.

## 1. Install

The installer provisions everything you need — a managed Node.js runtime (only if your system Node is too old), [ripgrep](https://github.com/BurntSushi/ripgrep), and the `@aidyagent/app` package itself.

**macOS / Linux / WSL:**

```bash
curl -fsSL https://aidyagent.app/install.sh | bash
```

**Windows (PowerShell):**

```powershell
iex (irm https://aidyagent.app/install.ps1)
```

The installer also generates a bootstrap admin token and opens your browser to the login screen with it pre-filled, so the next two steps usually happen automatically.

## 2. Start the server

```bash
aidy start    # boots the server + web UI on http://localhost:3001
```

Other lifecycle commands you'll use:

```bash
aidy stop     # shut it down
aidy status   # check whether it's running
aidy init     # regenerate the bootstrap admin token if it's lost or expired
```

### Keep it running on a Linux server

`aidy start` isn't supervised: if the server crashes or the machine reboots, it stays down. On a VPS or any always-on Linux host, hand it to systemd instead:

```bash
aidy service install    # start at boot, restart within 5s if it ever exits
aidy service status     # is it installed, enabled and running?
aidy service uninstall  # go back to plain `aidy start`
```

Once the service is installed, `aidy start`, `stop` and `restart` control it through `systemctl`, so you keep using the same commands and only one server ever runs. Run it as root for a system-wide service, or as a normal user for a user service that keeps running after you log out. See the [CLI reference](./cli/command-reference.md#service---run-under-systemd) for details.

## 3. Log in

If the browser didn't open automatically, go to `http://localhost:3001` and paste the bootstrap admin token shown by the installer (or by `aidy init`). This token is a full-access credential meant for initial setup — once you're in, create a scoped access token for anything else (see [Access Tokens](./access-tokens.md)).

## 4. Connect a provider

Agents need a model provider to actually run. Open **Settings → Providers** in the web UI and add one:

- **Cloud APIs**: OpenAI, Anthropic, Gemini, Groq, DeepSeek, MiniMax, or any OpenAI-compatible endpoint
- **Local**: Ollama, LM Studio, or anything else that speaks the OpenAI-compatible API

See [Providers](./providers.md) for the full list and how BYOK (bring your own key) works.

## 5. Talk to your first agent

Aidy ships with a default agent already configured. Open a new session from the web UI and send a message — the response streams back token by token, the same way it does over WebSocket for every Aidy client.

From here:

- [Agents](./agents.md) — how agents are dispatched, streamed, and configured
- [Sessions](./sessions.md) — how conversations and context work
- [Tasks](./tasks.md) — structured, multi-step work with a kanban board and a visual workflow graph
- [Channels](./channels.md) — connect WhatsApp or Discord so agents can handle real conversations
- [Addons](./addons/README.md) — build or install a mini-app that plugs into Aidy
- [Backups](./backups.md) — export your data, or move Aidy to another server

## Building from source

If you're contributing to Aidy itself rather than running it as a product:

```bash
git clone https://github.com/imzodev/aidy.git && cd aidy
pnpm install && pnpm dev
# → API at http://localhost:3001, UI at http://localhost:5173
```

`pnpm dev` runs the API server and the Vite-powered UI separately with hot reload. From a source checkout, every CLI command is available via `pnpm aidy <command>` — see the [CLI Getting Started guide](./cli/getting-started.md) for the full admin/CLI workflow (access tokens, device pairing, the bootstrap admin token in detail).

## Prerequisites for building from source

- [Node.js](https://nodejs.org) v22.13+ (or v24+) — required for Node's built-in `node:sqlite`
- [pnpm](https://pnpm.io) v10+
- [ripgrep](https://github.com/BurntSushi/ripgrep) — required by the built-in code-search tools
- PostgreSQL (optional — SQLite is the default)
