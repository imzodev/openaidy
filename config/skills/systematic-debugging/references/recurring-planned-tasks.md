# Recurring Planned Tasks: SessionId Stale Reference Bug

## Symptom

Recurring tasks with planning enabled execute only once. On the second and subsequent runs, the task doesn't work — no execution, no verification events, nothing.

**Reproduction:**

1. Create a recurring task with `plan: true`
2. Run it — works perfectly: planning session, subtask sessions, verification events
3. Wait for the second recurrence
4. Task fires but nothing happens — no planning session, no subtask execution

## Root Cause

Subtask `sessionId` references were not cleared between recurring runs.

**Data flow:**

1. Run 1 creates planning session → `subtask.sessionId = <run1-session-id>`
2. Run 1 completes → cleanup runs but **does not clear sessionIds** (when replan=never)
3. Run 2 fires → `executeSubtask` checks `subtask.sessionId ? skip : create new`
4. Old sessionId found → `skip` is called with the **dead** Run 1 session
5. Verification events route to the stale Run 1 session → silently dropped

**Key code path:**

```
task-schedule-executor.ts → executeSubtask()
  if (subtask.sessionId) {
    log('Subtask already has session, skipping creation')
    return skip(subtask.sessionId)  // ← stale session from Run 1
  }
```

The session existed and was "valid" (not null), but it belonged to a previous run and was no longer processing events.

## Fix

In the executor cleanup block (step 3, when NOT replanning), call `clearSessionIdsByTask(taskId)` to reset all `subtask.sessionId = null`. This forces each subtask to create a fresh session attached to the current run's session.

**Files changed:**

- `packages/db/src/repositories/subtasks.ts` — add `clearSessionIdsByTask(taskId: string)`
- `apps/server/src/tasks/execution/task-schedule-executor.ts` — call `clearSessionIdsByTask` in cleanup block

## Pattern: Stateful Entity References Across Multi-Run Contexts

When an entity (session, task, subtask) is reused across multiple runs of a recurring job, always verify that **cross-run references are invalidated** at the boundary of each run.

**Checklist for recurring jobs:**

- [ ] Entity IDs created in Run N are not reused in Run N+1
- [ ] Stale references from previous runs are cleared before execution
- [ ] New run gets fresh identifiers, not inherited ones

**Common failure mode:** Entities that hold references to ephemeral runtime state (session IDs, process IDs, temp file paths) must have those references reset at the start of each run. If the check `if (id) return reuse(id)` finds a non-null value from a previous run, it will reuse it even if that previous run's context is dead.
