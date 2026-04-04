# OpenAidy Web Client

Real-time WebSocket-enabled web client for the OpenAidy platform.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## WebSocket Architecture

The web client uses WebSocket for real-time communication with the server:

```
Web UI → WebSocketProvider → WebUIAdapter → WebSocketClient → ws://server/ws
```

### Connection States

The client tracks these connection states:

- `connecting` - Attempting to connect
- `connected` - Successfully connected
- `reconnecting` - Attempting to reconnect after disconnect
- `disconnected` - Not connected
- `error` - Connection error occurred

Use the `ConnectionStatus` component to display connection state in your UI.

### Presence

The client subscribes to presence events (`presence.changed`) to track other connected clients. Use the `PresenceIndicator` component to display presence information.

## Environment Variables

| Variable           | Description     | Default                  |
| ------------------ | --------------- | ------------------------ |
| `VITE_API_URL`     | REST API URL    | `window.location.origin` |
| `VITE_WS_TOKEN`    | WebSocket token | -                        |
| `VITE_APP_VERSION` | App version     | `web-dev`                |

## API Layers

### WebSocket API (`lib/ws-api.ts`)

Primary API using WebSocket for real-time communication:

- `listSessions()`, `createSession()`, `getSession()`
- `submitMessage()`, `submitMessageStreaming()`
- `listAgents()`, `listRuns()`

### REST API (`lib/api.ts`)

Fallback API using REST when WebSocket is unavailable.

## Components

### ConnectionStatus

Displays WebSocket connection state with visual indicator.

### PresenceIndicator

Displays presence information for connected clients.

## Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Build verification
pnpm build
```
