# CLI Extension Points

This document describes the extension points for future CLI growth without requiring redesign.

## JSON Output Support

### Current Architecture
The CLI separates rendering from workflow logic:

```
Command Handler → Workflow (control-plane) → Formatter → Output
```

### Extension Point
To add JSON output support:

1. Add `--json` flag parsing in command handlers
2. Create `formatters/json.ts` with JSON formatters:
   ```typescript
   export function formatRequestJSON(req: PairingRequestData): object {
     return {
       requestId: req.requestId,
       deviceName: req.deviceName,
       // ...
     };
   }
   ```
3. Add output mode selection in command handler:
   ```typescript
   const output = options.json 
     ? formatRequestJSON(request)
     : formatRequest(request);
   ```

### Why It Works
- Formatters are pure functions (no side effects)
- Workflow results are serializable objects
- No terminal-specific code in workflows

## Command Scalability

### Current Structure
```
src/commands/
├── index.ts          # Registry and routing
├── admin/
│   └── token/        # Token commands
└── devices/
    ├── list.ts       # List command
    ├── approve.ts    # Approve command
    ├── deny.ts       # Deny command
    └── integration.test.ts
```

### Adding New Commands

1. Create handler file in appropriate domain folder
2. Register in `commands/index.ts`:
   ```typescript
   registerCommand(
     'devices show',
     async (args) => {
       const { devicesShowHandler } = await import('./devices/show.js');
       return devicesShowHandler(args);
     },
     { description: 'Show device details', usage: '...' }
   );
   ```

3. Add tests in corresponding test file

### Command Groups
- `admin` - Bootstrap admin and system management
- `devices` - Device pairing and management
- Future groups can be added without restructuring

## Package Distribution

### Ready for Publishing
The package is configured for npm publishing:

```json
{
  "name": "@openaidy/cli",
  "bin": { "openaidy": "./bin/openaidy.ts" },
  "exports": {
    ".": "./src/index.ts",
    "./commands": "./src/commands/index.ts",
    "./types": "./src/types.ts"
  },
  "files": ["bin", "src"]
}
```

### Future Steps
1. Build step: Compile TypeScript to JavaScript
2. Update bin path to point to compiled output
3. Add pre-publish checks
4. Publish to npm registry

### Global Installation
After publishing:
```bash
npm install -g @openaidy/cli
openaidy --help
```

## Workflow Reuse

### Control-Plane Package
The `@openaidy/control-plane` package is designed for reuse:

```typescript
// Non-CLI consumer
import { 
  PairingWorkflow, 
  createPairingWorkflow 
} from '@openaidy/control-plane';

const workflow = createPairingWorkflow({
  pairingService: myService,
  actor: 'web-ui',
});

const result = workflow.listRequests({ status: 'pending' });
```

### Key Design Decisions
- Workflows return structured results (not formatted strings)
- Logger interface is platform-agnostic
- No direct process/exit behavior in workflows
- Error codes map to semantic categories

## Output Abstraction

### Current Pattern
```typescript
interface CommandResult {
  exitCode: number;
  output?: string;  // Human-readable
  error?: string;   // Human-readable error
}
```

### Future JSON Mode
```typescript
interface CommandResult {
  exitCode: number;
  output?: string | object;  // string for human, object for JSON
  error?: string | object;
  meta?: {
    format: 'text' | 'json';
    timestamp: string;
  };
}
```

### Formatters
Each formatter exports both text and JSON versions:
```typescript
// formatters/devices.ts
export function formatRequest(req: PairingRequestData): string;
export function formatRequestJSON(req: PairingRequestData): object;
```

## Extension Checklist

Before adding new features, verify:

- [ ] Command handler stays thin (delegates to workflow)
- [ ] Formatter is separate from workflow logic
- [ ] Workflow result is serializable
- [ ] No terminal-specific assumptions in shared code
- [ ] New commands follow existing patterns
- [ ] Tests cover both success and failure paths

## Future Commands (Examples)

### `devices show <request-id>`
```typescript
// commands/devices/show.ts
export const devicesShowHandler = createDevicesShowHandler(getContext);
```

### `admin token status`
```typescript
// commands/admin/token/status.ts
export const adminTokenStatusHandler = createAdminTokenStatusHandler(getContext);
```

### `config show`
```typescript
// commands/config/show.ts
export const configShowHandler = createConfigShowHandler(getContext);
```

## Testing Extensions

All new commands should have:
- Unit tests for command handler
- Unit tests for formatters
- Integration tests for workflows
- Regression tests for existing behavior
