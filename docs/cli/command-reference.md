# CLI Command Reference

Complete reference for all Aidy CLI commands.

## Global Options

```bash
aidy [options]

Options:
  --help, -h      Show help
  --version, -v   Show version
```

## Command Groups

### `admin` - Administrative Commands

Commands for bootstrap-admin and system management.

---

#### `admin token show`

Show the current bootstrap-admin token information.

**Usage:**

```bash
aidy admin token show
```

**Arguments:** None

**Options:** None

**Description:**

Displays information about the bootstrap-admin token:

- Token status (valid, expired, missing, malformed, invalid, disabled)
- Token file path
- Token value (only for valid/expired tokens)
- Metadata (client ID, created, expires, scopes)

**Examples:**

```bash
# Show token info
pnpm aidy admin token show
```

**Sample Output (Valid Token):**

```
Bootstrap Admin Token
========================

Status:    valid
Path:      .aidy/credentials/bootstrap-admin.json
Enabled:   true
Client ID: admin_abc123
Created:   2026-04-01 10:00:00
Expires:   2026-04-02 10:00:00
Scopes:    admin, pairing

Token:     eyJhbGciOiJIUzI1NiIs...
```

**Sample Output (Missing Token):**

```
Bootstrap Admin Token
========================

Status:    missing
Path:      .aidy/credentials/bootstrap-admin.json
Enabled:   true

Error: Token file not found
```

**Exit Codes:**
| Code | Condition |
|------|-----------|
| 0 | Token is valid |
| 1 | Token is missing, malformed, invalid, expired, or disabled |

---

#### `admin token validate`

Validate the bootstrap-admin token.

**Usage:**

```bash
aidy admin token validate
```

**Arguments:** None

**Options:** None

**Description:**

Checks that the bootstrap-admin token:

- File exists
- Is valid JSON
- Has valid signature
- Is not expired

**Examples:**

```bash
pnpm aidy admin token validate
```

**Exit Codes:**
| Code | Condition |
|------|-----------|
| 0 | Token is valid |
| 1 | Token is invalid, missing, or expired |

---

#### `admin token path`

Show the path to the bootstrap-admin token file.

**Usage:**

```bash
aidy admin token path
```

**Arguments:** None

**Options:** None

**Description:**

Outputs the file path where the bootstrap-admin token is stored.

**Examples:**

```bash
pnpm aidy admin token path
```

**Output:**

```
.aidy/credentials/bootstrap-admin.json
```

**Exit Codes:**
| Code | Condition |
|------|-----------|
| 0 | Always succeeds |

---

### `tokens` - Access Token Management

Commands for creating and managing access tokens used for UI login and API access.

> **Requires:** Server running with a database (`DB_KIND=sqlite` or `DB_KIND=postgres`). Uses the bootstrap-admin token from `.aidy/credentials/bootstrap-admin.json`.

---

#### `tokens list`

List all access tokens.

**Usage:**

```bash
aidy tokens list
```

**Arguments:** None

**Options:** None

**Description:**

Displays all access tokens grouped into active and revoked. Does not expose raw token values or hashes — only the prefix, name, scopes, and usage metadata.

**Examples:**

```bash
pnpm aidy tokens list
```

**Sample Output:**

```
Access Tokens
=============

Active (2)

  CI Pipeline
    ID:       a1b2c3d4-...
    Prefix:   oat_a1b2…
    Scopes:   sessions.read, sessions.stream
    Created:  Apr 1, 2026
    Last use: Apr 19, 2026

  Admin Key
    ID:       e5f6g7h8-...
    Prefix:   oat_e5f6…
    Scopes:   *
    Created:  Apr 15, 2026

Revoked (1)

  Old Token [revoked]
    ID:      x9y0z1a2-...
    Prefix:  oat_x9y0…
```

**Exit Codes:**
| Code | Condition |
|------|----------|
| 0 | Success |
| 1 | Server unreachable, or admin token missing |

---

#### `tokens create`

Create a new access token.

**Usage:**

```bash
aidy tokens create --name <name> --scopes <scopes> [--expires <date>]
```

**Arguments:** None

**Options:**
| Option | Value | Required | Description |
|--------|-------|----------|-------------|
| `--name`, `-n` | `<string>` | Yes | Human-readable name for the token |
| `--scopes` | `<scopes>` | Yes | Comma-separated list of permission scopes |
| `--expires` | `<ISO 8601 date>` | No | Expiry date, e.g. `2026-12-31` |

**Available scopes:**
| Scope | Description |
|-------|-------------|
| `*` | Admin — full access |
| `sessions.read` | Read sessions |
| `sessions.write` | Write sessions |
| `sessions.stream` | Stream session output |
| `sessions.delete` | Delete sessions |
| `agents.read` | Read agents |
| `agents.invoke` | Invoke agents |
| `providers.read` | Read provider config |
| `config.read` | Read app config |
| `config.write` | Write app config |

**Description:**

Creates a new access token and prints the raw `oat_…` value **once**. The raw token is never stored — if you lose it, you must revoke and recreate it.

The token can be used to log in to the Aidy web UI or to authenticate REST/WebSocket API requests.

**Examples:**

```bash
# Create a full-admin token
pnpm aidy tokens create --name "Admin Key" --scopes "*"

# Create a read-only CI token
pnpm aidy tokens create --name "CI Pipeline" --scopes "sessions.read,sessions.stream"

# Create a temporary token that expires end of year
pnpm aidy tokens create --name "Temp Access" --scopes "sessions.read" --expires "2026-12-31"
```

**Sample Output:**

```
Access token created
====================

  Name:    CI Pipeline
  ID:      a1b2c3d4-e5f6-...
  Scopes:  sessions.read, sessions.stream

Token (shown once — save it now):

  oat_a1b2c3d4e5f6...

Use this token to log into the UI or authenticate API requests.
```

**Exit Codes:**
| Code | Condition |
|------|----------|
| 0 | Token created successfully |
| 1 | Server error, server unreachable, or admin token missing |
| 2 | Missing or invalid arguments |

---

#### `tokens revoke`

Revoke an access token by ID.

**Usage:**

```bash
aidy tokens revoke <id>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<id>` | Yes | Token ID (from `tokens list`) |

**Options:** None

**Description:**

Permanently revokes the token. Any sessions or API calls using the revoked token will immediately stop working. This operation is irreversible.

**Examples:**

```bash
pnpm aidy tokens revoke a1b2c3d4-e5f6-...
```

**Sample Output:**

```
Revoked: CI Pipeline (a1b2c3d4-e5f6-...)
```

**Exit Codes:**
| Code | Condition |
|------|----------|
| 0 | Token revoked |
| 1 | Token not found, server unreachable, or admin token missing |
| 2 | Missing `<id>` argument |

---

### `devices` - Device Management Commands

Commands for device pairing and management.

---

#### `devices list`

List device pairing requests.

**Usage:**

```bash
aidy devices list [options]
```

**Arguments:** None

**Options:**
| Option | Value | Default | Description |
|--------|-------|---------|-------------|
| `--status` | `pending`, `approved`, `denied`, `expired`, `all` | `pending` | Filter by request status |
| `--limit` | `<number>` | No limit | Maximum number of results |

**Description:**

Lists pairing requests from devices attempting to connect to the Aidy server.

**Examples:**

```bash
# List pending requests (default)
pnpm aidy devices list

# List all requests
pnpm aidy devices list --status all

# List approved requests
pnpm aidy devices list --status approved

# Limit to 10 results
pnpm aidy devices list --limit 10

# Combine filters
pnpm aidy devices list --status expired --limit 20
```

**Sample Output (Pending):**

```
Pending Pairing Requests
========================

ID:        req_abc123
Device:    iPhone 15 Pro
Created:   2026-04-01 14:30:00
Expires:   2026-04-01 15:00:00 (in 25 minutes)

ID:        req_def456
Device:    MacBook Pro
Created:   2026-04-01 14:25:00
Expires:   2026-04-01 14:55:00 (in 20 minutes)

Showing 2 pending requests
```

**Sample Output (Empty):**

```
No pending pairing requests
```

**Exit Codes:**
| Code | Condition |
|------|-----------|
| 0 | Success (even if no results) |
| 1 | Error reading requests |

---

#### `devices approve`

Approve a pending device pairing request.

**Usage:**

```bash
aidy devices approve <request-id> [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<request-id>` | Yes | ID of the pairing request to approve |

**Options:**
| Option | Value | Default | Description |
|--------|-------|---------|-------------|
| `--scopes` | `<scopes>` | Server default | Comma-separated list of scopes to grant |

**Description:**

Approves a pending pairing request, allowing the device to connect. Optionally specify custom scopes to grant.

**Examples:**

```bash
# Approve with default scopes
pnpm aidy devices approve req_abc123

# Approve with custom scopes
pnpm aidy devices approve req_abc123 --scopes chat,files,calendar

# Approve with minimal scopes
pnpm aidy devices approve req_abc123 --scopes chat
```

**Sample Output (Success):**

```
✓ Request approved

ID:        req_abc123
Device:    iPhone 15 Pro
Status:    approved
Scopes:    chat, files, calendar
Approved:  2026-04-01 14:35:00
```

**Sample Output (Error - Already Processed):**

```
✗ Cannot approve request

ID:        req_abc123
Status:    approved

Error: Request has already been approved
```

**Exit Codes:**
| Code | Condition |
|------|-----------|
| 0 | Successfully approved |
| 1 | Request not found, already processed, or other error |
| 2 | Missing request ID argument |

---

#### `devices deny`

Deny a pending device pairing request.

**Usage:**

```bash
aidy devices deny <request-id>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `<request-id>` | Yes | ID of the pairing request to deny |

**Options:** None

**Description:**

Denies a pending pairing request, preventing the device from connecting.

**Examples:**

```bash
# Deny a request
pnpm aidy devices deny req_def456
```

**Sample Output (Success):**

```
✓ Request denied

ID:        req_def456
Device:    MacBook Pro
Status:    denied
Denied:    2026-04-01 14:36:00
```

**Exit Codes:**
| Code | Condition |
|------|-----------|
| 0 | Successfully denied |
| 1 | Request not found, already processed, or other error |
| 2 | Missing request ID argument |

---

### `sessions` - Chat Session Management

Commands for managing chat sessions.

#### `sessions list`

List all sessions.

```bash
aidy sessions list [--limit <n>]
```

#### `sessions create`

Create a new session.

```bash
aidy sessions create [title]
```

#### `sessions get`

Get session details by ID.

```bash
aidy sessions get <sessionId>
```

#### `sessions messages`

List all messages in a session.

```bash
aidy sessions messages <sessionId>
```

#### `sessions runs`

List all runs for a session.

```bash
aidy sessions runs <sessionId>
```

---

### `mcp` - MCP Server Management

Commands for managing Model Context Protocol servers.

#### `mcp import`

Import one or more MCP servers from a standard config file (or stdin) in the
keyed-map format used by Claude Desktop, VS Code and Cursor. Accepts either the
full `{ "mcpServers": { … } }` wrapper or a bare `{ "<id>": { … } }` map;
transport is taken from `type`/`transport` or inferred from `command`/`url`.
Reference secrets with `${ENV_VAR}` placeholders — they are resolved from the
server environment at connection time and never persisted in plaintext.

```bash
aidy mcp import ./mcp.json
cat ~/.config/mcp.json | aidy mcp import
```

Requires an admin token.

#### `mcp migrate-secrets`

One-shot migration: walk every persisted MCP server's `env`/`headers` and
encrypt plaintext inline secrets in-place, so a copy of `~/.aidy/aidy.json`
no longer exposes raw credentials. Existing installs that pasted a token
directly into a header (the issue #401 scenario) end up with the same value
re-written as `enc:v1:…` ciphertext.

The migration is **idempotent**: re-running on an already-migrated config is
a no-op. `${ENV_VAR}` references are left as plain placeholders — their
secret lives in the process environment, not the config.

```bash
aidy mcp migrate-secrets --dry-run   # show the plan without writing
aidy mcp migrate-secrets             # apply
```

Options:

- `--dry-run` — print the plan (servers and key counts that would be encrypted) without persisting any changes.

Requires an admin token.

---

### `providers` - Provider Management

Commands for managing LLM provider connections.

#### `providers list`

List all available providers.

```bash
aidy providers list
```

#### `providers connect`

Connect to a provider.

```bash
aidy providers connect <provider-id> [--api-key <key>]
```

#### `providers disconnect`

Disconnect from a provider.

```bash
aidy providers disconnect <provider-id>
```

---

## Server Management Commands

Top-level commands for controlling the Aidy server process.

#### `start`

Start the Aidy server as a background process.

```bash
aidy start
aidy start --foreground
```

`--foreground` keeps the CLI attached to the server: it forwards `SIGTERM`/`SIGINT` and exits with the server's exit code. That's what the systemd unit from `aidy service install` runs, so a crash shows up to systemd as the process exiting and it restarts the server. Foreground mode never starts the Vite web frontend.

When the service is installed, `start`, `stop` and `restart` control it through `systemctl` instead of spawning or killing a server themselves, so only one server ever runs.

#### `stop`

Stop the running Aidy server.

```bash
aidy stop
```

#### `restart`

Restart the running Aidy server: stops it (gracefully) then starts a fresh one. Equivalent to running `aidy stop` followed by `aidy start`, but in a single command with port preservation and a coherent exit code (0 only if both steps succeed).

```bash
aidy restart
aidy restart --port 3001
aidy restart --integrated
```

The port from the previous server PID file is preserved by default, so the user's browser tab and any client config stays pointed at the same origin. Pass `--port` to override (same semantics as `aidy start`). `--server-only` and `--integrated` work exactly like `start`.

If `stop` fails, `start` is **not** attempted — otherwise you'd risk starting a second server on a still-busy port. The stop error is surfaced directly.

#### `status`

Show the current server status.

```bash
aidy status
```

### `service` - Run Under systemd

`aidy start` on its own isn't supervised: if the server dies (for example, killed for running out of memory) it stays down. Installing the service hands the server to systemd, which starts it at boot and restarts it within 5 seconds whenever it exits. Linux with systemd only.

As root, the unit is installed system-wide at `/etc/systemd/system/aidy.service`. Other users get a user unit at `~/.config/systemd/user/aidy.service`, with lingering enabled (`loginctl enable-linger`) so it keeps running after logout.

#### `service install`

Write the unit, enable it and start it. A server already running from `aidy start` is stopped first and handed over. Re-run it to update the unit (e.g. after changing `--port`).

```bash
aidy service install
aidy service install --port 3001
```

Logs still go to `$AIDY_HOME/logs/server.log`.

#### `service uninstall`

Stop and disable the service and remove its unit file. Data in `AIDY_HOME` is untouched; run `aidy start` to go back to an unmanaged server.

```bash
aidy service uninstall
```

#### `service status`

Show whether the service is installed, enabled and running (`systemctl status aidy`).

```bash
aidy service status
```

---

## Exit Codes Reference

| Code | Name              | Description                    |
| ---- | ----------------- | ------------------------------ |
| 0    | SUCCESS           | Command completed successfully |
| 1    | ERROR             | General error                  |
| 2    | INVALID_ARGS      | Invalid or missing arguments   |
| 3    | NOT_FOUND         | Resource not found             |
| 4    | PERMISSION_DENIED | Insufficient permissions       |
| 5    | CONFIG_ERROR      | Configuration error            |

## Help System

### Global Help

```bash
aidy --help
aidy help
```

### Group Help

```bash
aidy admin --help
aidy tokens --help
aidy devices --help
```

### Command Help

```bash
aidy admin token show --help
aidy tokens list --help
aidy tokens create --help
aidy tokens revoke --help
aidy devices list --help
aidy devices approve --help
aidy devices deny --help
```

## Environment Variables

The CLI reads configuration from environment variables (compatible with the server's `.env` file):

| Variable                     | Default                                  | Description                                                  |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `AIDY_SERVER_URL`            | `http://localhost:3001`                  | HTTP base URL for REST API calls (used by `tokens` commands) |
| `AIDY_WS_URL`                | `ws://localhost:3001/ws`                 | WebSocket URL (used by `devices` commands)                   |
| `BOOTSTRAP_ADMIN_TOKEN_PATH` | `.aidy/credentials/bootstrap-admin.json` | Path to the admin token file                                 |
| `PORT`                       | `3001`                                   | Fallback for deriving `AIDY_SERVER_URL`                      |
| `WS_PORT`                    | `3001`                                   | Fallback for deriving `AIDY_WS_URL`                          |
| `WS_PATH`                    | `/ws`                                    | WebSocket path suffix                                        |

### `addon` - Addon Development Tools

Commands for creating, building, testing, and publishing Aidy addons.

---

#### `addon install`

Register a built addon with the local Aidy server. Run from inside your addon directory after building.

**Usage:**

```bash
aidy addon install [--server-url <url>] [--token <token>]
```

**Examples:**

```bash
pnpm aidy addon install
pnpm aidy addon install --server-url http://localhost:3001
```

---

#### `addon create`

Create a new addon project from a template.

**Usage:**

```bash
aidy addon create <name> [--template <template>] [--directory <dir>] [--no-git] [--no-install]
```

**Examples:**

```bash
pnpm aidy addon create my-addon
pnpm aidy addon create my-addon --template agent
```

---

#### `addon init`, `addon build`, `addon test`, `addon dev`, `addon publish`

**Status: planned, not yet implemented.** `init` and `build` appear in `addon --help`'s listing, but none of these five have a registered command handler — running any of them today returns an "unknown command" error, not the behavior their name suggests. Use `addon create` for scaffolding and `addon validate` for checking a package in the meantime.

---

#### `addon validate`

Validate addon package and manifest.

**Usage:**

```bash
aidy addon validate [--package] [--verbose] [--strict]
```

**Examples:**

```bash
pnpm aidy addon validate
pnpm aidy addon validate --verbose
```

---

#### `addon templates`

List available addon project templates.

**Usage:**

```bash
aidy addon templates
```

**Examples:**

```bash
pnpm aidy addon templates
```

---

### `agents` - Agent Management

Commands for creating and managing agents and their workspaces.

---

#### `agents list`

List all configured agents.

**Usage:**

```bash
aidy agents list
```

**Examples:**

```bash
pnpm aidy agents list
```

---

#### `agents create`

Create a new agent with its own workspace directory.

**Usage:**

```bash
aidy agents create [<name>] [--id <id>] [--description <desc>]
```

**Examples:**

```bash
pnpm aidy agents create
pnpm aidy agents create "Research Assistant"
pnpm aidy agents create --name "Research Assistant" --description "Helps with research"
```

---

#### `agents delete`

Delete an agent from the configuration. Requires typing the agent ID to confirm.

**Usage:**

```bash
aidy agents delete [<id>]
```

**Examples:**

```bash
pnpm aidy agents delete
pnpm aidy agents delete my-agent
```

**Exit Codes:** `0` success or cancelled, `1` error or confirmation mismatch

---

### `tasks` - Task Management

Commands for managing tasks and subtasks.

---

#### `tasks list`

List all tasks, optionally filtered by status.

**Usage:**

```bash
aidy tasks list [--status <status>] [--limit <n>]
```

**Options:**

| Option              | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `--status <status>` | Filter by status: backlog, todo, in_progress, review, done, cancelled |
| `--limit <n>`       | Limit number of results (default: 50)                                 |

**Examples:**

```bash
pnpm aidy tasks list
pnpm aidy tasks list --status in_progress
pnpm aidy tasks list --limit 10
```

**Exit Codes:** `0` success, `1` error, `2` invalid arguments

---

#### `tasks get`

Get full details for a specific task.

**Usage:**

```bash
aidy tasks get <id>
```

**Arguments:**

| Argument | Description        |
| -------- | ------------------ |
| `<id>`   | Task ID (required) |

**Examples:**

```bash
pnpm aidy tasks get abc123
```

**Exit Codes:** `0` success, `1` error, `2` missing task ID

---

#### `tasks create`

Create a new task.

**Usage:**

```bash
aidy tasks create [title] [--description <desc>] [--priority <p>] [--planning]
```

**Arguments:**

| Argument  | Description                                                 |
| --------- | ----------------------------------------------------------- |
| `[title]` | Task title (optional — derived from description if omitted) |

**Options:**

| Option                 | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `--description <desc>` | Task description (required if no title)               |
| `--priority <p>`       | Priority: low, medium, high, urgent (default: medium) |
| `--planning`           | Enable planning agent to decompose into subtasks      |

**Examples:**

```bash
pnpm aidy tasks create "Fix login bug" --priority high
pnpm aidy tasks create --description "Implement the new API endpoint"
pnpm aidy tasks create "Plan database migration" --planning
```

**Exit Codes:** `0` success, `1` error, `2` invalid arguments

---

#### `tasks update`

Update a task's title, description, priority, or status.

**Usage:**

```bash
aidy tasks update <id> [--title <title>] [--description <desc>] [--priority <p>] [--status <s>]
```

**Arguments:**

| Argument | Description        |
| -------- | ------------------ |
| `<id>`   | Task ID (required) |

**Options:**

| Option                 | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `--title <title>`      | New task title                                              |
| `--description <desc>` | New task description                                        |
| `--priority <p>`       | Priority: low, medium, high, urgent                         |
| `--status <s>`         | Status: backlog, todo, in_progress, review, done, cancelled |

**Examples:**

```bash
pnpm aidy tasks update abc123 --priority high
pnpm aidy tasks update abc123 --status done
pnpm aidy tasks update abc123 --title "New title" --priority urgent
```

**Exit Codes:** `0` success, `1` error, `2` invalid arguments

---

#### `tasks delete`

Delete a task permanently.

**Usage:**

```bash
aidy tasks delete <id>
```

**Arguments:**

| Argument | Description        |
| -------- | ------------------ |
| `<id>`   | Task ID (required) |

**Examples:**

```bash
pnpm aidy tasks delete abc123
```

**Exit Codes:** `0` success, `1` error, `2` missing task ID

---

#### `tasks kanban`

Display all tasks grouped by status in Kanban board layout.

**Usage:**

```bash
aidy tasks kanban
```

**Examples:**

```bash
pnpm aidy tasks kanban
```

**Exit Codes:** `0` success, `1` error

---

### `subtasks` - Subtask Management

Commands for managing subtasks within a task.

---

#### `subtasks list`

List all subtasks for a specific task.

**Usage:**

```bash
aidy subtasks list <taskId>
```

**Arguments:**

| Argument   | Description        |
| ---------- | ------------------ |
| `<taskId>` | Task ID (required) |

**Examples:**

```bash
pnpm aidy subtasks list abc123
```

**Exit Codes:** `0` success, `1` error, `2` missing task ID

---

#### `subtasks complete`

Mark a subtask as completed.

**Usage:**

```bash
aidy subtasks complete <subtaskId> [--result <result>]
```

**Arguments:**

| Argument      | Description           |
| ------------- | --------------------- |
| `<subtaskId>` | Subtask ID (required) |

**Options:**

| Option         | Description                            |
| -------------- | -------------------------------------- |
| `--result <r>` | Completion result / summary (optional) |

**Examples:**

```bash
pnpm aidy subtasks complete abc123
pnpm aidy subtasks complete abc123 --result "API endpoint implemented and tested"
```

**Exit Codes:** `0` success, `1` error, `2` missing subtask ID

---

#### `subtasks fail`

Mark a subtask as failed.

**Usage:**

```bash
aidy subtasks fail <subtaskId> [--reason <reason>]
```

**Arguments:**

| Argument      | Description           |
| ------------- | --------------------- |
| `<subtaskId>` | Subtask ID (required) |

**Options:**

| Option         | Description                               |
| -------------- | ----------------------------------------- |
| `--reason <r>` | Failure reason / error message (optional) |

**Examples:**

```bash
pnpm aidy subtasks fail abc123
pnpm aidy subtasks fail abc123 --reason "API rate limit exceeded"
```

**Exit Codes:** `0` success, `1` error, `2` missing subtask ID

---

## Future Commands

The following commands are planned but not yet implemented:

- `devices show <request-id>` - Show detailed request information
- `admin token status` - Quick status check
- `config show` - Display current configuration

See [Extension Points](../../packages/cli/EXTENSION_POINTS.md) for details on adding new commands.
