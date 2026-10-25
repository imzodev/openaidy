---
summary: 'The proactive assistant: who you are and how to reach you, the daily briefing, alerts that only speak up when needed, and reminders agents schedule from any conversation'
read_when:
  - You want OpenAidy to message you (WhatsApp) without being asked first
  - You want a morning briefing, or to be told when something needs you
  - You want agents to remind you or follow up later in a conversation
title: 'Assistant'
---

# Assistant

OpenAidy can reach out to you, not just answer. Tell it once who you are and where to reach you, and it can brief you every morning, tell you when something needs you, and agents can come back to a conversation later on their own ("I'll check tomorrow whether they paid").

## You (Settings → Assistant)

- **Name** and **where to reach you**: a connected [channel](./channels.md) (e.g. your WhatsApp channel) and your number with country code. Agents use this to tell you apart from your customers — in a WhatsApp conversation they know whether they're talking to you or to a contact of the business, and behave accordingly.
- **Timezone** — schedules ("every day at 9:00"), reminders and what agents think "now" is all use it. Until it's set, everything is in UTC, which is how schedules always behaved. Every agent's instructions include the current date, time and timezone.
- **Quiet hours** — messages to you are held until they end (an agent can mark something urgent to send it anyway). Held messages are kept in memory, so a restart during quiet hours drops them.
- **Tell me when a workflow needs my approval or fails** — on by default. With it on, the approval message goes to you, not to the customer chat that started a [message-triggered workflow](./tasks.md#triggers-starting-a-workflow-by-itself).

## Daily briefing

Turn it on, pick a time, say what to cover ("today's calendar, unpaid invoices, important unread email") and which agent writes it. Every morning that agent looks things up with its integrations and sends you a short summary. OpenAidy adds what it knows itself: approvals waiting on you, workflows that failed in the last 24 hours, and today's reminders. **Send it now** sends one immediately (save your changes first).

## Alerts: "tell me when…"

Any [pulse](./pulses.md) can **send its answer to you**, and can be told to speak **only when there's something to say**. Together that's a watcher: "Every 30 minutes, check Stripe for payments over $500" or "every hour, look for angry customer emails" — quiet until there's something to report. The agent is reminded what it last told you, so the same alert isn't sent twice.

## Reminders and follow-ups

Every agent can schedule something for later **in the same conversation**:

- "Remind me Friday at 9 to call Ana" — at that time the agent gets its instructions back in that conversation and acts on them.
- "Check tomorrow whether Acme paid; only tell me if they haven't" — a follow-up that stays quiet if there's nothing to say.

If the conversation is on WhatsApp (or Discord), the reply goes to that chat — so a customer conversation can be followed up, and your own WhatsApp chat with the agent gets your reminders. Upcoming reminders are listed on the Pulses page, where they can be cancelled.

The tools behind this are available to every agent: `reminder_create`, `reminder_list`, `reminder_cancel` and `notify_owner` (send you a message). `pulses_create` takes `sendToOwner` and `onlyIfNeeded`.

## How it works

Briefings, alerts and reminders are all scheduled prompts run by the scheduler, like pulses (`scheduled_jobs` with `metadata.kind` `pulse`, `reminder` or `briefing`). Before a run, the prompt gets the extra instructions (reminder framing, briefing facts, "answer exactly `NO_UPDATE` if there's nothing to say", the last message sent). After it, the answer is sent to you and/or back to the conversation's chat, and stored with the run so the Pulses history shows what was said and where it went. Which chat a conversation belongs to is recorded when its messages arrive (`session_channels`).
