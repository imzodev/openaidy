# OpenAidy SDK

Multi-client WebSocket SDK for the OpenAidy platform.

## Installation

```bash
pnpm add @openaidy/sdk
```

## Client Adapters

The SDK provides client adapters for different client types:

### WebUIAdapter

For browser-based web applications:

```typescript
import { createWebUIAdapter } from '@openaidy/sdk';

const adapter = createWebUIAdapter();
const client = adapter.createClient({
  baseUrl: 'http://localhost:3001',
  token: 'your-jwt-token',
});

await client.connect();
```

### CLIAdapter

For CLI applications:

```typescript
import { createCLIAdapter } from '@openaidy/sdk';

const adapter = createCLIAdapter();
const client = adapter.createClient({
  baseUrl: 'http://localhost:3001',
  token: process.env.WS_TOKEN,
});
```

### MobileAdapter

For mobile applications:

```typescript
import { createMobileAdapter } from '@openaidy/sdk';

const adapter = createMobileAdapter();
const client = adapter.createClient({
  baseUrl: 'wss://example.com',
});
```

### ChannelAdapter

For channel/plugin integrations:

```typescript
import { createChannelAdapter } from '@openaidy/sdk';

const adapter = createChannelAdapter();
const client = adapter.createClient({
  baseUrl: 'wss://example.com',
});
```

## Client Types

Each adapter specifies a client type:

| Adapter        | Client Type |
| -------------- | ----------- |
| WebUIAdapter   | `web`       |
| CLIAdapter     | `cli`       |
| MobileAdapter  | `mobile`    |
| ChannelAdapter | `channel`   |

## Capabilities

Client types have different capability presets enforced by the server:

| Client Type | Capabilities                     |
| ----------- | -------------------------------- |
| `web`       | session._, agent._, provider.\*  |
| `cli`       | Extended (includes config.write) |
| `mobile`    | session.\*, agent.list           |
| `channel`   | provider.invoke                  |

## WebSocket Client API

### Connection

```typescript
await client.connect();
await client.disconnect();
await client.reconnect();
```

### Sessions

```typescript
const { id } = await client.createSession({ title: 'My Session' });
const sessions = await client.listSessions();
const session = await client.getSession(id);
await client.deleteSession(id);
```

### Messages

```typescript
await client.sendMessage(sessionId, 'Hello, world!');
const messages = await client.listMessages(sessionId);
```

### Streaming

```typescript
const stream = await client.submitMessageStreaming(
  sessionId,
  'Tell me a story',
);
for await (const event of stream) {
  console.log(event.payload.delta);
}
```

### Agents & Providers

```typescript
const agents = await client.listAgents();
const providers = await client.listProviders();
const models = await client.getProviderModels(providerId);
```

### Presence

```typescript
await client.updatePresence('online', { clientType: 'web' });
const presence = await client.getAllPresence();
```

## Event Handlers

```typescript
client.on('session.created', (event) => {
  console.log('New session:', event.payload);
});

client.on('presence.changed', (event) => {
  console.log('Presence changed:', event.payload);
});
```

## Testing

```bash
# Run tests
pnpm test

# Run with coverage
pnpm test:coverage
```
