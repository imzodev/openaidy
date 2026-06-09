# CLI Command Reference

Complete reference for all OpenAidy CLI commands.

## Global Options

```bash
openaidy [options]

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
openaidy admin token show
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
pnpm openaidy admin token show
```

**Sample Output (Valid Token):**

```
Bootstrap Admin Token
========================

Status:    valid
Path:      .openaidy/credentials/bootstrap-admin.json
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
Path:      .openaidy/credentials/bootstrap-admin.json
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
openaidy admin token validate
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
pnpm openaidy admin token validate
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
openaidy admin token path
```

**Arguments:** None

**Options:** None

**Description:**

Outputs the file path where the bootstrap-admin token is stored.

**Examples:**

```bash
pnpm openaidy admin token path
```

**Output:**

```
.openaidy/credentials/bootstrap-admin.json
```

**Exit Codes:**
| Code | Condition |
|------|-----------|
| 0 | Always succeeds |

---

### `tokens` - Access Token Management

Commands for creating and managing access tokens used for UI login and API access.

> **Requires:** Server running with a database (`DB_KIND=sqlite` or `DB_KIND=postgres`). Uses the bootstrap-admin token from `.openaidy/credentials/bootstrap-admin.json`.

---

#### `tokens list`

List all access tokens.

**Usage:**

```bash
openaidy tokens list
```

**Arguments:** None

**Options:** None

**Description:**

Displays all access tokens grouped into active and revoked. Does not expose raw token values or hashes — only the prefix, name, scopes, and usage metadata.

**Examples:**

```bash
pnpm openaidy tokens list
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
openaidy tokens create --name <name> --scopes <scopes> [--expires <date>]
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

The token can be used to log in to the OpenAidy web UI or to authenticate REST/WebSocket API requests.

**Examples:**

```bash
# Create a full-admin token
pnpm openaidy tokens create --name "Admin Key" --scopes "*"

# Create a read-only CI token
pnpm openaidy tokens create --name "CI Pipeline" --scopes "sessions.read,sessions.stream"

# Create a temporary token that expires end of year
pnpm openaidy tokens create --name "Temp Access" --scopes "sessions.read" --expires "2026-12-31"
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
openaidy tokens revoke <id>
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
pnpm openaidy tokens revoke a1b2c3d4-e5f6-...
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
openaidy devices list [options]
```

**Arguments:** None

**Options:**
| Option | Value | Default | Description |
|--------|-------|---------|-------------|
| `--status` | `pending`, `approved`, `denied`, `expired`, `all` | `pending` | Filter by request status |
| `--limit` | `<number>` | No limit | Maximum number of results |

**Description:**

Lists pairing requests from devices attempting to connect to the OpenAidy server.

**Examples:**

```bash
# List pending requests (default)
pnpm openaidy devices list

# List all requests
pnpm openaidy devices list --status all

# List approved requests
pnpm openaidy devices list --status approved

# Limit to 10 results
pnpm openaidy devices list --limit 10

# Combine filters
pnpm openaidy devices list --status expired --limit 20
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
openaidy devices approve <request-id> [options]
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
pnpm openaidy devices approve req_abc123

# Approve with custom scopes
pnpm openaidy devices approve req_abc123 --scopes chat,files,calendar

# Approve with minimal scopes
pnpm openaidy devices approve req_abc123 --scopes chat
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
openaidy devices deny <request-id>
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
pnpm openaidy devices deny req_def456
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
openaidy --help
openaidy help
```

### Group Help

```bash
openaidy admin --help
openaidy tokens --help
openaidy devices --help
```

### Command Help

```bash
openaidy admin token show --help
openaidy tokens list --help
openaidy tokens create --help
openaidy tokens revoke --help
openaidy devices list --help
openaidy devices approve --help
openaidy devices deny --help
```

## Environment Variables

The CLI reads configuration from environment variables (compatible with the server's `.env` file):

| Variable                     | Default                                      | Description                                                  |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `OPENAIDY_SERVER_URL`        | `http://localhost:3001`                      | HTTP base URL for REST API calls (used by `tokens` commands) |
| `OPENAIDY_WS_URL`            | `ws://localhost:3001/ws`                     | WebSocket URL (used by `devices` commands)                   |
| `BOOTSTRAP_ADMIN_TOKEN_PATH` | `.openaidy/credentials/bootstrap-admin.json` | Path to the admin token file                                 |
| `PORT`                       | `3001`                                       | Fallback for deriving `OPENAIDY_SERVER_URL`                  |
| `WS_PORT`                    | `3001`                                       | Fallback for deriving `OPENAIDY_WS_URL`                      |
| `WS_PATH`                    | `/ws`                                        | WebSocket path suffix                                        |

### `addon` - Addon Development Tools

Commands for creating, building, testing, and publishing OpenAidy addons.

---

#### `addon install`

Register a built addon with the local OpenAidy server. Run from inside your addon directory after building.

**Usage:**

```bash
openaidy addon install [--server-url <url>] [--token <token>]
```

**Examples:**

```bash
pnpm openaidy addon install
pnpm openaidy addon install --server-url http://localhost:3001
```

---

#### `addon create`

Create a new addon project from a template.

**Usage:**

```bash
openaidy addon create <name> [--template <template>] [--directory <dir>] [--no-git] [--no-install]
```

**Examples:**

```bash
pnpm openaidy addon create my-addon
pnpm openaidy addon create my-addon --template agent
```

---

#### `addon init`

Initialize an existing project as an addon.

**Usage:**

```bash
openaidy addon init [--force]
```

**Examples:**

```bash
pnpm openaidy addon init
```

---

#### `addon build`

Build addon for production.

**Usage:**

```bash
openaidy addon build [--watch] [--minify] [--sourcemap]
```

**Examples:**

```bash
pnpm openaidy addon build
pnpm openaidy addon build --minify
```

---

#### `addon test`

Run addon tests.

**Usage:**

```bash
openaidy addon test [--watch] [--coverage] [--ui] [--filter <pattern>]
```

**Examples:**

```bash
pnpm openaidy addon test
pnpm openaidy addon test --coverage
```

---

#### `addon validate`

Validate addon package and manifest.

**Usage:**

```bash
openaidy addon validate [--package] [--verbose] [--strict]
```

**Examples:**

```bash
pnpm openaidy addon validate
pnpm openaidy addon validate --verbose
```

---

#### `addon dev`

Start development server with hot-reloading.

**Usage:**

```bash
openaidy addon dev [--port <port>] [--host <host>] [--openaidy-url <url>]
```

**Examples:**

```bash
pnpm openaidy addon dev
pnpm openaidy addon dev --port 3001
```

---

#### `addon publish`

Publish addon to the registry.

**Usage:**

```bash
openaidy addon publish [--tag <tag>] [--registry <url>] [--access <access>]
```

**Examples:**

```bash
pnpm openaidy addon publish
pnpm openaidy addon publish --tag beta
```

---

#### `addon templates`

List available addon project templates.

**Usage:**

```bash
openaidy addon templates
```

**Examples:**

```bash
pnpm openaidy addon templates
```

---

### `agents` - Agent Management

Commands for creating and managing agents and their workspaces.

---

#### `agents list`

List all configured agents.

**Usage:**

```bash
openaidy agents list
```

**Examples:**

```bash
pnpm openaidy agents list
```

---

#### `agents create`

Create a new agent with its own workspace directory.

**Usage:**

```bash
openaidy agents create [<name>] [--id <id>] [--description <desc>]
```

**Examples:**

```bash
pnpm openaidy agents create
pnpm openaidy agents create "Research Assistant"
pnpm openaidy agents create --name "Research Assistant" --description "Helps with research"
```

---

#### `agents delete`

Delete an agent from the configuration. Requires typing the agent ID to confirm.

**Usage:**

```bash
openaidy agents delete [<id>]
```

**Examples:**

```bash
pnpm openaidy agents delete
pnpm openaidy agents delete my-agent
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
openaidy tasks list [--status <status>] [--limit <n>]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--status <status>` | Filter by status: backlog, todo, in_progress, review, done, cancelled |
| `--limit <n>` | Limit number of results (default: 50) |

**Examples:**

```bash
pnpm openaidy tasks list
pnpm openaidy tasks list --status in_progress
pnpm openaidy tasks list --limit 10
```

**Exit Codes:** `0` success, `1` error, `2` invalid arguments

---

#### `tasks get`

Get full details for a specific task.

**Usage:**

```bash
openaidy tasks get <id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>` | Task ID (required) |

**Examples:**

```bash
pnpm openaidy tasks get abc123
```

**Exit Codes:** `0` success, `1` error, `2` missing task ID

---

#### `tasks create`

Create a new task.

**Usage:**

```bash
openaidy tasks create [title] [--description <desc>] [--priority <p>] [--planning]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[title]` | Task title (optional — derived from description if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--description <desc>` | Task description (required if no title) |
| `--priority <p>` | Priority: low, medium, high, urgent (default: medium) |
| `--planning` | Enable planning agent to decompose into subtasks |

**Examples:**

```bash
pnpm openaidy tasks create "Fix login bug" --priority high
pnpm openaidy tasks create --description "Implement the new API endpoint"
pnpm openaidy tasks create "Plan database migration" --planning
```

**Exit Codes:** `0` success, `1` error, `2` invalid arguments

---

#### `tasks update`

Update a task's title, description, priority, or status.

**Usage:**

```bash
openaidy tasks update <id> [--title <title>] [--description <desc>] [--priority <p>] [--status <s>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>` | Task ID (required) |

**Options:**

| Option | Description |
|--------|-------------|
| `--title <title>` | New task title |
| `--description <desc>` | New task description |
| `--priority <p>` | Priority: low, medium, high, urgent |
| `--status <s>` | Status: backlog, todo, in_progress, review, done, cancelled |

**Examples:**

```bash
pnpm openaidy tasks update abc123 --priority high
pnpm openaidy tasks update abc123 --status done
pnpm openaidy tasks update abc123 --title "New title" --priority urgent
```

**Exit Codes:** `0` success, `1` error, `2` invalid arguments

---

#### `tasks delete`

Delete a task permanently.

**Usage:**

```bash
openaidy tasks delete <id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>` | Task ID (required) |

**Examples:**

```bash
pnpm openaidy tasks delete abc123
```

**Exit Codes:** `0` success, `1` error, `2` missing task ID

---

#### `tasks kanban`

Display all tasks grouped by status in Kanban board layout.

**Usage:**

```bash
openaidy tasks kanban
```

**Examples:**

```bash
pnpm openaidy tasks kanban
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
openaidy subtasks list <taskId>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<taskId>` | Task ID (required) |

**Examples:**

```bash
pnpm openaidy subtasks list abc123
```

**Exit Codes:** `0` success, `1` error, `2` missing task ID

---

#### `subtasks complete`

Mark a subtask as completed.

**Usage:**

```bash
openaidy subtasks complete <subtaskId> [--result <result>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<subtaskId>` | Subtask ID (required) |

**Options:**

| Option | Description |
|--------|-------------|
| `--result <r>` | Completion result / summary (optional) |

**Examples:**

```bash
pnpm openaidy subtasks complete abc123
pnpm openaidy subtasks complete abc123 --result "API endpoint implemented and tested"
```

**Exit Codes:** `0` success, `1` error, `2` missing subtask ID

---

#### `subtasks fail`

Mark a subtask as failed.

**Usage:**

```bash
openaidy subtasks fail <subtaskId> [--reason <reason>]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<subtaskId>` | Subtask ID (required) |

**Options:**

| Option | Description |
|--------|-------------|
| `--reason <r>` | Failure reason / error message (optional) |

**Examples:**

```bash
pnpm openaidy subtasks fail abc123
pnpm openaidy subtasks fail abc123 --reason "API rate limit exceeded"
```

**Exit Codes:** `0` success, `1` error, `2` missing subtask ID

---

## Future Commands

The following commands are planned but not yet implemented:

- `devices show <request-id>` - Show detailed request information
- `admin token status` - Quick status check
- `config show` - Display current configuration

See [Extension Points](../packages/cli/EXTENSION_POINTS.md) for details on adding new commands.
