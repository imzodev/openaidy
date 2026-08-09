---
summary: 'Token usage and cost tracking, per session, per day, per provider, per model'
read_when:
  - You want to see how much your agents are costing you
title: 'Usage'
---

# Usage

Every [run](./sessions.md#runs) records its token usage — prompt tokens, completion tokens, cache reads, cache writes — and, when pricing is known for the model, a cost. The **Usage** page in the web UI aggregates this across your whole instance.

## What you can see

- **Totals** — overall runs, tokens, and cost across everything
- **By day** — a daily breakdown, useful for spotting spikes
- **By provider** and **by model** — where your usage/cost is actually going
- **By day and model** — the combined view that powers the stacked usage chart

Per-session usage is also available — open a session and its usage summary shows totals for just that conversation.

## When cost isn't shown

Cost is only computed when OpenAidy has pricing data for that model. If you're using a provider/model without built-in pricing (a brand-new model, a custom local model), the run still records token counts — you just won't see a dollar figure until you add a [pricing override](./config.md#per-model-pricing-overrides).

## API

- `GET /api/usage` — aggregate report (totals, by day, by provider, by model, by day+model)
- `GET /api/usage/sessions` — per-session usage list
- `GET /api/sessions/:sessionId/usage` — usage for one session
