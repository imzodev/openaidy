# OpenAidy Server

WebSocket-enabled backend server for the OpenAidy platform.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## WebSocket Gateway

The server provides a WebSocket gateway at `/ws` for real-time client communication.

### Endpoint

```
ws://localhost:3001/ws
wss://production.example.com/ws
```

### Authentication

Clients authenticate via WebSocket handshake with JWT token:

```url
ws://localhost:3001/ws?token=<jwt_token>
```

## ClientType Support

The server supports multiple client types with capability-based access control:

| Client Type | Capabilities                     |
| ----------- | -------------------------------- |
| `web`       | session._, agent._, provider.\*  |
| `cli`       | Extended - includes config.write |
| `mobile`    | session.\*, agent.list           |
| `channel`   | provider.invoke                  |

## Capability Presets

Capability presets are enforced per client type in [`src/websocket/capability-presets.ts`](src/websocket/capability-presets.ts).

## Environment Variables

| Variable       | Description                | Default              |
| -------------- | -------------------------- | -------------------- |
| `PORT`         | Server port                | `3001`               |
| `DATABASE_URL` | SQLite database path       | `./data/openaidy.db` |
| `JWT_SECRET`   | JWT signing secret         | -                    |
| `WS_TOKEN`     | WebSocket token (optional) | -                    |

## Subscription Manager

The server includes a subscription manager for push-driven updates:

- Session subscriptions (`session.created`, `session.deleted`, etc.)
- Presence subscriptions (`presence.changed`)
- Config subscriptions (`config.updated`)

See [`src/websocket/subscriptions.ts`](src/websocket/subscriptions.ts) for API.

## Testing

```bash
# Run tests
pnpm test

# Run e2e tests
pnpm test:e2e

# Build verification
pnpm build
```
