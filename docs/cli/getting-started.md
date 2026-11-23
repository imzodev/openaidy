# CLI Getting Started Guide

This guide helps you get started with the Aidy CLI for local administration.

## Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- Aidy repository cloned

## Installation

### Repo-Local Execution (Current)

The CLI runs directly from the monorepo without global installation:

```bash
# Navigate to repository root
cd aidy

# Run CLI via pnpm
pnpm aidy --help
```

### Future: Global Installation

After the package is published to npm:

```bash
# Install globally
npm install -g @aidyagent/cli

# Run from anywhere
aidy --help
```

## Initial Setup

### 1. Bootstrap Admin Token

The CLI requires a bootstrap-admin token for administrative operations.

**Token Location:**

```
$AIDY_HOME/credentials/bootstrap-admin.json
# or, when AIDY_HOME is unset:
.aidy/credentials/bootstrap-admin.json
```

**Generate a token (the canonical entry point):**

```bash
# Re-run the installer (Unix/WSL/macOS)
curl -fsSL https://aidyagent.app/install.sh | bash

# Or run the CLI's init command directly (idempotent)
WS_TOKEN_SECRET=$(openssl rand -hex 32) aidy init
```

`aidy init` prints the token to stdout in a parseable format:

```
Bootstrap admin token: <jwt>
```

You can paste this token into the web UI's login screen on first use. See the [Installation Guide](./installation.md) for the full turnkey install flow.

```bash
# Start the Aidy server (generates token on first run)
pnpm --filter @aidyagent/server start
```

**Verify token:**

```bash
pnpm aidy admin token show
```

### 2. Verify Installation

```bash
# Check version
pnpm aidy --version

# View help
pnpm aidy --help

# List available commands
pnpm aidy help
```

## Common Operations

### Managing Access Tokens

Access tokens are used to log in to the Aidy web UI and to authenticate API requests. They require the server to be running with a database.

```bash
# Create a full-admin token
pnpm aidy tokens create --name "My Token" --scopes "*"

# Create a scoped token for CI
pnpm aidy tokens create --name "CI Pipeline" --scopes "sessions.read,sessions.stream"

# List all tokens
pnpm aidy tokens list

# Revoke a token by ID
pnpm aidy tokens revoke <id>
```

**Expected Output (create):**

```
Access token created
====================

  Name:    My Token
  ID:      a1b2c3d4-e5f6-...
  Scopes:  *

Token (shown once — save it now):

  oat_a1b2c3d4e5f6...

Use this token to log into the UI or authenticate API requests.
```

> **Important:** The raw `oat_…` token is displayed exactly once. Store it securely — if you lose it, revoke and recreate it.

---

### Listing Device Pairing Requests

When a new device attempts to pair with your Aidy server, it creates a pairing request:

```bash
# List all pending requests
pnpm aidy devices list

# List all requests (any status)
pnpm aidy devices list --status all

# List approved requests
pnpm aidy devices list --status approved

# Limit results
pnpm aidy devices list --limit 10
```

**Expected Output:**

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

### Approving a Device

```bash
# Approve with default scopes
pnpm aidy devices approve req_abc123

# Approve with custom scopes
pnpm aidy devices approve req_abc123 --scopes chat,files,calendar
```

**Expected Output:**

```
✓ Request approved

ID:        req_abc123
Device:    iPhone 15 Pro
Status:    approved
Scopes:    chat, files, calendar
Approved:  2026-04-01 14:35:00
```

### Denying a Device

```bash
pnpm aidy devices deny req_def456
```

**Expected Output:**

```
✓ Request denied

ID:        req_def456
Device:    MacBook Pro
Status:    denied
Denied:    2026-04-01 14:36:00
```

### Checking Bootstrap Admin Token

```bash
# Show token info
pnpm aidy admin token show

# Show token file path
pnpm aidy admin token path

# Validate token
pnpm aidy admin token validate
```

## Troubleshooting

### "Cannot reach server"

**Cause:** The `tokens` commands require the server to be running.

**Solution:** Start the server first:

```bash
pnpm --filter @aidyagent/server dev
```

If the server runs on a non-default port, set:

```bash
AIDY_SERVER_URL=http://localhost:4000 pnpm aidy tokens list
```

### "Server returned 401"

**Cause:** The bootstrap-admin token has expired.

**Solution:** Restart the server to regenerate it.

---

### "Token file not found"

**Cause:** Bootstrap-admin token hasn't been generated.

**Solution:** Start the Aidy server to generate the token:

```bash
pnpm --filter @aidyagent/server start
```

### "Token is expired"

**Cause:** The bootstrap-admin token has passed its expiration time.

**Solution:** Restart the server to generate a new token, or delete the old token file first:

```bash
rm .aidy/credentials/bootstrap-admin.json
pnpm --filter @aidyagent/server start
```

### "No pending requests"

**Cause:** No devices have requested pairing, or all requests have been processed.

**Solution:** Check all request statuses:

```bash
pnpm aidy devices list --status all
```

### "Request not found"

**Cause:** The specified request ID doesn't exist or has already been processed.

**Solution:** List current requests to find valid IDs:

```bash
pnpm aidy devices list
```

### "Request already approved/denied"

**Cause:** The request has already been processed.

**Solution:** No action needed - the request is in its final state.

## Exit Codes

| Code | Meaning             |
| ---- | ------------------- |
| 0    | Success             |
| 1    | General error       |
| 2    | Invalid arguments   |
| 3    | Not found           |
| 4    | Permission denied   |
| 5    | Configuration error |

## Next Steps

- Read the [Command Reference](./command-reference.md) for detailed command documentation
- Learn about [Bootstrap Admin](./bootstrap-admin.md) token management
- Understand the [Architecture](../../plans/cli/architecture.md) for contributing
