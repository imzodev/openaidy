---
name: Sending Messages
description: Use when posting to chat or email on the user's behalf — Slack, Discord, Telegram, or mail — through an available integration. Get the recipient and content right, and confirm before anything goes out.
version: 1.0.0
---

# Sending Messages

A sent message can't be unsent. When you post to a channel or send mail as
the user, you're speaking with their voice to real people — so verify the
destination and the words before they leave.

## Before sending

- Confirm a messaging or email tool (or a configured MCP server) exists for
  the target platform. If not, say what to configure.
- Nail down three things: **who** — the exact channel, DM, or address;
  **what** — the final text; and **as whom** — which account or identity.
- Draft first. Show the user the recipient and the message and get a yes
  before sending, unless they've clearly pre-authorized this exact send.

## Writing the message

- Match the register of the channel: a team chat is not a formal email.
  Mirror how the user writes there if you have examples.
- Lead with the point. People skim — put the ask or the update in the first
  line.
- Keep formatting native to the platform (chat markup, or an email with a
  clear subject and body).
- Don't mention groups, reply to everyone, or cross-post widely unless
  asked. The blast radius is easy to underestimate.

## After sending

- Report exactly what went where — channel or address, plus a copy of the
  text.
- If a send fails, surface the error. Do not silently retry to a different
  recipient.

See `references/message-checklist.md`.

## Anti-patterns

- Sending before confirming recipient and content.
- Guessing an address or channel from a partial name.
- Adding commitments or opinions the user didn't authorize.
- Firing the same message repeatedly after an ambiguous failure.
