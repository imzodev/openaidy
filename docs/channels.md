---
summary: 'Connect OpenAidy to messaging channels so agents can receive and reply to real conversations'
read_when:
  - You want to connect WhatsApp or Discord to OpenAidy
  - You need to understand how channel routing, allowlists, and authentication work
  - You are setting up inbound message handling and outbound reply delivery
title: 'Channels'
---

# Channels

Channels let OpenAidy agents receive and reply to real conversations on messaging platforms. Instead of only using the web UI, you can connect a channel so messages from WhatsApp, Discord, or other platforms create or resume sessions and trigger agent responses.

Channels are purely reactive today: they listen for inbound messages and reply with whatever the configured agent produces. There's currently no way to have an addon or tool push an outbound message on demand outside of that inbound-reply cycle.

## How channels work in OpenAidy

Each channel is configured through the plugin-style channel API. The core knows only about channel capabilities and transport-neutral events — channel-specific logic lives inside each channel implementation.

When a channel receives a message:

1. The channel plugin normalizes it to a core message envelope
2. OpenAidy finds or creates the session associated with that sender
3. The message is submitted to the agent
4. The agent's response is sent back through the same channel

## Supported channels

- **WhatsApp** — connected via the Baileys library, which links to WhatsApp Web through a QR code scan. No Meta Business account required.
- **Discord** — connected with a bot token, no QR flow.

Both are built on the same plugin interface, so adding another channel doesn't require touching core session logic.

## Connecting WhatsApp

### Step 1: Configure the channel

Add a channel entry to your `openaidy.json` config:

```json
{
  "channels": [
    {
      "type": "whatsapp",
      "id": "my-whatsapp",
      "agentId": "default",
      "allowlist": ["15551234567"],
      "enabled": true
    }
  ]
}
```

Fields:

- `type` — always `"whatsapp"` for now
- `id` — a unique name you choose for this channel instance
- `agentId` — which agent to use for this channel's conversations
- `allowlist` — optional list of phone numbers that are allowed to message. Empty or omitted means everyone can interact
- `enabled` — set to `true` to start the connection on server boot

### Step 2: Scan the QR code

Start the server and navigate to the Channels page in the web UI. You will see a QR code displayed. Scan it with the WhatsApp app on your phone (Settings > Linked Devices > Link a Device).

Once connected, the status changes from QR to Connected.

### Step 3: Test it

Send a message from the allowed phone number to your WhatsApp number. OpenAidy will create a session, forward the message to the agent, and reply with the agent's response.

## Connecting Discord

Add a channel entry to your `openaidy.json` config:

```json
{
  "channels": [
    {
      "type": "discord",
      "id": "my-discord",
      "agentId": "default",
      "botToken": { "kind": "env", "value": "DISCORD_BOT_TOKEN" },
      "dmAllowlist": ["123456789012345678"],
      "channelAllowlist": ["987654321098765432"],
      "respondToMentions": true,
      "enabled": true
    }
  ]
}
```

Fields:

- `botToken` — a Discord bot token, either an env var reference (`{ "kind": "env", "value": "VAR_NAME" }`) or inline (encrypted at rest)
- `dmAllowlist` — Discord user IDs allowed to DM the bot; empty or omitted means any DM is accepted
- `channelAllowlist` — server channel IDs where the bot responds to every message
- `respondToMentions` — when `true` (the default), the bot also replies in any server channel when it's @-mentioned, even if that channel isn't in `channelAllowlist`

No QR step — once the bot token is valid, the channel connects on server boot (or when you hit Connect in the web UI).

## Channel status

Each channel has a runtime status:

- `disconnected` — not connected, waiting for QR or manual connect
- `qr` — waiting for QR code scan
- `connected` — active and receiving messages
- `error` — something went wrong; check server logs

You can monitor status through the web UI or the REST API.

## Allowlist

The allowlist restricts which phone numbers can trigger agent responses. If a message comes from a number not on the allowlist, it is silently ignored.

Leave the allowlist empty (or omit it) to allow anyone to interact.

## Session routing

Sessions are keyed by channel and sender. A message from `15551234567` on your WhatsApp channel creates a session titled `whatsapp:my-whatsapp:15551234567`. If that sender messages again, the same session is resumed.

This means each sender has a continuous conversation history even if the server restarts between messages.

## Multiple channels

You can run multiple channel instances at the same time. Each instance is independent — it has its own auth state, configuration, and session routing. You could connect two different WhatsApp numbers, or combine WhatsApp and Discord on the same server.

## Adding a new channel

New channels are added by implementing the `IChannel` interface. No changes to the core session logic, registry, or routing are required — just add a new class and a new config discriminant.

## Intended outcome

After reading this, you should be able to configure a WhatsApp channel, scan the QR code, and confirm that inbound messages are creating sessions and receiving agent replies.
