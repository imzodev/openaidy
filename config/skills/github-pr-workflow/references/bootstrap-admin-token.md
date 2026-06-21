# Bootstrap-Admin Token Pattern

How to read the bootstrap-admin token for CLI → server HTTP calls, and the pattern for sharing that read logic across multiple command handlers.

## The Problem

Many CLI commands need to call the server's REST API. They all need the same thing: read the bootstrap-admin token file and use it as a Bearer token. Duplicating this logic in every handler creates maintenance burden and inconsistent error messages.

## The Solution

Extract token reading into a single shared helper.

### 1. Create `lib/admin-token.ts`

```typescript
import { readFile } from 'node:fs/promises';

type BootstrapAdminRecord = {
  clientId: string;
  token: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

export type ReadAdminTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

export async function readAdminToken(
  tokenPath: string,
): Promise<ReadAdminTokenResult> {
  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch {
    return {
      ok: false,
      error: `Bootstrap admin token not found at ${tokenPath}.\nMake sure the server has been started at least once.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: `Token file at ${tokenPath} contains invalid JSON.`,
    };
  }

  const record = parsed as Partial<BootstrapAdminRecord>;
  if (typeof record.token !== 'string') {
    return {
      ok: false,
      error: `Token file at ${tokenPath} has invalid structure.`,
    };
  }

  return { ok: true, token: record.token };
}
```

### 2. Use in command handlers

```typescript
import { readAdminToken } from '../../lib/admin-token.js';
import { resolveCLIConfig } from '../../lib/config.js';

export async function myCommandHandler(args: string[]): Promise<CommandResult> {
  const config = resolveCLIConfig();
  const token = await readAdminToken(config.tokenPath);
  if (!token.ok) {
    p.log.error(token.error);
    return { exitCode: 1, error: token.error };
  }

  const res = await fetch(`${config.httpUrl}/api/some-endpoint`, {
    headers: { Authorization: `Bearer ${token.token}` },
  });
  // ...
}
```

### 3. Deduplicate in `server-client.ts` (WebSocket commands)

If you already have a `server-client.ts` that creates a `WebSocketClient` using the token, refactor it to import `readAdminToken` from the shared helper instead of reading the file inline:

```typescript
// BEFORE: server-client.ts reads the token itself (duplicated logic)
async function readAdminToken(tokenPath: string) {
  // 30 lines of file reading + validation
}

// AFTER: delegate to shared helper
import { readAdminToken } from './admin-token.js';
const tokenResult = await readAdminToken(config.tokenPath);
if (!tokenResult.ok) {
  return { ok: false, error: tokenResult.error, exitCode: 1 };
}
const { token } = tokenResult;
```

## Key Design Points

- **`ReadAdminTokenResult` discriminated union** — `{ ok: true; token } | { ok: false; error }` — makes the error path explicit and avoids throwing
- **Only return what callers need** — the token string, not the full `BootstrapAdminRecord` — avoids coupling to server-side record shape
- **Human-readable errors** — include the token path in the error so users know what to fix
- **`resolveCLIConfig()`** from `lib/config.js` gives the `httpUrl` and `tokenPath` — always use it rather than hardcoding URLs

## Token File Location

Default: `.openaidy/credentials/bootstrap-admin.json` (resolved from `BOOTSTRAP_ADMIN_TOKEN_PATH` env var or the default)

The token file structure:

```json
{
  "clientId": "...",
  "token": "b64-encoded-jwt...",
  "scopes": ["*"],
  "createdAt": "...",
  "expiresAt": "..."
}
```

CLI only needs the `token` field.
