---
name: Browser Automation
description: Use when a task needs a real browser — navigating sites, filling and submitting forms, clicking through flows, extracting page data, or taking screenshots — driving whatever browser tool or MCP server is available.
version: 1.0.0
---

# Browser Automation

Some things only exist behind a page: a login-walled dashboard, a form with
no API, a site that renders with JavaScript. Drive a browser to do them —
deliberately, one observable step at a time.

## Before you start

- Confirm a browser tool or configured MCP server (Playwright, Puppeteer, a
  browser MCP, etc.) is available. If not, tell the user what to set up
  instead of pretending to click.
- Restate the goal as a concrete end state — "reach the order-confirmation
  page", "extract the table rows". You need to know when you're done.
- Flag any step that spends money, sends a message, or changes someone
  else's data, and get explicit approval before running it.

## Method

- Navigate, then observe before acting. Read the actual page — visible
  text, form fields, current URL — rather than assuming the layout.
- Prefer stable selectors: visible labels, roles, and text over brittle
  CSS/xpath tied to generated class names.
- Do one action, then re-check the result. Don't fire a long sequence blind
  and hope it worked.
- Wait for the page to settle — network idle, element present — instead of
  fixed-duration sleeps.
- Capture a screenshot at decision points and on failure. It's your
  evidence of what actually happened.

## Guardrails

- Never submit a purchase, booking, message, or account change without
  confirming first.
- Don't enter credentials the user didn't give you; use the browser's
  existing session or profile where possible.
- Stop and report if you hit a login wall, a CAPTCHA, or a page you didn't
  expect — don't thrash.

See `references/automation-recipe.md`.

## Anti-patterns

- Assuming a selector still exists instead of checking the current page.
- Chaining many clicks with no verification between them.
- Treating a fixed "wait 5 seconds" as a substitute for a real condition.
- Auto-accepting consent or purchase dialogs that have real consequences.
