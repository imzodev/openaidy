# CLI Installation Guide

This guide explains how to install and run the OpenAidy CLI.

## One-Command Install (Unix / macOS / WSL2)

```bash
curl -fsSL https://openaidy.dev/install.sh | bash
```

What the installer does:

1. Ensures Git, Node.js 22, and pnpm are available
2. Clones (or updates) the `openaidy` repository at `~/.openaidy/`
3. Installs dependencies with `pnpm install`
4. Builds the project with `pnpm build`
5. Installs the `openaidy` CLI wrapper to `~/.local/bin/` (or `/usr/local/bin/` when running as root)
6. Generates a JWT signing secret at `~/.openaidy/state/install.json`
7. Runs `openaidy init` to mint the bootstrap-admin token and prints it to stdout

The final install message is:

```
OpenAidy is installed.

Bootstrap admin token: <token-value>

Next steps:
  Re-run the installer to bring the server online, OR
  cd ~/.openaidy && pnpm --filter @openaidy/server dev

(Server startup is delivered in the next release.)
```

## One-Command Install (Windows / PowerShell 5.1+)

```powershell
iex (irm https://openaidy.dev/install.ps1)
```

What the installer does (Windows mirror of the Unix flow):

1. Ensures Git, Node.js 22, and pnpm are available (winget → choco → direct download)
2. Clones (or updates) the repository at `$env:LOCALAPPDATA\openaidy\`
3. Installs dependencies with `pnpm install`
4. Builds the project with `pnpm build`
5. Installs the `openaidy.cmd` shim to `$env:LOCALAPPDATA\openaidy\bin\` and prepends it to user `PATH`
6. Generates a JWT signing secret at `$env:LOCALAPPDATA\openaidy\state\install.json`
7. Runs `openaidy init` to mint the bootstrap-admin token and prints it to stdout

## Idempotency

Re-running the installer is safe:

- If `$OPENAIDY_HOME/.git` already exists, the script pulls the latest `main` (or the `--branch` you pass) instead of cloning fresh.
- `pnpm install` and `pnpm build` refresh dependencies and rebuilt artifacts.
- `openaidy init` reuses an existing valid token — it only regenerates when the token is expired, corrupt, or missing required fields.
- The JWT signing secret at `$OPENAIDY_HOME/state/install.json` is preserved across installs so previously-issued tokens keep validating.

## Install Options

### Unix / macOS / WSL

```bash
# Custom install directory (default: ~/.openaidy)
curl -fsSL https://openaidy.dev/install.sh | bash -s -- --dir /opt/openaidy

# Install a specific branch
curl -fsSL https://openaidy.dev/install.sh | bash -s -- --branch feat/foo

# Skip the build step (e.g. CI on already-built artifacts)
curl -fsSL https://openaidy.dev/install.sh | bash -s -- --skip-build
```

### Windows / PowerShell

```powershell
# Custom install directory (default: $env:LOCALAPPDATA\openaidy)
.\install.ps1 -InstallDir "C:\Tools\openaidy"

# Install a specific branch
.\install.ps1 -Branch feat/foo

# Skip the build step
.\install.ps1 -SkipBuild
```

## Verifying the Install

### Check the CLI is on PATH

```bash
openaidy --help
openaidy --version
```

### Repo-Local Dev Mode

If you're developing OpenAidy itself, you can also invoke the CLI from the repo without a global install:

```bash
pnpm openaidy --help
```

### Check the Token File

```bash
openaidy admin token path   # prints the resolved path
openaidy admin token show   # inspects status + token value (when valid)
openaidy init               # idempotent; prints the token to stdout
```

The token file lives at one of:

- `$OPENAIDY_HOME/credentials/bootstrap-admin.json` (when `OPENAIDY_HOME` is set)
- `.openaidy/credentials/bootstrap-admin.json` (default — repo-local `pnpm dev`)

## `openaidy init`

`openaidy init` is the canonical way to obtain the bootstrap-admin token in a fresh install. It:

- Mints a JWT signed with the secret at `$OPENAIDY_HOME/state/install.json` (or the `WS_TOKEN_SECRET` env var)
- Persists the record to `$OPENAIDY_HOME/credentials/bootstrap-admin.json` with mode `0600` on POSIX
- Reuses an existing valid record (no file rewrite) when one is present
- Regenerates on expired, corrupt, or structurally invalid existing records
- Prints exactly one parseable line: `Bootstrap admin token: <jwt>`

The command exits with code 1 if `WS_TOKEN_SECRET` is unset (or set to the default `'change-me-in-production'`) — the installer always generates a real secret before calling it.

## Troubleshooting

### Command Not Found

**Error:** `command not found: openaidy`

**Solution:** Ensure `~/.local/bin` (or `/usr/local/bin` when running as root) is on your `PATH`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
```

### Token File Not Found

**Error:** `Bootstrap admin token not found at ~/.openaidy/credentials/bootstrap-admin.json`

**Solution:** Run `openaidy init` to mint one. The installer always does this for you.

### "Refusing to generate token with default JWT secret"

**Error:** `openaidy init` exits 1 with this message.

**Cause:** `WS_TOKEN_SECRET` is unset (or set to the literal `'change-me-in-production'`).

**Solution:** Either re-run the installer (which sets a real secret in `$OPENAIDY_HOME/state/install.json`) or set `WS_TOKEN_SECRET` manually:

```bash
export WS_TOKEN_SECRET=$(openssl rand -hex 32)
openaidy init
```

## Environment Variables

| Variable                     | Description                                                   | Default                                                           |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `OPENAIDY_HOME`              | Install root (used by `openaidy init` and `resolveCLIConfig`) | `~/.openaidy`                                                     |
| `WS_TOKEN_SECRET`            | JWT signing secret (must match server)                        | `'change-me-in-production'` (unsafe — refused by `openaidy init`) |
| `BOOTSTRAP_ADMIN_ENABLED`    | Set to `false` to disable bootstrap admin entirely            | `true`                                                            |
| `BOOTSTRAP_ADMIN_TOKEN_PATH` | Explicit override for the token file path                     | `$OPENAIDY_HOME/credentials/bootstrap-admin.json`                 |
| `OPENAIDY_WS_URL`            | Override the WebSocket URL                                    | `ws://localhost:3001/ws`                                          |
| `OPENAIDY_SERVER_URL`        | Override the HTTP REST URL                                    | `http://localhost:3001`                                           |

## Roadmap

- **Server startup on install** (delivered in the next release): `openaidy start` will spawn the server, write a PID file, and print the URL the user can open.
- **`npm publish` distribution**: once `@openaidy/cli` is published to npm, `npm install -g @openaidy/cli` will replace the `curl | bash` flow. This is tracked separately.
- **Uninstall / `--uninstall` flag**: out of scope for this change.

## Next Steps

- [Getting Started Guide](./getting-started.md)
- [Bootstrap Admin Operator Guide](./bootstrap-admin.md)
- [Command Reference](./command-reference.md)
- [Architecture Guide](./architecture.md)
