# CLI Architecture Guide

This guide explains the CLI architecture and package boundaries for contributors.

## Overview

The OpenAidy CLI follows a layered architecture that separates concerns:

- **CLI Layer** - Command parsing, help output, user interaction
- **Control Plane** - Shared workflow logic, domain operations
- **Server Layer** - HTTP/WebSocket server, persistence, real-time communication

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Package                             │
│  (@openaidy/cli)                                            │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  Commands   │  │  Formatters │  │   Errors    │         │
│  │  Registry   │  │             │  │             │         │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘         │
└─────────┼────────────────┼──────────────────────────────────┘
          │                │
          ▼                │
┌─────────────────────────┼──────────────────────────────────┐
│                 Control Plane                               │
│  (@openaidy/control-plane)                                 │
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │  PairingWorkflow │  │ BootstrapAdmin   │               │
│  │                  │  │   Workflow       │               │
│  └────────┬─────────┘  └────────┬─────────┘               │
│           │                     │                          │
│  ┌────────┴─────────────────────┴────────┐                │
│  │           Workflow Types              │                │
│  │   (WorkflowResult, WorkflowError)     │                │
│  └───────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
          │                     │
          ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     Server Package                          │
│  (@openaidy/server)                                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Fastify    │  │   Pairing    │  │   Persistence│     │
│  │    Server    │  │   Service    │  │   (SQLite)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Package Responsibilities

### `@openaidy/cli` - CLI Package

**Purpose:** Command-line interface for local administration.

**Responsibilities:**

- Parse command-line arguments
- Route to appropriate command handlers
- Format output for terminal
- Display help and usage information
- Handle exit codes

**NOT Responsible For:**

- Business logic (use control-plane)
- Data persistence (use server)
- Network communication (use server)

**Key Files:**

```
packages/cli/
├── bin/
│   └── openaidy.ts        # Entry point
├── src/
│   ├── commands/
│   │   ├── index.ts       # Command registry
│   │   ├── admin/         # Admin commands
│   │   └── devices/       # Device commands
│   ├── formatters/        # Output formatting
│   ├── errors.ts          # CLI error handling
│   └── types.ts           # TypeScript types
└── package.json
```

### `@openaidy/control-plane` - Control Plane Package

**Purpose:** Shared workflow layer for CLI and future consumers.

**Responsibilities:**

- Bootstrap admin token inspection
- Device pairing workflows (list, approve, deny)
- Domain-level validation
- Structured result types

**NOT Responsible For:**

- Command parsing
- Terminal formatting
- HTTP/WebSocket protocols
- Data storage (delegates to services)

**Key Files:**

```
packages/control-plane/
├── src/
│   ├── workflows/
│   │   ├── bootstrap-admin.ts  # Token inspection
│   │   └── pairing.ts          # Pairing workflows
│   ├── types.ts               # WorkflowResult, WorkflowError
│   └── index.ts               # Public exports
└── package.json
```

### `@openaidy/server` - Server Package

**Purpose:** HTTP/WebSocket server with persistence.

**Responsibilities:**

- HTTP API endpoints
- WebSocket connections
- Database operations
- Pairing service implementation
- Bootstrap admin token generation

**Key Files:**

```
apps/server/
├── src/
│   ├── app.ts                 # Fastify application
│   ├── bootstrap-admin.ts     # Token generation
│   ├── websocket/
│   │   └── pairing-service.ts # Pairing implementation
│   └── lib/
│       └── env.ts             # Configuration
└── package.json
```

## Data Flow

### Device Approval Flow

```
User runs command
       │
       ▼
┌──────────────────┐
│  CLI: parse args │
│  devices approve │
│  <request-id>    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ CLI: call        │
│ PairingWorkflow  │
│ .approveRequest()│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Control Plane:   │
│ validate request │
│ check status     │
│ call service     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Server:          │
│ PairingService   │
│ .approve()       │
│ update DB        │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Control Plane:   │
│ return success   │
│ WorkflowResult   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ CLI: format      │
│ output for user  │
│ exit code 0      │
└──────────────────┘
```

## Key Patterns

### Thin CLI Handlers

CLI handlers are thin - they delegate to workflows:

```typescript
// GOOD: Thin handler
export async function devicesApproveHandler(args: string[]) {
  const context = getPairingContext();
  const workflow = createPairingWorkflow(context);
  const result = await workflow.approveRequest(requestId, options);

  if (result.success) {
    return { exitCode: 0, output: formatApproved(result.data) };
  } else {
    return { exitCode: 1, error: formatError(result.error) };
  }
}

// BAD: Business logic in handler
export async function devicesApproveHandler(args: string[]) {
  // Don't do validation here
  if (!requestId) { ... }
  // Don't call services directly
  await pairingService.approve(...);
}
```

### Workflow Results

Workflows return structured results, not formatted strings:

```typescript
// WorkflowResult type
type WorkflowResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: WorkflowError;
    };

// Usage
const result = await workflow.approveRequest(id);
if (result.success) {
  // result.data is the approved request
} else {
  // result.error has category, message, hint
}
```

### Formatters Separate

Formatters are pure functions that don't touch data:

```typescript
// formatter receives data, returns string
export function formatApproved(request: PairingRequestData): string {
  return `✓ Request approved

ID:        ${request.requestId}
Device:    ${request.deviceName}
Status:    approved
`;
}
```

## Adding New Commands

### Step 1: Create Handler

```typescript
// packages/cli/src/commands/devices/show.ts
export async function devicesShowHandler(
  args: string[],
): Promise<CommandResult> {
  // Parse arguments
  const requestId = args[0];
  if (!requestId) {
    return { exitCode: 2, error: 'Missing request-id argument' };
  }

  // Call workflow
  const workflow = createPairingWorkflow(getContext());
  const result = await workflow.getRequest(requestId);

  // Format and return
  if (result.success) {
    return { exitCode: 0, output: formatRequestDetails(result.data) };
  } else {
    return { exitCode: 1, error: formatError(result.error) };
  }
}
```

### Step 2: Register Command

```typescript
// packages/cli/src/commands/index.ts
import { devicesShowHandler } from './devices/show.js';

registerCommand('devices show', devicesShowHandler, {
  description: 'Show details of a pairing request',
  usage: 'openaidy devices show <request-id>',
  examples: ['pnpm openaidy devices show abc123'],
});
```

### Step 3: Create Formatter

```typescript
// packages/cli/src/formatters/devices.ts
export function formatRequestDetails(request: PairingRequestData): string {
  // Return formatted string
}
```

### Step 4: Add Tests

```typescript
// packages/cli/src/commands/devices/show.test.ts
describe('devices show', () => {
  it('shows request details', async () => {
    // Test implementation
  });
});
```

## Error Handling

### Error Categories

```typescript
enum CLIErrorCategory {
  CONFIG_BOOTSTRAP_TOKEN_MISSING = 'CONFIG_BOOTSTRAP_TOKEN_MISSING',
  CONFIG_BOOTSTRAP_TOKEN_EXPIRED = 'CONFIG_BOOTSTRAP_TOKEN_EXPIRED',
  REQUEST_NOT_FOUND = 'REQUEST_NOT_FOUND',
  REQUEST_ALREADY_PROCESSED = 'REQUEST_ALREADY_PROCESSED',
  // ...
}
```

### Error Mapping

CLI maps workflow errors to user-friendly messages:

```typescript
function mapWorkflowError(error: WorkflowError): CLIError {
  switch (error.category) {
    case 'REQUEST_NOT_FOUND':
      return createCLIError('Request not found', {
        category: 'REQUEST_NOT_FOUND',
        exitCode: 3,
        hint: 'Run `openaidy devices list` to see valid request IDs',
      });
    // ...
  }
}
```

## Testing Strategy

### Unit Tests

- **Commands:** Test parsing and routing
- **Formatters:** Test output formatting
- **Errors:** Test error mapping

### Integration Tests

- **Workflows:** Test full workflows with mock services
- **CLI:** Test command execution with mock context

### Example Test

```typescript
describe('devices approve', () => {
  it('approves a pending request', async () => {
    const mockContext = createMockContext({
      requests: [{ requestId: 'abc123', status: 'pending' }],
    });

    const handler = createDevicesApproveHandler(() => mockContext);
    const result = await handler(['abc123']);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('approved');
  });
});
```

## Extension Points

The CLI is designed for extension:

- **JSON output:** Add `--json` flag, create JSON formatters
- **New commands:** Follow handler → workflow → formatter pattern
- **New domains:** Create new command groups (e.g., `config`)
- **Distribution:** Package ready for npm publishing

See [EXTENSION_POINTS.md](../../packages/cli/EXTENSION_POINTS.md) for details.

## Related Documentation

- [Extension Points](../../packages/cli/EXTENSION_POINTS.md)
- [Getting Started](./getting-started.md)
- [Command Reference](./command-reference.md)
- [Control Plane Overview](../control-plane.md)
