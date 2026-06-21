# Bootstrap Admin Operator Guide

This guide explains how to manage the bootstrap-admin token used for OpenAidy administration.

## What is Bootstrap Admin?

Bootstrap admin is a special administrative token that provides elevated privileges for:

- Approving/denying device pairing requests
- Managing system configuration
- Performing administrative operations

The bootstrap-admin token is **local-first** - it's generated and stored on the server machine.

## Token Location

**Default Path:**

```
.openaidy/credentials/bootstrap-admin.json
```

This path is relative to the working directory where the OpenAidy server runs.

**View the path:**

```bash
pnpm openaidy admin token path
```

## Token Generation

### Automatic Generation (Install Path)

The canonical entry point is the install script, which calls `openaidy init`:

```bash
# Unix / macOS / WSL2
curl -fsSL https://openaidy.dev/install.sh | bash

# Or invoke init directly with a real JWT secret
WS_TOKEN_SECRET=$(openssl rand -hex 32) openaidy init
```

The installer generates a JWT signing secret at `$OPENAIDY_HOME/state/install.json` and runs `openaidy init` to mint a fresh token (or reuse a valid existing one). See the [Installation Guide](./installation.md) for the full flow.

### Server-Side Generation (Legacy)

The bootstrap-admin token can also be generated when the OpenAidy server starts for the first time (this remains the fallback when `openaidy init` hasn't been run):

```bash
# Start the server (generates token if missing)
pnpm --filter @openaidy/server start
```

### Token Contents

The token file contains a JSON Web Token (JWT) with:

- `clientId` - Unique identifier for the admin client
- `token` - The JWT token string
- `created` - Token creation timestamp
- `expires` - Token expiration timestamp
- `scopes` - Granted permission scopes

**Example:**

```json
{
  "clientId": "admin_abc123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "created": "2026-04-01T10:00:00Z",
  "expires": "2026-04-02T10:00:00Z",
  "scopes": ["admin", "pairing"]
}
```

## Token Status

The token can be in one of several states:

| Status      | Description                          |
| ----------- | ------------------------------------ |
| `valid`     | Token is active and usable           |
| `expired`   | Token has passed its expiration time |
| `missing`   | Token file does not exist            |
| `malformed` | Token file is not valid JSON         |
| `invalid`   | Token signature verification failed  |
| `disabled`  | Token has been explicitly disabled   |

### Checking Token Status

```bash
# Show full token info
pnpm openaidy admin token show

# Validate token
pnpm openaidy admin token validate
```

## Security Considerations

### ⚠️ Important Security Notes

1. **Keep the token secret** - The bootstrap-admin token has full administrative access
2. **File permissions** - Ensure the token file is readable only by the server process
3. **Local storage** - Token is stored locally, not transmitted over the network
4. **Expiration** - Tokens expire after a configurable time period

### File Permissions

Set appropriate permissions on the credentials directory:

```bash
# Restrict access to credentials
chmod 700 .openaidy/credentials
chmod 600 .openaidy/credentials/bootstrap-admin.json
```

### Token Rotation

Currently, token rotation is manual:

1. **Stop the server:**

   ```bash
   # Stop the running server
   ```

2. **Delete the old token:**

   ```bash
   rm .openaidy/credentials/bootstrap-admin.json
   ```

3. **Restart the server:**
   ```bash
   pnpm --filter @openaidy/server start
   ```

A new token will be generated automatically.

> **Future:** Automatic token rotation and revocation will be implemented in a future release.

## Common Operations

### Viewing Token Information

```bash
# Full token info
pnpm openaidy admin token show
```

Output:

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

### Validating Token

```bash
pnpm openaidy admin token validate
```

This command checks:

- Token file exists
- JSON is valid
- Signature is valid
- Token is not expired

### Getting Token Path

```bash
pnpm openaidy admin token path
```

Output:

```
.openaidy/credentials/bootstrap-admin.json
```

## Troubleshooting

### Token Not Found

**Error:** `Token file not found`

**Cause:** Server has not been started, or token file was deleted.

**Solution:** Start the server to generate a new token:

```bash
pnpm --filter @openaidy/server start
```

### Token Expired

**Error:** `Token is expired`

**Cause:** Token has passed its expiration time.

**Solution:** Generate a new token:

```bash
rm .openaidy/credentials/bootstrap-admin.json
pnpm --filter @openaidy/server start
```

### Token Malformed

**Error:** `Token is malformed`

**Cause:** Token file is corrupted or not valid JSON.

**Solution:** Regenerate the token:

```bash
rm .openaidy/credentials/bootstrap-admin.json
pnpm --filter @openaidy/server start
```

### Token Invalid

**Error:** `Token is invalid`

**Cause:** Token signature verification failed (file may have been tampered with).

**Solution:** Delete and regenerate:

```bash
rm .openaidy/credentials/bootstrap-admin.json
pnpm --filter @openaidy/server start
```

### Token Disabled

**Error:** `Token is disabled`

**Cause:** Token has been explicitly disabled in configuration.

**Solution:** Check server configuration and re-enable if appropriate.

## Configuration

Token behavior can be configured through environment variables:

| Variable                          | Description            | Default                                      |
| --------------------------------- | ---------------------- | -------------------------------------------- |
| `OPENAIDY_BOOTSTRAP_TOKEN_PATH`   | Custom token file path | `.openaidy/credentials/bootstrap-admin.json` |
| `OPENAIDY_BOOTSTRAP_TOKEN_EXPIRY` | Token expiration time  | `24h`                                        |

> **Note:** Configuration options may vary. Check server documentation for current options.

## Future Enhancements

The following features are planned for future releases:

- **Automatic rotation** - Periodic token rotation
- **Revocation** - Ability to revoke specific tokens
- **Multiple tokens** - Support for multiple admin tokens
- **Remote management** - Token management via CLI from remote machines
- **Audit logging** - Track token usage

## Related Documentation

- [CLI Getting Started](./getting-started.md)
- [Command Reference](./command-reference.md)
- [Architecture Guide](./architecture.md)
