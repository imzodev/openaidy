# CLI Installation Guide

This guide explains how to install and run the OpenAidy CLI.

## Current Status: Repo-Local

The CLI is currently in development and runs directly from the monorepo.

### Prerequisites

- **Node.js** 18 or higher
- **pnpm** 8 or higher (recommended)
- **Git** (for cloning the repository)

## Repo-Local Execution

### Step 1: Clone the Repository

```bash
git clone https://github.com/imzodev/openaidy.git
cd openaidy
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Run the CLI

```bash
# Using pnpm
pnpm openaidy --help

# Or using the full path
node packages/cli/bin/openaidy.ts --help
```

## Verifying Installation

### Check Version

```bash
pnpm openaidy --version
```

Expected output:

```
openaidy/0.0.1
```

### Check Help

```bash
pnpm openaidy --help
```

Expected output:

```
OpenAidy CLI - Local administration tool

Usage:
  openaidy <command> [options]

Commands:
  admin     Administrative commands for bootstrap-admin and system management
  devices   Device pairing and management commands

Options:
  --help, -h     Show help
  --version, -v  Show version

Examples:
  pnpm openaidy devices list
  pnpm openaidy admin token show
```

### Run a Command

```bash
pnpm openaidy admin token path
```

Expected output:

```
.openaidy/credentials/bootstrap-admin.json
```

## Development Setup

For contributors working on the CLI:

### Install Development Dependencies

```bash
pnpm install
```

### Run Tests

```bash
# Run all CLI tests
pnpm --filter @openaidy/cli test

# Run specific test file
pnpm --filter @openaidy/cli vitest run src/commands/devices/list.test.ts

# Run tests in watch mode
pnpm --filter @openaidy/cli vitest
```

### Build

```bash
# Type check
pnpm --filter @openaidy/cli build
```

### Lint

```bash
pnpm --filter @openaidy/cli lint
```

## Future: Global Installation

After the package is published to npm:

### Install from npm

```bash
# Install globally
npm install -g @openaidy/cli

# Or with pnpm
pnpm add -g @openaidy/cli
```

### Run from Anywhere

```bash
# After global installation
openaidy --help
```

### Uninstall

```bash
npm uninstall -g @openaidy/cli
```

## Distribution Details

### Package Information

- **Package name:** `@openaidy/cli`
- **Binary name:** `openaidy`
- **License:** MIT
- **Repository:** https://github.com/imzodev/openaidy

### Package Exports

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./commands": "./src/commands/index.ts",
    "./types": "./src/types.ts"
  }
}
```

### Binary Entry Point

```json
{
  "bin": {
    "openaidy": "./bin/openaidy.ts"
  }
}
```

## Troubleshooting

### Command Not Found

**Error:** `command not found: openaidy`

**Solution:** Run via pnpm:

```bash
pnpm openaidy --help
```

### Module Not Found

**Error:** `Cannot find module '@openaidy/control-plane'`

**Solution:** Install dependencies:

```bash
pnpm install
```

### Permission Denied

**Error:** `EACCES: permission denied`

**Solution:** Check file permissions:

```bash
chmod +x packages/cli/bin/openaidy.ts
```

### Wrong Directory

**Error:** Command fails when run from wrong directory

**Solution:** Run from repository root:

```bash
cd /path/to/openaidy
pnpm openaidy --help
```

## Environment Variables

| Variable                        | Description            | Default                                      |
| ------------------------------- | ---------------------- | -------------------------------------------- |
| `OPENAIDY_BOOTSTRAP_TOKEN_PATH` | Custom token file path | `.openaidy/credentials/bootstrap-admin.json` |

## Next Steps

- [Getting Started Guide](./getting-started.md)
- [Command Reference](./command-reference.md)
- [Architecture Guide](./architecture.md)
