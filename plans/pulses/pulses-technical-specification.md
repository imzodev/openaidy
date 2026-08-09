# Pulses — Technical Specification

## Summary

Pulses are a user-friendly scheduling layer built on top of the existing `SchedulerService` and `SessionMessageService`. They expose a simple prompt-centric API and UI without requiring a new scheduler engine or database table.

## Design principles

- **Reuse over rebuild** — Pulses are `scheduled_job` records; no new tables required
- **Simple by default** — users think in "every 30 minutes", not cron syntax
- **Inspectable** — every execution has a recorded run with status, timestamps, and errors
- **Isolated by default** — each run gets a fresh session unless the user pins one

---

## Data model

### Storage

Pulses are stored in the existing `scheduled_jobs` table with a discriminator field:

```json
{
  "metadata": {
    "kind": "pulse",
    "name": "Daily standup summary",
    "prompt": "Summarize my notes from yesterday"
  }
}
```

The `payload` field stores execution parameters:

```json
{
  "message": "Summarize my notes from yesterday",
  "agentId": "default-agent"
}
```

### Fields used from `scheduled_jobs`

| Field             | Pulse meaning                                        |
| ----------------- | ---------------------------------------------------- |
| `id`              | Pulse ID                                             |
| `type`            | `'cron'` or `'one-shot'`                             |
| `status`          | `'active'` / `'paused'` / `'completed'` / `'failed'` |
| `cronExpression`  | Set for interval/cron schedules                      |
| `schedule`        | Set for one-shot schedules                           |
| `targetType`      | `'session'` (pinned) or `'isolated'`                 |
| `targetSessionId` | Populated when session-attached                      |
| `payload.message` | The prompt text                                      |
| `payload.agentId` | Optional agent override                              |
| `metadata.kind`   | Always `'pulse'`                                     |
| `metadata.name`   | Human-readable pulse name                            |
| `lastRunAt`       | Last execution time                                  |
| `nextRunAt`       | Next scheduled execution time                        |

### Run history

Stored in existing `job_runs` table — no changes needed.

---

## Schedule input formats

The Pulses API accepts a simplified `schedule` object that is converted to internal job fields:

```ts
// Simple interval
{ every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }

// Daily at a specific hour (UTC)
{ daily: { hour: 9, minute: 0 } }

// Full cron expression (advanced)
{ cron: string, tz?: string }

// One-shot
{ at: string } // ISO 8601 datetime
```

### Interval → cron conversion

| Input                           | Cron expression |
| ------------------------------- | --------------- |
| `every: '15m'`                  | `*/15 * * * *`  |
| `every: '30m'`                  | `*/30 * * * *`  |
| `every: '1h'`                   | `0 * * * *`     |
| `every: '6h'`                   | `0 */6 * * *`   |
| `every: '12h'`                  | `0 */12 * * *`  |
| `every: '1d'`                   | `0 0 * * *`     |
| `every: '1w'`                   | `0 0 * * 0`     |
| `daily: { hour: 9, minute: 0 }` | `0 9 * * *`     |

---

## API design

Base path: `/api/pulses`

All routes require authentication (`Authorization: Bearer <token>`).

### `POST /api/pulses`

Create a new pulse.

**Request body:**

```json
{
  "name": "Daily standup summary",
  "prompt": "Summarize what I worked on yesterday",
  "schedule": { "every": "1d" },
  "agentId": "my-agent",
  "sessionId": null
}
```

**Fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable label |
| `prompt` | string | yes | The message sent to the agent |
| `schedule` | object | yes | Schedule definition (see above) |
| `agentId` | string | no | Agent to use; defaults to system default |
| `sessionId` | string (UUID) | no | Pin to an existing session; omit for isolated runs |

**Response `201`:**

```json
{
  "pulse": {
    "id": "uuid",
    "name": "Daily standup summary",
    "prompt": "Summarize what I worked on yesterday",
    "schedule": { "every": "1d" },
    "scheduleHuman": "Every day at midnight",
    "status": "active",
    "agentId": null,
    "sessionId": null,
    "lastRunAt": null,
    "nextRunAt": "2026-04-23T00:00:00.000Z",
    "createdAt": "2026-04-22T21:00:00.000Z"
  }
}
```

---

### `GET /api/pulses`

List all pulses.

**Query params:**
| Param | Type | Description |
|---|---|---|
| `status` | `active\|paused\|completed\|failed` | Filter by status |
| `limit` | number | Max results (default 50) |
| `offset` | number | Pagination offset |

**Response `200`:**

```json
{
  "pulses": [...],
  "total": 5
}
```

---

### `GET /api/pulses/:id`

Get a single pulse.

**Response `200`:** same shape as single `pulse` object above.

---

### `PATCH /api/pulses/:id`

Update a pulse. All fields optional.

**Request body:**

```json
{
  "name": "Updated name",
  "prompt": "Updated prompt",
  "schedule": { "every": "6h" },
  "status": "paused",
  "agentId": "other-agent",
  "sessionId": null
}
```

---

### `DELETE /api/pulses/:id`

Delete a pulse and its underlying scheduled job.

**Response `204`:** no body.

---

### `POST /api/pulses/:id/trigger`

Run the pulse immediately, regardless of schedule.

**Response `200`:**

```json
{
  "run": {
    "id": "uuid",
    "pulseId": "uuid",
    "status": "succeeded",
    "startedAt": "...",
    "finishedAt": "..."
  }
}
```

---

### `GET /api/pulses/:id/history`

Get the last N execution runs for a pulse.

**Query params:** `limit` (default 20), `offset`

**Response `200`:**

```json
{
  "runs": [
    {
      "id": "uuid",
      "status": "succeeded",
      "attemptNumber": 1,
      "startedAt": "...",
      "finishedAt": "...",
      "errorCode": null,
      "errorMessage": null
    }
  ],
  "total": 14
}
```

---

## Execution flow

```
SchedulerService.tick()
  └── claimNextDueJob()              ← finds job where metadata.kind = 'pulse'
       └── executeJob(job, run)
            ├── if targetType = 'session'
            │    └── sessionMessageService.submitMessage({ sessionId, content: prompt })
            └── if targetType = 'isolated'
                 ├── sessionService.createSession({ title: `Pulse: ${name}` })
                 ├── sessionMessageService.submitMessage({ sessionId: newId, content: prompt })
                 └── (session persists for history inspection)
```

---

## Error handling

| Scenario                   | Behaviour                                                |
| -------------------------- | -------------------------------------------------------- |
| Agent unavailable          | Run marked `failed`, retry per job's `maxRetries` policy |
| Session not found (pinned) | Run marked `failed` immediately, no retry                |
| Invalid cron expression    | Rejected at create/update time with `400`                |
| Scheduler not running      | Pulses queue silently, execute on next scheduler start   |

---

## Security

- All pulse routes require a valid bearer token with `*` scope
- Pulses run with the server's own agent dispatch credentials — not the caller's token
- Isolated sessions are created server-side and are accessible in the Sessions UI for audit

---

## Human-readable schedule descriptions

The API and UI display schedules in plain English using `describeCronExpression()` from `scheduler/cron-utils.ts`. Examples:

| Cron           | Human              |
| -------------- | ------------------ |
| `*/15 * * * *` | Every 15 minutes   |
| `0 * * * *`    | Every hour         |
| `0 9 * * *`    | Every day at 9am   |
| `0 9 * * 1-5`  | Weekdays at 9am    |
| `0 0 1 * *`    | Monthly on the 1st |
