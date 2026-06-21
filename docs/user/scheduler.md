---
summary: 'Schedule and automate agent work with cron jobs, one-shot timers, and retries'
read_when:
  - You want to set up a recurring task like daily summaries or periodic checks
  - You need a one-shot delayed reminder or background job
  - You want to understand job run history and retry behavior
title: 'Scheduler'
---

# Scheduler

The OpenAidy scheduler lets you automate agent work on a recurring or one-shot basis. Jobs run in the background without needing an active UI session.

## Job types

### Cron jobs

Cron jobs repeat on a schedule defined by a cron expression. Examples:

- `0 9 * * *` — every day at 9:00 AM
- `*/15 * * * *` — every 15 minutes
- `0 10 * * 1` — every Monday at 10:00 AM

### One-shot jobs

One-shot jobs run once at a specific time or after a delay. Use them for reminders, delayed actions, or deferred work.

## Creating a job

Jobs are created through the REST API:

```
POST /api/jobs
{
  "name": "Daily summary",
  "schedule": "0 9 * * *",
  "type": "cron",
  "agentId": "my-agent",
  "payload": {
    "content": "Give me a summary of today's sessions"
  },
  "target": {
    "type": "session",
    "id": "session-123"
  }
}
```

For one-shot jobs, use `type: "one-shot"` and set `runAt` to an ISO timestamp instead of a cron expression.

## Delivery targets

When a job runs, its output can be delivered in different ways:

- **Session** — the agent response is appended to a session transcript
- **Channel** — the response is sent back through a connected messaging channel (for example, a WhatsApp reply)
- **Webhook** — the response is POSTed to an external URL as JSON

Choose the target that fits your workflow.

## Retries and failure handling

If a job run fails, OpenAidy can retry it automatically. You can configure:

- `maxRetries` — how many times to retry before giving up
- `retryDelay` — backoff strategy between retries
- `retryPolicy` — fixed or exponential backoff

Failed runs are recorded in job run history with the error so you can inspect what went wrong.

## Run history

Every job execution is recorded with:

- run ID
- start and end timestamps
- status (running, complete, failed, retrying)
- input payload
- output or error message
- token usage if applicable

You can query run history through the API to track job performance over time.

## Job locking

OpenAidy uses a locking mechanism to prevent double-runs. When a scheduled time fires, a lock is acquired before execution starts. If the server restarts mid-run, the lock is released so the job can run again on the next scheduled time.

This means a job may occasionally run later than its exact cron time if the previous run was delayed, but it will not run twice at the same time.

## Pausing and resuming

You can pause a recurring job so it stops firing, then resume it later. Pausing does not clear run history or reset the schedule.

## Canceling a job

One-shot jobs are automatically removed after they run. Cron jobs persist until you explicitly cancel them.

## Monitoring scheduled jobs

The web UI shows all jobs with their next scheduled run time, last run status, and a link to full run history. You can also query this data through the REST API.

## Intended outcome

After reading this, you should be able to create a cron job, inspect run history, configure retries, and understand how delivery targets work.
