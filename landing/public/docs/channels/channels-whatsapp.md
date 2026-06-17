# Channels Feature — WhatsApp Integration Spec

## Overview

The Channels feature allows openaidy agents to receive and respond to messages from external
messaging platforms. The first supported channel is **WhatsApp**, using the
[Baileys](https://github.com/WhiskeySockets/Baileys) library which connects to WhatsApp Web
via WebSocket and authenticates via a QR code scan — no Meta Business account required.

The architecture is designed to be **open for extension, closed for modification**: adding
Telegram, Discord, Slack, or any other channel in the future requires only a new class
implementing `IChannel` and a new config discriminant — zero changes to the registry, routes,
or UI scaffolding.

---

## Architecture

```
openaidy.json                        ← channel config (type, agentId, allowlist, enabled)
        │
apps/server/src/channels/
    interface.ts                     ← IChannel contract (connect/disconnect/status/qr)
    registry.ts                      ← ChannelRegistry (Map<id, IChannel>)
    index.ts                         ← createChannelRegistry() factory
    whatsapp/
        service.ts                   ← WhatsAppChannel implements IChannel
        auth-store.ts                ← Baileys credential persistence to disk
        message-handler.ts           ← inbound msg → SessionMessageService → reply text
        types.ts                     ← WhatsApp-internal types
apps/server/src/routes/
    channels.ts                      ← REST + SSE endpoints
apps/server/src/
    types.ts                         ← AppServices gains channels: ChannelRegistry
    app.ts                           ← wires registry, routes, auto-connect on startup

packages/config/src/
    app-config.ts                    ← channels Zod schema added to appConfigSchema
packages/shared-types/src/
    channels.ts                      ← runtime status types (cross-package: server + web)

apps/web/src/
    lib/api.ts                       ← channel API client functions
    components/pages/ChannelsPage.tsx ← QR UI, status badge, agent selector
```

---

## Design Principles

- **Single Responsibility** — each file has exactly one job; no LLM logic in channel layer
- **Open/Closed** — `IChannel` interface; new channels never touch existing code
- **Dependency Inversion** — `WhatsAppChannel` depends on `SessionMessageService`, not a concrete impl
- **Type placement** — channel config types in `packages/config`; runtime status types in `packages/shared-types`; server-internal types in `apps/server/src/types.ts`
- **No duplication** — all LLM invocation is done via `SessionMessageService.submitMessageNonStreaming()`

---

## Phase 1 — Config Schema

### `packages/config/src/app-config.ts`

Add a `channels` array to `appConfigSchema` alongside `mcpServers`:

```ts
export const whatsappChannelConfigSchema = z.object({
  type: z.literal('whatsapp'),
  id: z.string().min(1),
  agentId: z.string().min(1),
  allowlist: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
});

export const channelConfigSchema = z.discriminatedUnion('type', [
  whatsappChannelConfigSchema,
  // future: telegramChannelConfigSchema, discordChannelConfigSchema, ...
]);

// Inside appConfigSchema .object({...}):
channels: z.array(channelConfigSchema).optional(),
```

Export types:

```ts
export type WhatsAppChannelConfig = z.infer<typeof whatsappChannelConfigSchema>;
export type ChannelConfig = z.infer<typeof channelConfigSchema>;
```

Update `packages/config/src/index.ts` to export the new types.

---

## Phase 2 — Shared Runtime Types

### `packages/shared-types/src/channels.ts` _(new)_

```ts
export type ChannelStatus = 'disconnected' | 'qr' | 'connected' | 'error';

export type ChannelStatusResponse = {
  id: string;
  type: string;
  status: ChannelStatus;
  agentId: string;
  connectedAt?: string; // ISO timestamp, present when status === 'connected'
  error?: string; // present when status === 'error'
};

export type ChannelQrEvent = {
  qr: string; // base64 PNG, ready for <img src="data:image/png;base64,...">
};
```

Export from `packages/shared-types/src/index.ts`:

```ts
export * from './channels.js';
```

---

## Phase 3 — Server: Channel Interface & Registry

### `apps/server/src/channels/interface.ts` _(new)_

```ts
import type { ChannelStatus } from '@openaidy/shared-types';

export interface IChannel {
  readonly id: string;
  readonly type: string;
  getStatus(): ChannelStatus;
  getQr(): string | null; // base64 PNG; null when not in QR state
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onQrUpdate(cb: (qr: string) => void): void;
  onStatusChange(cb: (status: ChannelStatus) => void): void;
}
```

### `apps/server/src/channels/registry.ts` _(new)_

```ts
export class ChannelRegistry {
  private readonly channels = new Map<string, IChannel>();

  register(channel: IChannel): void { ... }
  get(id: string): IChannel | undefined { ... }
  getAll(): IChannel[] { ... }
  remove(id: string): Promise<void> { ... }   // disconnects then removes
}
```

### `apps/server/src/channels/index.ts` _(new)_

Factory called once during app startup:

```ts
export function createChannelRegistry(
  configs: ChannelConfig[] | undefined,
  deps: {
    sessionService: SessionMessageService;
    authBaseDir: string;
    logger: FastifyBaseLogger;
  },
): ChannelRegistry {
  const registry = new ChannelRegistry();
  for (const cfg of configs ?? []) {
    if (cfg.type === 'whatsapp') {
      registry.register(new WhatsAppChannel(cfg, deps));
    }
    // future: if (cfg.type === 'telegram') registry.register(new TelegramChannel(...))
  }
  return registry;
}
```

---

## Phase 4 — WhatsApp Channel Implementation

### `apps/server/src/channels/whatsapp/types.ts` _(new)_

Internal types scoped to the WhatsApp module only:

```ts
import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service';
import type { WhatsAppChannelConfig } from '@openaidy/config';

export type WhatsAppChannelDeps = {
  sessionService: SessionMessageService;
  authBaseDir: string;
  logger: FastifyBaseLogger;
};

export type WhatsAppChannelOptions = {
  config: WhatsAppChannelConfig;
  deps: WhatsAppChannelDeps;
};
```

### `apps/server/src/channels/whatsapp/auth-store.ts` _(new)_

Wraps Baileys `useMultiFileAuthState()`. Stores credentials under:

```
~/.openaidy/channels/whatsapp-{channelId}/
```

```ts
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import path from 'node:path';

export async function createWhatsAppAuthStore(
  authBaseDir: string,
  channelId: string,
) {
  const dir = path.join(authBaseDir, `whatsapp-${channelId}`);
  return useMultiFileAuthState(dir);
}
```

### `apps/server/src/channels/whatsapp/message-handler.ts` _(new)_

Single-responsibility: translate an inbound WhatsApp message into a session interaction.

```ts
export async function handleInboundWhatsAppMessage(params: {
  waId: string; // sender's WhatsApp number e.g. "15551234567"
  text: string;
  channelId: string;
  agentId: string;
  allowlist: string[] | undefined;
  sessionService: SessionMessageService;
  logger: FastifyBaseLogger;
}): Promise<string | null> {
  // 1. Check allowlist if configured (empty = everyone allowed)
  if (params.allowlist?.length && !params.allowlist.includes(params.waId)) {
    return null;
  }

  // 2. Find or create a session keyed on channel + sender
  const sessionTitle = `whatsapp:${params.channelId}:${params.waId}`;
  let session = await findSessionByTitle(sessionTitle, params.sessionService);
  if (!session) {
    session = await params.sessionService.createSession(sessionTitle);
  }

  // 3. Submit message and collect full reply (non-streaming)
  const result = await params.sessionService.submitMessageNonStreaming({
    sessionId: session.id,
    role: 'user',
    content: params.text,
    agentId: params.agentId,
  });

  if (!result.ok) {
    params.logger.error(
      { error: result.error },
      'whatsapp: agent invocation failed',
    );
    return null;
  }

  return result.assistantMessage?.content ?? null;
}
```

> **Note:** `findSessionByTitle` is a helper that queries sessions by title — session title acts as an external-channel keying mechanism. If the session store doesn't support title lookup, we use a lightweight in-memory map (Map<title, sessionId>) that survives server restarts via a small JSON sidecar file.

### `apps/server/src/channels/whatsapp/service.ts` _(new)_

Implements `IChannel`. Owns the Baileys socket lifecycle.

```ts
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { EventEmitter } from 'node:events';
import type { IChannel } from '../interface';
import type { ChannelStatus } from '@openaidy/shared-types';

export class WhatsAppChannel extends EventEmitter implements IChannel {
  readonly id: string;
  readonly type = 'whatsapp';

  private status: ChannelStatus = 'disconnected';
  private qr: string | null = null;
  private socket: ReturnType<typeof makeWASocket> | null = null;

  constructor(
    private readonly config: WhatsAppChannelConfig,
    private readonly deps: WhatsAppChannelDeps,
  ) {
    super();
    this.id = config.id;
  }

  getStatus(): ChannelStatus {
    return this.status;
  }
  getQr(): string | null {
    return this.qr;
  }

  onQrUpdate(cb: (qr: string) => void): void {
    this.on('qr', cb);
  }
  onStatusChange(cb: (status: ChannelStatus) => void): void {
    this.on('status', cb);
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await createWhatsAppAuthStore(
      this.deps.authBaseDir,
      this.id,
    );
    const { version } = await fetchLatestBaileysVersion();
    this.socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Convert Baileys QR string to base64 PNG using `qrcode` package
        const qrDataUrl = await QRCode.toDataURL(qr);
        this.qr = qrDataUrl.replace('data:image/png;base64,', '');
        this.setStatus('qr');
        this.emit('qr', this.qr);
      }

      if (connection === 'open') {
        this.qr = null;
        this.setStatus('connected');
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;
        this.setStatus(shouldReconnect ? 'disconnected' : 'disconnected');
        if (shouldReconnect) await this.connect();
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const text =
          msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
        if (!text) continue;
        const waId = msg.key.remoteJid?.replace('@s.whatsapp.net', '') ?? '';

        const reply = await handleInboundWhatsAppMessage({
          waId,
          text,
          channelId: this.id,
          agentId: this.config.agentId,
          allowlist: this.config.allowlist,
          sessionService: this.deps.sessionService,
          logger: this.deps.logger,
        });

        if (reply && this.socket) {
          await this.socket.sendMessage(msg.key.remoteJid!, { text: reply });
        }
      }
    });
  }

  async disconnect(): Promise<void> {
    await this.socket?.logout();
    this.socket = null;
    this.qr = null;
    this.setStatus('disconnected');
  }

  private setStatus(s: ChannelStatus): void {
    this.status = s;
    this.emit('status', s);
  }
}
```

---

## Phase 5 — Routes

### `apps/server/src/routes/channels.ts` _(replace stub)_

```
GET  /channels                  → list all channels + status
GET  /channels/:id/status       → ChannelStatusResponse
POST /channels/:id/connect      → trigger connect()
POST /channels/:id/disconnect   → trigger disconnect()
GET  /channels/:id/qr/stream    → SSE stream; pushes { qr: "base64..." } on each QR update
                                   and { status: "connected" } when authenticated
```

All routes require auth via `requireAuth()` middleware (same pattern as other routes).

SSE endpoint uses `reply.raw` (Node.js `http.ServerResponse`) to write `text/event-stream`:

```ts
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
});
const sendEvent = (data: object) =>
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

channel.onQrUpdate((qr) => sendEvent({ type: 'qr', qr }));
channel.onStatusChange((status) => {
  sendEvent({ type: 'status', status });
  if (status === 'connected') reply.raw.end();
});
// Send current state immediately
if (channel.getStatus() === 'qr' && channel.getQr()) {
  sendEvent({ type: 'qr', qr: channel.getQr() });
}
```

---

## Phase 6 — AppServices Integration

### `apps/server/src/types.ts`

Add to `AppServices`:

```ts
channels: ChannelRegistry;
```

### `apps/server/src/app.ts`

After `sessionService` is constructed:

```ts
const channelRegistry = createChannelRegistry(
  configService.getConfig().channels,
  {
    sessionService,
    authBaseDir: path.join(env.OPENAIDY_HOME, 'channels'),
    logger: app.log,
  },
);

// Auto-connect enabled channels on startup
for (const channel of channelRegistry.getAll()) {
  if (
    configService.getConfig().channels?.find((c) => c.id === channel.id)
      ?.enabled
  ) {
    channel
      .connect()
      .catch((err) =>
        app.log.warn(
          { err, channelId: channel.id },
          'channel auto-connect failed',
        ),
      );
  }
}
```

Register routes:

```ts
await app.register(channelRoutes, {
  channelRegistry,
  authMiddleware,
});
```

---

## Phase 7 — Web Frontend

### `apps/web/src/lib/api.ts`

Add channel API functions (no new types defined here — import from `@openaidy/shared-types`):

```ts
export async function listChannels(): Promise<ChannelStatusResponse[]>;
export async function getChannelStatus(
  id: string,
): Promise<ChannelStatusResponse>;
export async function connectChannel(id: string): Promise<void>;
export async function disconnectChannel(id: string): Promise<void>;
// QR SSE: consumers use EventSource('/api/channels/:id/qr/stream') directly
```

### `apps/web/src/components/pages/ChannelsPage.tsx`

Replace the current stub. UI sections:

1. **Channel list** — fetched from `GET /channels`; each card shows channel type icon, id, and status badge
2. **Status badge** — green "Connected", yellow "QR Required", grey "Disconnected", red "Error"
3. **Connect / Disconnect button** — calls respective endpoint; disables during pending state
4. **QR panel** — shown when status is `qr`; opens SSE stream via `EventSource`; renders `<img src="data:image/png;base64,{qr}" />` with "Scan this with your phone's WhatsApp → Linked Devices" instruction; auto-hides when `status: connected` event arrives
5. **Agent badge** — shows which agent ID handles messages for the channel
6. **No channels configured** — empty state with instructions pointing to `openaidy.json`

---

## `openaidy.json` Example

```json
{
  "channels": [
    {
      "type": "whatsapp",
      "id": "personal",
      "agentId": "my-assistant",
      "allowlist": [],
      "enabled": true
    }
  ]
}
```

`allowlist: []` means everyone can message the bot. Populate with WA numbers (e.g. `"15551234567"`) to restrict access.

---

## Dependencies

### New dependency: `@whiskeysockets/baileys`

Added to `apps/server/package.json`. It requires `node >= 22` (already satisfied).

```bash
pnpm --filter @openaidy/server add @whiskeysockets/baileys
```

The `qrcode` package is already a dependency in the openclaw reference; we add it here too:

```bash
pnpm --filter @openaidy/server add qrcode
pnpm --filter @openaidy/server add --save-dev @types/qrcode
```

---

## Access Control — Two Separate Concerns

The openaidy auth system (JWT bearer tokens) and channel access control are **completely
separate** and must not be confused.

### Management plane — JWT auth

Routes like `POST /channels/:id/connect`, `GET /channels/:id/status`, and the QR SSE stream
are protected by `requireAuth()` middleware (same as all other openaidy API routes). These are
called by **you** from the web UI to manage the channel. A valid JWT is required.

### Channel user plane — allowlist

When a WhatsApp contact sends a message, **no HTTP request is made**. The Baileys socket fires
a `messages.upsert` event entirely within the server process. The JWT auth middleware is never
invoked. Instead, access control is handled by the `allowlist` field in the channel config:

```json
{ "allowlist": [] }           // empty = everyone can message the bot
{ "allowlist": ["15551234567"] } // only this number is allowed
```

The full inbound flow — from Baileys event to `SessionMessageService` call to WA reply — never
touches HTTP auth:

```
WA contact sends message
  → Baileys 'messages.upsert' event (in-process)
  → message-handler checks allowlist (phone number filter)
  → sessionService.submitMessageNonStreaming() called directly
  → agent runs, reply sent via sock.sendMessage()
```

### Identity model for channel contacts

Channel contacts are identified solely by their WhatsApp phone number (`waId`). There is no
openaidy user account associated with them. Each contact gets their own persistent session
(keyed on `whatsapp:{channelId}:{waId}`) which maintains their full conversation history with
the agent.

---

## Session Keying Strategy

Each external contact maps to a persistent openaidy session. The key is:

```
whatsapp:{channelId}:{waId}
```

e.g. `whatsapp:personal:15551234567`

This becomes the session **title**. On first message from a contact, a new session is created
with this title. On subsequent messages, the existing session is reused — maintaining full
conversation history with the agent.

**Implementation note:** If the DB session store does not support `findByTitle`, a sidecar JSON
file (`~/.openaidy/channels/whatsapp-{channelId}/session-map.json`) maps `waId → sessionId`.
This file is loaded into memory on startup and updated on each new contact.

---

## Future Channels

To add Telegram (example):

1. Add `telegramChannelConfigSchema` to `packages/config/src/app-config.ts` and add it to the `channelConfigSchema` discriminated union
2. Create `apps/server/src/channels/telegram/service.ts` implementing `IChannel`
3. Add `if (cfg.type === 'telegram')` branch in `createChannelRegistry()`

**Zero changes** to `ChannelRegistry`, routes, `AppServices`, or the web UI channel list.

---

## Implementation Order

| Phase | Files                                                              | Status      |
| ----- | ------------------------------------------------------------------ | ----------- |
| 1     | `packages/config` — channel schema                                 | Not started |
| 2     | `packages/shared-types` — runtime types                            | Not started |
| 3     | `apps/server/src/channels/interface.ts`, `registry.ts`, `index.ts` | Not started |
| 4     | `apps/server/src/channels/whatsapp/*`                              | Not started |
| 5     | `apps/server/src/routes/channels.ts`                               | Not started |
| 6     | `apps/server/src/types.ts`, `app.ts`                               | Not started |
| 7     | `apps/web` — API functions + `ChannelsPage.tsx`                    | Not started |
