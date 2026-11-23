# Aidy CLI Documentation

This directory contains documentation for the Aidy Command Line Interface (CLI).

## Overview

The Aidy CLI is a local administration tool for managing access tokens, bootstrap-admin tokens, and device pairing requests. It provides a command-line interface to the Aidy control plane.

## Documentation Index

### For Operators

- **[Getting Started](./getting-started.md)** - Quick start guide for using the CLI
- **[Command Reference](./command-reference.md)** - Complete reference for all CLI commands
- **[Bootstrap Admin Guide](./bootstrap-admin.md)** - Guide for bootstrap-admin token management

### For Contributors

- **[Architecture Guide](../../plans/cli/architecture.md)** - CLI architecture and package boundaries
- **[Extension Points](../../packages/cli/EXTENSION_POINTS.md)** - How to extend the CLI

### For Everyone

- **[Installation Guide](./installation.md)** - How to install and run the CLI

## Quick Start

```bash
# From the repository root
pnpm aidy --help

# Create an access token
pnpm aidy tokens create --name "My Token" --scopes "*"

# List all access tokens
pnpm aidy tokens list

# List pending device pairing requests
pnpm aidy devices list

# Show bootstrap-admin token info
pnpm aidy admin token show
```

## Package Location

The CLI package is located at `packages/cli/` in the monorepo.

## Related Documentation

- [Control Plane Overview](../../plans/control-plane/overview.md)
- [WebSocket Architecture](../../plans/websocket-architecture.md)
- [API Design](../../plans/api-design.md)
