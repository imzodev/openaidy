# CLI Getting Started Guide

This guide helps you get started with the OpenAidy CLI for local administration.

## Prerequisites

- Node.js 18+ 
- pnpm (or npm/yarn)
- OpenAidy repository cloned

## Installation

### Repo-Local Execution (Current)

The CLI runs directly from the monorepo without global installation:

```bash
# Navigate to repository root
cd openaidy

# Run CLI via pnpm
pnpm openaidy --help
```

### Future: Global Installation

After the package is published to npm:

```bash
# Install globally
npm install -g @openaidy/cli

# Run from anywhere
openaidy --help
```

## Initial Setup

### 1. Bootstrap Admin Token

The CLI requires a bootstrap-admin token for administrative operations.

**Token Location:**
```
.openaidy/credentials/bootstrap-admin.json
```

**Generate a token:**
```bash
# Start the OpenAidy server (generates token on first run)
pnpm --filter @openaidy/server start
```

**Verify token:**
```bash
pnpm openaidy admin token show
```

### 2. Verify Installation

```bash
# Check version
pnpm openaidy --version

# View help
pnpm openaidy --help

# List available commands
pnpm openaidy help
```

## Common Operations

### Listing Device Pairing Requests

When a new device attempts to pair with your OpenAidy server, it creates a pairing request:

```bash
# List all pending requests
pnpm openaidy devices list

# List all requests (any status)
pnpm openaidy devices list --status all

# List approved requests
pnpm openaidy devices list --status approved

# Limit results
pnpm openaidy devices list --limit 10
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
pnpm openaidy devices approve req_abc123

# Approve with custom scopes
pnpm openaidy devices approve req_abc123 --scopes chat,files,calendar
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
pnpm openaidy devices deny req_def456
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
pnpm openaidy admin token show

# Show token file path
pnpm openaidy admin token path

# Validate token
pnpm openaidy admin token validate
```

## Troubleshooting

### "Token file not found"

**Cause:** Bootstrap-admin token hasn't been generated.

**Solution:** Start the OpenAidy server to generate the token:
```bash
pnpm --filter @openaidy/server start
```

### "Token is expired"

**Cause:** The bootstrap-admin token has passed its expiration time.

**Solution:** Restart the server to generate a new token, or delete the old token file first:
```bash
rm .openaidy/credentials/bootstrap-admin.json
pnpm --filter @openaidy/server start
```

### "No pending requests"

**Cause:** No devices have requested pairing, or all requests have been processed.

**Solution:** Check all request statuses:
```bash
pnpm openaidy devices list --status all
```

### "Request not found"

**Cause:** The specified request ID doesn't exist or has already been processed.

**Solution:** List current requests to find valid IDs:
```bash
pnpm openaidy devices list
```

### "Request already approved/denied"

**Cause:** The request has already been processed.

**Solution:** No action needed - the request is in its final state.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Not found |
| 4 | Permission denied |
| 5 | Configuration error |

## Next Steps

- Read the [Command Reference](./command-reference.md) for detailed command documentation
- Learn about [Bootstrap Admin](./bootstrap-admin.md) token management
- Understand the [Architecture](./architecture.md) for contributing
