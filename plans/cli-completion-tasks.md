# CLI Completion Tasks

> Branch: `feat/cli` (contains all `feat/ws` history)
> Status: CLI framework is solid, all command handlers are stubs

---

## Task 1: Add Missing Dependencies to CLI Package

### What

Add workspace dependencies so the CLI can import control-plane workflows, the SDK client, and config resolution.

### File to Modify

- [`packages/cli/package.json`](packages/cli/package.json)

### Current State

```json
"dependencies": {
  "@openaidy/server": "workspace:*"
}
```

### Expected Result

```json
"dependencies": {
  "@openaidy/server": "workspace:*",
  "@openaidy/control-plane": "workspace:*",
  "@openaidy/sdk": "workspace:*",
  "@openaidy/config": "workspace:*"
}
```

### After Editing

Run `pnpm install` to update the lockfile.

### Related Files

- [`packages/control-plane/package.json`](packages/control-plane/package.json) — exports `BootstrapAdminWorkflow`, `PairingWorkflow`
- [`packages/sdk/package.json`](packages/sdk/package.json) — exports `WebSocketClient`
- [`packages/config/package.json`](packages/config/package.json) — exports `app-config`, `env`

---

## Task 2: Create Server Connection Helper

### What

Create a shared utility that the `devices *` commands use to connect to the WebSocket server with the bootstrap-admin token.

### New File

- `packages/cli/src/lib/server-client.ts`

### Expected Result

A helper that:

1. Reads the bootstrap-admin token from `.openaidy/credentials/bootstrap-admin.json`
2. Resolves the WebSocket URL from env or config
3. Creates and connects a `WebSocketClient` instance
4. Returns the connected client for command use
5. Handles "server not running" gracefully with a user-friendly error

### Reusable Code / Imports

- [`WebSocketClient`](packages/sdk/src/websocket-client.ts:217) — the SDK client class
- [`WebSocketClientOptions`](packages/sdk/src/websocket-client.types.ts) — client options type
- [`BootstrapAdminRecord`](apps/server/src/bootstrap-admin.ts:6) — token file shape: `{ clientId, token, scopes, createdAt, expiresAt }`
- [`readFile`](../../node_modules/.pnpm/node_modules/@types/node/fs/promises.d.ts) from `node:fs/promises` — to read the credentials file
- [`resolve`](../../node_modules/.pnpm/node_modules/@types/node/path.d.ts) from `node:path` — to resolve the token path

### Pseudocode

```typescript
import { WebSocketClient } from '@openaidy/sdk';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_WS_URL = 'ws://localhost:3001/ws';
const DEFAULT_TOKEN_PATH = '.openaidy/credentials/bootstrap-admin.json';

export type ServerClientResult =
  | { ok: true; client: WebSocketClient; token: string }
  | { ok: false; error: string; exitCode: number };

export async function connectToServer(options?: {
  wsUrl?: string;
  tokenPath?: string;
}): Promise<ServerClientResult> {
  // 1. Resolve token path
  const tokenPath = options?.tokenPath ?? DEFAULT_TOKEN_PATH;

  // 2. Read and parse token file
  let raw: string;
  try {
    raw = await readFile(tokenPath, 'utf-8');
  } catch {
    return {
      ok: false,
      error: 'Bootstrap admin token not found. Run the server first.',
      exitCode: 1,
    };
  }

  const record = JSON.parse(raw); // BootstrapAdminRecord
  if (!record.token) {
    return { ok: false, error: 'Invalid token file.', exitCode: 1 };
  }

  // 3. Resolve WS URL
  const wsUrl = options?.wsUrl ?? process.env.OPENAIDY_WS_URL ?? DEFAULT_WS_URL;

  // 4. Create and connect client
  const client = new WebSocketClient({ url: wsUrl, token: record.token });
  try {
    await client.connect();
  } catch (err) {
    return {
      ok: false,
      error: `Cannot connect to server at ${wsUrl}. Is the server running?`,
      exitCode: 1,
    };
  }

  return { ok: true, client, token: record.token };
}
```

### Related Files

- [`apps/server/src/bootstrap-admin.ts`](apps/server/src/bootstrap-admin.ts) — defines `BootstrapAdminRecord` shape
- [`packages/sdk/src/websocket-client.ts`](packages/sdk/src/websocket-client.ts) — `WebSocketClient` constructor takes `{ url, token }`
- [`packages/sdk/src/websocket-client.types.ts`](packages/sdk/src/websocket-client.types.ts) — `WebSocketClientOptions` type

---

## Task 3: Wire `admin token show` Command

### What

Replace the hardcoded stub with a call to `BootstrapAdminWorkflow.inspectToken()`.

### File to Modify

- [`packages/cli/src/commands/index.ts`](packages/cli/src/commands/index.ts:148) — the `'admin token show'` handler

### Current Behavior

Returns hardcoded: `"Status: missing\nPath: .openaidy/credentials/bootstrap-admin.json\nEnabled: true\nError: Token file not found"`

### Expected Result

- Calls `BootstrapAdminWorkflow.inspectToken()`
- Renders the result as formatted terminal output
- Exit code 0 if token is valid, 1 otherwise

### Reusable Code / Imports

- [`BootstrapAdminWorkflow`](packages/control-plane/src/workflows/bootstrap-admin.ts:101) — the workflow class
- [`createBootstrapAdminWorkflow()`](packages/control-plane/src/workflows/bootstrap-admin.ts:268) — factory function
- [`BootstrapAdminContext`](packages/control-plane/src/workflows/bootstrap-admin.ts:50) — context type: `{ enabled, tokenPath, jwtSecret, logger? }`
- [`BootstrapAdminInspectResult`](packages/control-plane/src/types.ts:86) — result type: `{ success, data?: { status, tokenPath, enabled, record? }, error? }`
- [`BootstrapAdminTokenStatus`](packages/control-plane/src/types.ts:64) — `'disabled' | 'missing' | 'malformed' | 'invalid' | 'expired' | 'valid'`

### Implementation Pattern

```typescript
import { createBootstrapAdminWorkflow } from '@openaidy/control-plane';

// Inside the 'admin token show' handler:
const workflow = createBootstrapAdminWorkflow({
  enabled: true, // from config
  tokenPath: '.openaidy/credentials/bootstrap-admin.json', // from config
  jwtSecret: process.env.WS_TOKEN_SECRET ?? 'change-me-in-production',
});

const result = await workflow.inspectToken();

if (!result.success || !result.data) {
  return { exitCode: 1, error: result.error?.message ?? 'Unknown error' };
}

const { status, tokenPath, enabled, record } = result.data;

// Format output
let output = `Bootstrap Admin Token\n========================\n\n`;
output += `Status:    ${status}\n`;
output += `Path:      ${tokenPath}\n`;
output += `Enabled:   ${enabled}\n`;

if (record) {
  output += `Client ID: ${record.clientId}\n`;
  output += `Created:   ${record.createdAt}\n`;
  output += `Expires:   ${record.expiresAt}\n`;
  output += `Scopes:    ${record.scopes.join(', ')}\n`;
}

return {
  exitCode: status === 'valid' ? 0 : 1,
  output,
};
```

### Config Resolution

The `tokenPath` and `enabled` values should come from env or `@openaidy/config`. See:

- [`packages/config/src/env.ts`](packages/config/src/env.ts) — env parsing
- [`apps/server/src/lib/env.ts`](apps/server/src/lib/env.ts) — server env vars including `WS_TOKEN_SECRET`

### Related Files

- [`packages/control-plane/src/workflows/bootstrap-admin.ts`](packages/control-plane/src/workflows/bootstrap-admin.ts) — full workflow implementation
- [`packages/control-plane/src/workflows/bootstrap-admin.test.ts`](packages/control-plane/src/workflows/bootstrap-admin.test.ts) — test patterns to follow
- [`apps/server/src/bootstrap-admin.ts`](apps/server/src/bootstrap-admin.ts) — server-side token manager (creates the file the CLI reads)

---

## Task 4: Wire `admin token validate` Command

### What

Replace the stub with the same `BootstrapAdminWorkflow.inspectToken()` call, but with validate-specific output.

### File to Modify

- [`packages/cli/src/commands/index.ts`](packages/cli/src/commands/index.ts:188) — the `'admin token validate'` handler

### Current Behavior

Returns `"Token validation not yet implemented"`

### Expected Result

- Same workflow call as Task 3
- Exit code 0 only when `status === 'valid'`
- Output: `✓ Token is valid` or `✗ Token is <status>: <reason>`

### Reusable Code

Same as Task 3 — share the workflow creation logic. Consider extracting a helper:

```typescript
// packages/cli/src/lib/admin-workflow.ts
export function createAdminWorkflow() {
  return createBootstrapAdminWorkflow({
    enabled: true,
    tokenPath: resolveTokenPath(),
    jwtSecret: resolveJwtSecret(),
  });
}
```

### Related Files

- Same as Task 3

---

## Task 5: Wire `admin token path` Command

### What

Replace hardcoded path with config-resolved path.

### File to Modify

- [`packages/cli/src/commands/index.ts`](packages/cli/src/commands/index.ts:225) — the `'admin token path'` handler

### Current Behavior

Returns hardcoded `'.openaidy/credentials/bootstrap-admin.json'`

### Expected Result

- Resolves path from config/env
- Returns the resolved absolute or relative path

### Reusable Code

- Share the `resolveTokenPath()` helper from Task 3/4
- Or use `@openaidy/config` if it exposes token path configuration

---

## Task 6: Wire `devices list` Command

### What

Replace the stub with a real WebSocket call to list pending pairing requests.

### File to Modify

- [`packages/cli/src/commands/index.ts`](packages/cli/src/commands/index.ts:253) — the `'devices list'` handler

### Current Behavior

Returns `"No pending device pairing requests."`

### Expected Result

1. Connect to server using the helper from Task 2
2. Send `pairing.list` message
3. Render the list of pending requests as a table
4. Handle connection errors gracefully

### Reusable Code / Imports

- [`connectToServer()`](plans/cli-completion-tasks.md) — from Task 2
- [`WebSocketClient.sendRequest()`](packages/sdk/src/websocket-client.ts:403) — generic request method
- Server handler: [`PairingHandler.handleList()`](apps/server/src/websocket/handlers/pairing.ts) — returns `{ requests: PairingRequest[] }`
- [`PairingRequest`](apps/server/src/websocket/pairing-service.ts:24) — shape: `{ requestId, pairingCode, deviceName, deviceType, capabilities, status, requestedAt, expiresAt }`

### Implementation Pattern

```typescript
import { connectToServer } from '../lib/server-client';

// Inside the 'devices list' handler:
const connection = await connectToServer();
if (!connection.ok) {
  return { exitCode: connection.exitCode, error: connection.error };
}

const { client } = connection;

try {
  const response = await client.sendRequest('pairing.list', {});

  if (response.error) {
    return { exitCode: 1, error: `Error: ${response.error.message}` };
  }

  const requests = response.payload?.requests ?? [];

  if (requests.length === 0) {
    return { exitCode: 0, output: 'No pending device pairing requests.' };
  }

  let output = `Pending Device Pairing Requests (${requests.length})\n`;
  output += '─'.repeat(60) + '\n';
  for (const req of requests) {
    output += `  ID:       ${req.requestId}\n`;
    output += `  Code:     ${req.pairingCode}\n`;
    output += `  Device:   ${req.deviceName} (${req.deviceType})\n`;
    output += `  Caps:     ${req.capabilities.join(', ')}\n`;
    output += `  Expires:  ${new Date(req.expiresAt).toLocaleString()}\n`;
    output += '\n';
  }

  return { exitCode: 0, output };
} finally {
  client.destroy();
}
```

### Related Files

- [`apps/server/src/websocket/handlers/pairing.ts`](apps/server/src/websocket/handlers/pairing.ts) — server-side handler
- [`apps/server/src/websocket/pairing-service.ts`](apps/server/src/websocket/pairing-service.ts) — `getPendingRequests()`, `getAllRequests()`
- [`packages/sdk/src/websocket-client.ts`](packages/sdk/src/websocket-client.ts) — client SDK

---

## Task 7: Wire `devices approve <request-id>` Command

### What

Replace the stub with a real WebSocket call to approve a pairing request.

### File to Modify

- [`packages/cli/src/commands/index.ts`](packages/cli/src/commands/index.ts:282) — the `'devices approve'` handler

### Current Behavior

Returns `"Device pairing approval not yet implemented. Request ID: ${args[0]}"`

### Expected Result

1. Validate `args[0]` is present (already done)
2. Connect to server using helper from Task 2
3. Send `pairing.approve` with `{ requestId: args[0] }`
4. Render success/failure
5. Handle connection errors gracefully

### ⚠️ Important: SDK Mismatch (Task 9)

The current SDK [`approvePairing()`](packages/sdk/src/websocket-client.ts:680) sends `{ code }` but the server expects `{ requestId }`. Until Task 9 is done, use `client.sendRequest('pairing.approve', { requestId })` directly instead of `client.approvePairing()`.

### Reusable Code / Imports

- [`connectToServer()`](plans/cli-completion-tasks.md) — from Task 2
- Server handler: [`PairingHandler.handleApprove()`](apps/server/src/websocket/handlers/pairing.ts:176) — expects `{ requestId, scopes? }`
- Response: [`PairingApprovedResponse`](apps/server/src/websocket/handlers/pairing.ts:62) — `{ requestId, nodeId, token, scopes, approvedAt }`

### Implementation Pattern

```typescript
const connection = await connectToServer();
if (!connection.ok) {
  return { exitCode: connection.exitCode, error: connection.error };
}

const { client } = connection;
const requestId = args[0];

try {
  const response = await client.sendRequest('pairing.approve', { requestId });

  if (response.error) {
    return { exitCode: 1, error: `Error: ${response.error.message}` };
  }

  const data = response.payload;
  return {
    exitCode: 0,
    output: `✓ Device pairing approved\n  Request: ${data.requestId}\n  Node:    ${data.nodeId}\n  Scopes:  ${data.scopes.join(', ')}`,
  };
} finally {
  client.destroy();
}
```

### Related Files

- [`apps/server/src/websocket/handlers/pairing.ts`](apps/server/src/websocket/handlers/pairing.ts:176) — server handler
- [`apps/server/src/websocket/pairing-service.ts`](apps/server/src/websocket/pairing-service.ts:260) — `approveRequest()`

---

## Task 8: Wire `devices deny <request-id>` Command

### What

Replace the stub with a real WebSocket call to deny a pairing request.

### File to Modify

- [`packages/cli/src/commands/index.ts`](packages/cli/src/commands/index.ts:322) — the `'devices deny'` handler

### Current Behavior

Returns `"Device pairing denial not yet implemented. Request ID: ${args[0]}"`

### Expected Result

Same pattern as Task 7 but sends `pairing.deny` with `{ requestId }`.

### Reusable Code / Imports

- [`connectToServer()`](plans/cli-completion-tasks.md) — from Task 2
- Server handler: [`PairingHandler.handleDeny()`](apps/server/src/websocket/handlers/pairing.ts) — expects `{ requestId }`
- Response: [`PairingDeniedResponse`](apps/server/src/websocket/handlers/pairing.ts:70) — `{ requestId, deniedAt }`

### Related Files

- Same as Task 7

---

## Task 9: Fix SDK ↔ Server Pairing Mismatch

### What

The SDK's `approvePairing()` and `denyPairing()` methods send a pairing `code`, but the server's handler expects a `requestId`. Both should be supported.

### Files to Modify

- [`packages/sdk/src/websocket-client.ts`](packages/sdk/src/websocket-client.ts:660) — pairing methods
- [`packages/sdk/src/websocket-client.types.ts`](packages/sdk/src/websocket-client.types.ts) — add new option types if needed

### Current State

**SDK** ([line 680](packages/sdk/src/websocket-client.ts:680)):

```typescript
async approvePairing(code: string, capabilities?: string[]): Promise<WSResponse> {
  return this.sendRequest('pairing.approve', { code, capabilities });
}
```

**Server** ([pairing.ts:37](apps/server/src/websocket/handlers/pairing.ts:37)):

```typescript
export type PairingApproveRequest = WSMessage<
  'pairing.approve',
  {
    requestId: string; // ← expects requestId, not code
    scopes?: string[];
  }
>;
```

### Expected Result

Option A (recommended): Update SDK methods to accept both:

```typescript
async approvePairing(options: { requestId?: string; code?: string; scopes?: string[] }): Promise<WSResponse> {
  return this.sendRequest('pairing.approve', {
    requestId: options.requestId,
    code: options.code,
    scopes: options.scopes,
  });
}
```

Option B: Update server handler to also accept `code` and resolve to `requestId`.

### Related Files

- [`apps/server/src/websocket/handlers/pairing.ts`](apps/server/src/websocket/handlers/pairing.ts:176) — server approve handler
- [`apps/server/src/websocket/pairing-service.ts`](apps/server/src/websocket/pairing-service.ts:394) — `getRequestByCode()` for code→requestId resolution
- [`packages/sdk/src/websocket-client.ts`](packages/sdk/src/websocket-client.ts:660) — all pairing methods

---

## Task 10: Add Server URL Resolution

### What

Provide a way for the CLI to discover the WebSocket server URL.

### Files to Modify

- [`packages/cli/src/lib/server-client.ts`](plans/cli-completion-tasks.md) — the helper from Task 2
- Possibly [`packages/config/src/env.ts`](packages/config/src/env.ts) — if adding env var parsing

### Expected Result

Resolution order:

1. `OPENAIDY_WS_URL` env var (explicit override)
2. Config from `@openaidy/config` (if it exposes WS settings)
3. Default: `ws://localhost:3001/ws`

### Related Files

- [`apps/server/src/lib/env.ts`](apps/server/src/lib/env.ts) — server env vars (`WS_PORT`, `WS_PATH`)
- [`packages/config/src/env.ts`](packages/config/src/env.ts) — config package env parsing
- [`apps/server/src/websocket/types.ts`](apps/server/src/websocket/types.ts:124) — `wsEnvSchema` with all WS env vars

---

## Task 11: Add Tests for Wired Commands

### What

Add/update tests for the newly wired command handlers.

### Files to Modify

- [`packages/cli/src/registry.test.ts`](packages/cli/src/registry.test.ts) — existing integration tests
- New: `packages/cli/src/commands/admin.test.ts` — unit tests for admin commands
- New: `packages/cli/src/commands/devices.test.ts` — unit tests for device commands
- New: `packages/cli/src/lib/server-client.test.ts` — tests for connection helper

### Test Patterns to Follow

- [`packages/control-plane/src/workflows/bootstrap-admin.test.ts`](packages/control-plane/src/workflows/bootstrap-admin.test.ts) — mocks file system with temp dirs
- [`packages/sdk/src/websocket-client.test.ts`](packages/sdk/src/websocket-client.test.ts) — mocks WebSocket
- [`packages/cli/src/registry.test.ts`](packages/cli/src/registry.test.ts:1) — integration tests via `execFile('tsx', [cliPath])`

---

## Execution Order

```
Task 1  (deps)          ──→  Task 2  (server-client helper)
                              │
                              ├──→ Task 6  (devices list)
                              ├──→ Task 7  (devices approve)
                              ├──→ Task 8  (devices deny)
                              └──→ Task 10 (URL resolution, refine helper)

Task 1  (deps)          ──→  Task 3  (admin token show)
                              ├──→ Task 4  (admin token validate)
                              └──→ Task 5  (admin token path)

Task 9  (SDK mismatch)  ──→  can be done in parallel, but SDK changes affect Task 7/8

Task 11 (tests)         ──→  after all tasks complete
```

**Recommended sequence:** 1 → 2 → 10 → 3 → 4 → 5 → 9 → 6 → 7 → 8 → 11
