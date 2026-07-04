---
name: Scheduling
description: Use when working with calendars — checking availability, finding meeting times, and creating or updating events through an available calendar integration — with careful timezone handling and confirmation before inviting others.
version: 1.0.0
---

# Scheduling

Calendar mistakes are public and awkward: a meeting at 3 AM someone's time,
a double-booking, an invite to the wrong people. Get the timezone and the
guest list right, then confirm before it lands on anyone else's calendar.

## Before you touch a calendar

- Confirm a calendar tool or configured MCP server is available. If not,
  say what to connect.
- Establish the timezone explicitly — the user's, and each attendee's if
  they differ. Never assume UTC or your own.
- Know whether this is the user's own event or one that invites others; the
  latter needs confirmation.

## Finding a time

- Read existing events before proposing slots. Respect working hours and
  commitments already on the calendar.
- Offer 2–3 concrete options with the timezone spelled out — "Tue 2pm PT /
  5pm ET" — not a vague "sometime Tuesday."
- Account for travel or buffer between back-to-back meetings when it
  matters.

## Creating or changing events

- Include a clear title, the correct start/end with timezone, and a short
  agenda or context in the body.
- Add attendees only when asked, and confirm the list before sending
  invites.
- For an edit or cancel, state what's changing and who gets notified before
  you do it.
- Afterward, report the final details and the local time for each key
  attendee.

See `references/scheduling-checklist.md`.

## Anti-patterns

- Creating an event in the wrong timezone because none was confirmed.
- Inviting people before the user approved the guest list.
- Overwriting or deleting an existing event without flagging it.
- Proposing times that collide with commitments already on the calendar.
