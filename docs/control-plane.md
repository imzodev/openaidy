# Control Plane Overview

The control plane is the shared workflow layer between the CLI and the server.

## What is the Control Plane?

The control plane (`@openaidy/control-plane`) is a package that contains:
- Shared workflow logic
- Domain operations
- Structured result types
- Error handling patterns

It sits between the CLI and the server, providing a clean abstraction for administrative operations.

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│     CLI      │────▶│  Control Plane  │────▶│    Server    │
│ (consumes)   │     │  (workflows)    │     │ (implements) │
└──────────────┘     └─────────────────┘     └──────────────┘
```

## Why Control Plane?

### Separation of Concerns

The control plane separates:
- **How** operations are invoked (CLI, API, future UI)
- **What** operations do (workflow logic)
- **Where** data is stored (server implementation)

### Reusability

Multiple consumers can use the same workflows:
- CLI for local administration
- Future: REST API for remote administration
- Future: Web UI for administration

### Testability

Workflows can be tested independently:
- Mock the service layer
- Test workflow logic
- No CLI or HTTP dependencies

## Control Plane Components

### Workflows

#### BootstrapAdminWorkflow

Handles bootstrap-admin token operations:

```typescript
const workflow = createBootstrapAdminWorkflow(context);

// Inspect token
const result = workflow.inspectToken();
if (result.success) {
  console.log(result.data.status); // 'valid', 'expired', etc.
}
```

**Methods:**
- `inspectToken()` - Get token status and info
- `getTokenPath()` - Get token file path
- `isEnabled()` - Check if bootstrap-admin is enabled

#### PairingWorkflow

Handles device pairing operations:

```typescript
const workflow = createPairingWorkflow(context);

// List requests
const listResult = workflow.listRequests({ status: 'pending' });

// Approve request
const approveResult = workflow.approveRequest(requestId, options);

// Deny request
const denyResult = workflow.denyRequest(requestId);
```

**Methods:**
- `listRequests(options)` - List pairing requests with filters
- `getRequest(requestId)` - Get a specific request
- `approveRequest(requestId, options)` - Approve a request
- `denyRequest(requestId)` - Deny a request

### Types

#### WorkflowResult

```typescript
type WorkflowResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: WorkflowError;
};
```

#### WorkflowError

```typescript
type WorkflowError = {
  category: ErrorCategory;
  message: string;
  hint?: string;
  cause?: Error;
};
```

### Helpers

```typescript
// Success helper
const result = success(data);

// Failure helper
const result = failure('CATEGORY', 'Message', { hint: 'Try this' });
```

## Design Principles

### 1. Local-First

The control plane is designed for local administration:
- Operations run on the same machine as the server
- Token is stored in local filesystem
- No network calls for administrative operations

### 2. Platform-Agnostic

Workflows don't depend on:
- HTTP frameworks (no Fastify)
- Terminal specifics (no console colors)
- Process management (no exit codes)

### 3. Type-Safe

Full TypeScript support:
- Input types for workflow options
- Output types for workflow results
- Error categories as union types

### 4. Testable

Workflows use dependency injection:

```typescript
// Create with mock context for testing
const workflow = createPairingWorkflow({
  pairingService: mockService,
  actor: 'test',
  logger: mockLogger,
});
```

## Out of Scope

The first release does **not** include:

- Remote administration (network-based)
- Token rotation automation
- Multi-tenant support
- Audit logging
- Role-based access control

These may be added in future releases.

## Package Structure

```
packages/control-plane/
├── src/
│   ├── workflows/
│   │   ├── bootstrap-admin.ts    # Token inspection
│   │   └── pairing.ts            # Pairing workflows
│   ├── types.ts                  # Result types
│   ├── index.ts                  # Public exports
│   └── types/
│       └── index.ts              # Error types
├── package.json
└── README.md
```

## Usage Example

### From CLI

```typescript
// CLI command handler
export async function devicesListHandler(args: string[]) {
  const context = await getPairingContext();
  const workflow = createPairingWorkflow(context);
  const result = workflow.listRequests({ status: 'pending' });

  if (result.success) {
    return { exitCode: 0, output: formatRequests(result.data) };
  } else {
    return { exitCode: 1, error: formatError(result.error) };
  }
}
```

### From Test

```typescript
describe('PairingWorkflow', () => {
  it('lists pending requests', () => {
    const mockService = {
      listRequests: vi.fn().mockReturnValue([
        { requestId: 'abc123', status: 'pending' },
      ]),
    };

    const workflow = createPairingWorkflow({
      pairingService: mockService,
      actor: 'test',
      logger: console,
    });

    const result = workflow.listRequests({ status: 'pending' });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
  });
});
```

## Error Handling

### Error Categories

```typescript
enum ErrorCategory {
  // Bootstrap admin
  CONFIG_BOOTSTRAP_TOKEN_MISSING = 'CONFIG_BOOTSTRAP_TOKEN_MISSING',
  CONFIG_BOOTSTRAP_TOKEN_EXPIRED = 'CONFIG_BOOTSTRAP_TOKEN_EXPIRED',
  CONFIG_BOOTSTRAP_TOKEN_MALFORMED = 'CONFIG_BOOTSTRAP_TOKEN_MALFORMED',
  CONFIG_BOOTSTRAP_TOKEN_INVALID = 'CONFIG_BOOTSTRAP_TOKEN_INVALID',
  CONFIG_BOOTSTRAP_TOKEN_DISABLED = 'CONFIG_BOOTSTRAP_TOKEN_DISABLED',

  // Pairing
  REQUEST_NOT_FOUND = 'REQUEST_NOT_FOUND',
  REQUEST_ALREADY_PROCESSED = 'REQUEST_ALREADY_PROCESSED',
  REQUEST_EXPIRED = 'REQUEST_EXPIRED',
}
```

### Error with Hint

```typescript
const result = failure('REQUEST_NOT_FOUND', 'Request not found', {
  hint: 'Run `openaidy devices list` to see valid request IDs',
});
```

## Related Documentation

- [CLI Architecture Guide](./cli/architecture.md)
- [CLI Extension Points](../packages/cli/EXTENSION_POINTS.md)
- [API Design](./api-design.md)
