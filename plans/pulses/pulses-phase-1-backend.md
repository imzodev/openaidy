# Phase 1: Backend — Pulses Implementation

## Overview

Phase 1 implements the server-side infrastructure for Pulses: isolated session execution in the scheduler, a dedicated `/api/pulses` REST API, and wiring into the app.

## Objectives

- Implement isolated session execution in `SchedulerService`
- Create schedule input parsing utilities
- Build `/api/pulses` REST routes (CRUD + trigger + history)
- Register pulse routes in `app.ts`

---

## Implementation Tasks

### 1. Isolated Session Execution

#### 1.1 Inject `SessionsStore` into `SchedulerService`

**File: `apps/server/src/scheduler/service.ts`**

Add `sessionsStore: SessionsStore` as a constructor parameter after `sessionMessageService`.

Update `createSchedulerService` factory to accept and pass it through.

#### 1.2 Implement isolated execution branch

**File: `apps/server/src/scheduler/service.ts`**

In `executeJob`, replace the `throw new Error('Isolated job execution not yet implemented')` with:

1. Call `sessionsStore.create({ title: 'Pulse: <name>', agentId })` to create a fresh session
2. Call `sessionMessageService.submitMessage({ sessionId: newSession.id, role: 'user', content: job.payload.message })`
3. Throw if result is not ok

#### 1.3 Update `app.ts` call site

**File: `apps/server/src/app.ts`**

Pass `dbAdapter.repositories.sessions` as the new argument to `createSchedulerService`.

#### 1.4 Add test for isolated execution

**File: `apps/server/src/scheduler/service.test.ts`**

Add a test case: isolated job creates a session and submits the message successfully.

---

### 2. Schedule Utilities

#### 2.1 Create `pulses/utils.ts`

**File: `apps/server/src/pulses/utils.ts`**

Implement `parseScheduleInput(schedule) → { type, cronExpression?, nextRunAt }`:

- `{ every: '15m' }` → cron `*/15 * * * *`
- `{ every: '30m' }` → cron `*/30 * * * *`
- `{ every: '1h' }` → cron `0 * * * *`
- `{ every: '6h' }` → cron `0 */6 * * *`
- `{ every: '12h' }` → cron `0 */12 * * *`
- `{ every: '1d' }` → cron `0 0 * * *`
- `{ every: '1w' }` → cron `0 0 * * 0`
- `{ daily: { hour, minute } }` → cron `<minute> <hour> * * *`
- `{ cron: string }` → pass through, validate with `validateCronExpression`
- `{ at: string }` → one-shot, parse as ISO datetime

#### 2.2 Implement `jobToPulse(job) → PulseRecord`

**File: `apps/server/src/pulses/utils.ts`**

Maps a `ScheduledJob` to the public pulse response shape:

- Extract `name` and `prompt` from `job.metadata`
- Derive `scheduleHuman` from `describeCronExpression(job.cronExpression)`
- Return `id`, `name`, `prompt`, `schedule`, `scheduleHuman`, `status`, `agentId`, `sessionId`, `lastRunAt`, `nextRunAt`, `createdAt`

#### 2.3 Define `ScheduleInput` type

**File: `apps/server/src/pulses/utils.ts`**

```ts
export type ScheduleInput =
  | { every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }
  | { daily: { hour: number; minute: number } }
  | { cron: string; tz?: string }
  | { at: string };
```

---

### 3. Pulse Routes

#### 3.1 Create `routes/pulses.ts`

**File: `apps/server/src/routes/pulses.ts`**

Define plugin options type:

```ts
export type PulseRoutesOptions = {
  jobsRepo: JobsStore;
  jobRunsRepo: JobRunsStore;
  sessionsRepo: SessionsStore;
  schedulerService: SchedulerService;
  authMiddleware: AuthMiddleware;
};
```

Apply `requireAuth` preHandler on all routes.

#### 3.2 Implement `POST /api/pulses`

1. Parse and validate body with Zod (`name`, `prompt`, `schedule`, optional `agentId`, `sessionId`)
2. If `sessionId` provided, verify session exists — return `404` if not
3. Call `parseScheduleInput(schedule)` → `{ type, cronExpression?, nextRunAt }`
4. Call `jobsRepo.create(...)` with `metadata: { kind: 'pulse', name }`, `payload: { message: prompt, agentId }`
5. Return `201` with `jobToPulse(job)`

#### 3.3 Implement `GET /api/pulses`

1. Fetch jobs from `jobsRepo` — filter where `metadata.kind === 'pulse'`
2. Map with `jobToPulse`
3. Return `{ pulses, total }`

#### 3.4 Implement `GET /api/pulses/:id`

1. Find job by id
2. Verify `metadata.kind === 'pulse'` — return `404` if not
3. Return `jobToPulse(job)`

#### 3.5 Implement `PATCH /api/pulses/:id`

1. Validate body (all fields optional: `name`, `prompt`, `schedule`, `status`, `agentId`, `sessionId`)
2. Find and verify pulse exists
3. Re-parse schedule if provided → update `cronExpression` / `nextRunAt`
4. Call `jobsRepo.update(id, { ... })`
5. Return updated `jobToPulse(job)`

#### 3.6 Implement `DELETE /api/pulses/:id`

1. Find and verify pulse exists
2. Call `jobsRepo.delete(id)`
3. Return `204`

#### 3.7 Implement `POST /api/pulses/:id/trigger`

1. Find and verify pulse exists
2. Delegate to `schedulerService.triggerJob(id)`
3. Return `{ run }` with the run record

#### 3.8 Implement `GET /api/pulses/:id/history`

1. Find and verify pulse exists
2. Fetch runs with `jobRunsRepo.listByJobId(id, { limit, offset })`
3. Return `{ runs, total }`

---

### 4. Register Routes

#### 4.1 Import and register in `app.ts`

**File: `apps/server/src/app.ts`**

Add import for `pulseRoutes`. Inside the `dbAdapter` block alongside the scheduler routes registration:

```ts
await app.register(pulseRoutes, {
  schedulerService: services.scheduler,
  jobsRepo: services.jobsRepo,
  jobRunsRepo: services.jobRunsRepo,
  sessionsRepo: services.sessionsRepo,
  authMiddleware,
});
```

---

## Success Criteria

- `POST /api/pulses` creates a pulse and returns it with `nextRunAt` populated
- `GET /api/pulses` lists only pulses, not other job types
- `PATCH /api/pulses/:id` updates prompt, schedule, and status correctly
- `DELETE /api/pulses/:id` removes the job and returns `204`
- `POST /api/pulses/:id/trigger` runs the pulse immediately and returns a run record
- `GET /api/pulses/:id/history` returns past runs ordered by most recent
- Isolated pulses create a new session and execute successfully
- Session-attached pulses fire into the pinned session
