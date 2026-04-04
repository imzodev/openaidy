# OpenAidy CLI Documentation

This directory contains documentation for the OpenAidy Command Line Interface (CLI).

## Overview

The OpenAidy CLI is a local administration tool for managing bootstrap-admin tokens and device pairing requests. It provides a command-line interface to the OpenAidy control plane.

## Documentation Index

### For Operators

- **[Getting Started](./getting-started.md)** - Quick start guide for using the CLI
- **[Command Reference](./command-reference.md)** - Complete reference for all CLI commands
- **[Bootstrap Admin Guide](./bootstrap-admin.md)** - Guide for bootstrap-admin token management

### For Contributors

- **[Architecture Guide](./architecture.md)** - CLI architecture and package boundaries
- **[Extension Points](../packages/cli/EXTENSION_POINTS.md)** - How to extend the CLI

### For Everyone

- **[Installation Guide](./installation.md)** - How to install and run the CLI

## Quick Start

```bash
# From the repository root
pnpm openaidy --help

# List pending device pairing requests
pnpm openaidy devices list

# Show bootstrap-admin token info
pnpm openaidy admin token show
```

## Package Location

The CLI package is located at `packages/cli/` in the monorepo.

## Related Documentation

- [Control Plane Overview](../docs/control-plane.md)
- [WebSocket Architecture](../docs/websocket-architecture.md)
- [API Design](../docs/api-design.md)
