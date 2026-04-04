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

| Code | Name | Description |
|------|------|-------------|
| 0 | SUCCESS | Command completed successfully |
| 1 | ERROR | General error |
| 2 | INVALID_ARGS | Invalid or missing arguments |
| 3 | NOT_FOUND | Resource not found |
| 4 | PERMISSION_DENIED | Insufficient permissions |
| 5 | CONFIG_ERROR | Configuration error |

## Help System

### Global Help
```bash
openaidy --help
openaidy help
```

### Group Help
```bash
openaidy admin --help
openaidy devices --help
```

### Command Help
```bash
openaidy admin token show --help
openaidy devices list --help
openaidy devices approve --help
openaidy devices deny --help
```

## Future Commands

The following commands are planned but not yet implemented:

- `devices show <request-id>` - Show detailed request information
- `admin token status` - Quick status check
- `config show` - Display current configuration

See [Extension Points](../packages/cli/EXTENSION_POINTS.md) for details on adding new commands.
