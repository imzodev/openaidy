# CLI Installation Guide

This guide explains how to install and run the Aidy CLI.

## One-Command Install (Unix / macOS / WSL2)

```bash
curl -fsSL https://aidyagent.app/install.sh | bash
```

What the installer does:

1. Ensures Git, Node.js 22, and pnpm are available
2. Clones (or updates) the `aidy` repository at `~/.aidy/`
3. Installs dependencies with `pnpm install`
4. Builds the project with `pnpm build`
5. Installs the `aidy` CLI wrapper to `~/.local/bin/` (or `/usr/local/bin/` when running as root)
6. Generates a JWT signing secret at `~/.aidy/state/install.json`
7. Runs `aidy init` to mint the bootstrap-admin token and prints it to stdout

The final install message is:

```
Aidy is installed.

Bootstrap admin token: <token-value>

Next steps:
  Re-run the installer to bring the server online, OR
  cd ~/.aidy && pnpm --filter @aidyagent/server dev

(Server startup is delivered in the next release.)
```

## One-Command Install (Windows / PowerShell 5.1+)

```powershell
iex (irm https://aidyagent.app/install.ps1)
```

What the installer does (Windows mirror of the Unix flow):

1. Ensures Git, Node.js 22, and pnpm are available (winget → choco → direct download)
2. Clones (or updates) the repository at `$env:LOCALAPPDATA\aidy\`
3. Installs dependencies with `pnpm install`
4. Builds the project with `pnpm build`
5. Installs the `aidy.cmd` shim to `$env:LOCALAPPDATA\aidy\bin\` and prepends it to user `PATH`
6. Generates a JWT signing secret at `$env:LOCALAPPDATA\aidy\state\install.json`
7. Runs `aidy init` to mint the bootstrap-admin token and prints it to stdout

## Idempotency

Re-running the installer is safe:

- If `$AIDY_HOME/.git` already exists, the script pulls the latest `main` (or the `--branch` you pass) instead of cloning fresh.
- `pnpm install` and `pnpm build` refresh dependencies and rebuilt artifacts.
- `aidy init` reuses an existing valid token — it only regenerates when the token is expired, corrupt, or missing required fields.
- The JWT signing secret at `$AIDY_HOME/state/install.json` is preserved across installs so previously-issued tokens keep validating.

## Install Options

### Unix / macOS / WSL

```bash
# Custom install directory (default: ~/.aidy)
curl -fsSL https://aidyagent.app/install.sh | bash -s -- --dir /opt/aidy

# Install a specific branch
curl -fsSL https://aidyagent.app/install.sh | bash -s -- --branch feat/foo

# Skip the build step (e.g. CI on already-built artifacts)
curl -fsSL https://aidyagent.app/install.sh | bash -s -- --skip-build
```

### Windows / PowerShell

```powershell
# Custom install directory (default: $env:LOCALAPPDATA\aidy)
.\install.ps1 -InstallDir "C:\Tools\aidy"

# Install a specific branch
.\install.ps1 -Branch feat/foo

# Skip the build step
.\install.ps1 -SkipBuild
```

## Verifying the Install

### Check the CLI is on PATH

```bash
aidy --help
aidy --version
```

### Repo-Local Dev Mode

If you're developing Aidy itself, you can also invoke the CLI from the repo without a global install:

```bash
pnpm aidy --help
```

### Check the Token File

```bash
aidy admin token path   # prints the resolved path
aidy admin token show   # inspects status + token value (when valid)
aidy init               # idempotent; prints the token to stdout
```

The token file lives at one of:

- `$AIDY_HOME/credentials/bootstrap-admin.json` (when `AIDY_HOME` is set)
- `.aidy/credentials/bootstrap-admin.json` (default — repo-local `pnpm dev`)

## `aidy init`

`aidy init` is the canonical way to obtain the bootstrap-admin token in a fresh install. It:

- Mints a JWT signed with the secret at `$AIDY_HOME/state/install.json` (or the `WS_TOKEN_SECRET` env var)
- Persists the record to `$AIDY_HOME/credentials/bootstrap-admin.json` with mode `0600` on POSIX
- Reuses an existing valid record (no file rewrite) when one is present
- Regenerates on expired, corrupt, or structurally invalid existing records
- Prints exactly one parseable line: `Bootstrap admin token: <jwt>`

The command exits with code 1 if `WS_TOKEN_SECRET` is unset (or set to the default `'change-me-in-production'`) — the installer always generates a real secret before calling it.

## Troubleshooting

### Command Not Found

**Error:** `command not found: aidy`

**Solution:** Ensure `~/.local/bin` (or `/usr/local/bin` when running as root) is on your `PATH`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

### Token File Not Found

**Error:** `Bootstrap admin token not found at ~/.aidy/credentials/bootstrap-admin.json`

**Solution:** Run `aidy init` to mint one. The installer always does this for you.

### "Refusing to generate token with default JWT secret"

**Error:** `aidy init` exits 1 with this message.

**Cause:** `WS_TOKEN_SECRET` is unset (or set to the literal `'change-me-in-production'`).

**Solution:** Either re-run the installer (which sets a real secret in `$AIDY_HOME/state/install.json`) or set `WS_TOKEN_SECRET` manually:

```bash
export WS_TOKEN_SECRET=$(openssl rand -hex 32)
aidy init
```

## Environment Variables

| Variable                     | Description                                               | Default                                                       |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `AIDY_HOME`                  | Install root (used by `aidy init` and `resolveCLIConfig`) | `~/.aidy`                                                     |
| `WS_TOKEN_SECRET`            | JWT signing secret (must match server)                    | `'change-me-in-production'` (unsafe — refused by `aidy init`) |
| `BOOTSTRAP_ADMIN_ENABLED`    | Set to `false` to disable bootstrap admin entirely        | `true`                                                        |
| `BOOTSTRAP_ADMIN_TOKEN_PATH` | Explicit override for the token file path                 | `$AIDY_HOME/credentials/bootstrap-admin.json`                 |
| `AIDY_WS_URL`                | Override the WebSocket URL                                | `ws://localhost:3001/ws`                                      |
| `AIDY_SERVER_URL`            | Override the HTTP REST URL                                | `http://localhost:3001`                                       |

## Roadmap

- **Server startup on install** (delivered in the next release): `aidy start` will spawn the server, write a PID file, and print the URL the user can open.
- **`npm publish` distribution**: once `@aidyagent/cli` is published to npm, `npm install -g @aidyagent/cli` will replace the `curl | bash` flow. This is tracked separately.
- **Uninstall / `--uninstall` flag**: out of scope for this change.

## Next Steps

- [Getting Started Guide](./getting-started.md)
- [Bootstrap Admin Operator Guide](./bootstrap-admin.md)
- [Command Reference](./command-reference.md)
- [Architecture Guide](../../plans/cli/architecture.md)
