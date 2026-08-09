# Phase 5: Built-in Tools

## Overview

Phase 5 exposes the schedule functionality to AI agents through the built-in tool registry. Instead of extending the existing `tasks_*` tools (which would have bloated them), we introduce a separate `task_schedules_*` namespace — mirroring the 1:1 relationship between tasks and their schedules (a task has zero or one schedule).

An agent can now read a task's schedule, attach a new schedule, update it, pause/resume, trigger an immediate run, and inspect execution history — all through the `task_schedules_*` tool namespace.

This is what makes recurring tasks usable from the chat UI: an agent can say "I'll run this task every hour from now on" and have it actually happen.

## Design decision: separate `task_schedules_*` namespace

Rather than extending `tasks_create`, `tasks_update`, and `tasks_list`, we chose a dedicated namespace:

| Rationale                     | Detail                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Clean separation**          | The existing `tasks_*` tools remain simple and unchanged. Schedule operations have their own domain with dedicated verbs.                 |
| **1:1 mapping with REST API** | The REST API has `/api/tasks/:id/schedule` endpoints — the tool namespace mirrors this structure naturally.                               |
| **DRY service layer**         | All tools delegate to `TaskScheduleService`, which already implements the full lifecycle. Tools are thin pass-throughs.                   |
| **Lazy registration**         | The `getTaskScheduleService` getter follows the same pattern as `getTaskService`. Tools gracefully degrade when the DB is not configured. |

## Objectives

- Add `task_schedules_list` — read the schedule for a task
- Add `task_schedules_create` — attach a schedule to an existing task
- Add `task_schedules_update` — patch fields (replan policy, maxExecutions, status, schedule)
- Add `task_schedules_pause` — pause a schedule (preserves row and history)
- Add `task_schedules_resume` — resume a paused schedule
- Add `task_schedules_trigger` — force an immediate run (async)
- Add `task_schedules_delete` — remove the schedule (with `confirm=true` safety interlock)
- Add `task_schedules_list_executions` — paginated history of past runs
- Add all 8 `ToolMeta` entries to `ALL_TOOL_METAS` in [`catalog.ts`](apps/server/src/tools/catalog.ts)
- Register the tools via `createTaskScheduleTools()` in [`tools/index.ts`](apps/server/src/tools/index.ts)
- Follow the existing tool naming conventions (snake_case, no abbreviations)
- Add tool tests with mocked services

## Success criteria

- All 8 tools are registered in the catalog
- All 8 tools are registered in [`BuiltinToolRegistry`](apps/server/src/tools/registry.ts) when `getTaskScheduleService` is provided
- An agent can call `task_schedules_create` with a `schedule` parameter and the result includes the schedule
- An agent can call `task_schedules_pause`/`task_schedules_resume` to control execution
- An agent can call `task_schedules_delete` with `confirm=true` to remove a schedule
- An agent can call `task_schedules_list_executions` and get a paginated history
- Tool descriptions are clear and self-explanatory
- All tools delegate to `TaskScheduleService` — they are thin pass-throughs
- All tools return the standard `ServiceResult` shape (via the BuiltinTool `{ ok, content/error }` pattern)

---

## Implementation

### Files created

| File                                                                                                       | Purpose                                                              |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`apps/server/src/tools/task-schedules/types.ts`](apps/server/src/tools/task-schedules/types.ts)           | `TaskScheduleToolDeps` type                                          |
| [`apps/server/src/tools/task-schedules/utils.ts`](apps/server/src/tools/task-schedules/utils.ts)           | Shared `buildScheduleInput()` helper (used by `create` and `update`) |
| [`apps/server/src/tools/task-schedules/list.ts`](apps/server/src/tools/task-schedules/list.ts)             | `task_schedules_list` tool                                           |
| [`apps/server/src/tools/task-schedules/create.ts`](apps/server/src/tools/task-schedules/create.ts)         | `task_schedules_create` tool                                         |
| [`apps/server/src/tools/task-schedules/update.ts`](apps/server/src/tools/task-schedules/update.ts)         | `task_schedules_update` tool                                         |
| [`apps/server/src/tools/task-schedules/pause.ts`](apps/server/src/tools/task-schedules/pause.ts)           | `task_schedules_pause` tool                                          |
| [`apps/server/src/tools/task-schedules/resume.ts`](apps/server/src/tools/task-schedules/resume.ts)         | `task_schedules_resume` tool                                         |
| [`apps/server/src/tools/task-schedules/delete.ts`](apps/server/src/tools/task-schedules/delete.ts)         | `task_schedules_delete` tool                                         |
| [`apps/server/src/tools/task-schedules/trigger.ts`](apps/server/src/tools/task-schedules/trigger.ts)       | `task_schedules_trigger` tool                                        |
| [`apps/server/src/tools/task-schedules/executions.ts`](apps/server/src/tools/task-schedules/executions.ts) | `task_schedules_list_executions` tool                                |
| [`apps/server/src/tools/task-schedules/index.ts`](apps/server/src/tools/task-schedules/index.ts)           | Barrel + `createTaskScheduleTools()` factory                         |

### Files modified

| File                                                                   | Change                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/server/src/tools/catalog.ts`](apps/server/src/tools/catalog.ts) | Added 8 `ToolMeta` entries in a new `Task Schedules` section, appended to `ALL_TOOL_METAS`                                        |
| [`apps/server/src/tools/index.ts`](apps/server/src/tools/index.ts)     | Added `getTaskScheduleService` to `BuiltinToolRegistryDeps`, wired `createTaskScheduleTools()` into `createBuiltinToolRegistry()` |
| [`apps/server/src/app.ts`](apps/server/src/app.ts)                     | Passed `getTaskScheduleService: () => taskScheduleService` to the registry builder                                                |

### Architecture

```
Agent calls task_schedules_*
        │
        ▼
BuiltinToolRegistry ──► task-schedules/*.ts (thin tool wrapper)
                              │
                              ▼
                       TaskScheduleService
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              Repo Layer  Executor   Pulse Utils
              (CRUD)      (trigger)  (parseScheduleInput)
```

Each tool is a `BuiltinTool` with:

- `name` — from the catalog `ToolMeta`
- `description` — from the catalog `ToolMeta`
- `parameters` — inline JSON Schema (consistent with other builtin tools)
- `execute(args, ctx)` — validates inputs, delegates to the service, formats the response

### Tool details

#### `task_schedules_list`

Read the schedule attached to a task. Schedules are 1:1 with tasks.

- **Input**: `taskId` (required)
- **Output**: Human-readable schedule info (`ID`, `Schedule`, `Status`, `Replan policy`, `Max executions`, `Next run`, etc.)
- **Not found**: Returns a friendly "No schedule attached to task" message (still `ok: true`)

#### `task_schedules_create`

Attach a schedule to an existing task. Refuses if the task already has a schedule.

- **Input**: `taskId`, `schedule` (required); `replanPolicy`, `maxExecutions` (optional)
- **Schedule shape**: `{ every, daily, cron, at }` — same discriminated union as pulses
- **Output**: Created schedule details

#### `task_schedules_update`

Patch an existing schedule. All fields except `taskId` are optional.

- **Input**: `taskId` (required); `schedule`, `replanPolicy`, `maxExecutions`, `status` (optional)
- **Validation**: Rejects empty body (at least one field must be provided)
- **Note**: Prefer `pause`/`resume` tools for status toggles — they encode intent more clearly

#### `task_schedules_pause`

Pause a schedule. The scheduler skips this row until resumed. The schedule row, its `nextRunAt`, and execution history are preserved.

- **Input**: `taskId` (required)
- **Output**: Updated schedule with `status: 'paused'`

#### `task_schedules_resume`

Resume a paused schedule. The next run happens at the next cron tick after the resume time — missed runs are NOT caught up.

- **Input**: `taskId` (required)
- **Output**: Updated schedule with `status: 'active'`

#### `task_schedules_delete`

Permanently remove a task's schedule. Execution history rows are cascade-deleted.

- **Input**: `taskId`, `confirm` (both required)
- **Safety**: `confirm=true` is a mandatory interlock against accidental deletion

#### `task_schedules_trigger`

Force an immediate run of a task schedule, without affecting `nextRunAt` or `executionCount`.

- **Input**: `taskId` (required)
- **Output**: `History ID` for tracking
- **Async**: Returns immediately; poll `task_schedules_list_executions` to track progress

#### `task_schedules_list_executions`

Paginated history of past runs, newest first.

- **Input**: `taskId` (required); `status`, `limit` (default 20, max 100), `offset` (optional)
- **Output**: Each run includes `id`, `status`, `startedAt`, `durationMs`, `didReplan`, `sessionId`, and error info for failed runs

### Shared utility: `buildScheduleInput()`

Extracted to [`utils.ts`](apps/server/src/tools/task-schedules/utils.ts) to avoid duplication between [`create.ts`](apps/server/src/tools/task-schedules/create.ts) and [`update.ts`](apps/server/src/tools/task-schedules/update.ts). Converts the tool's `schedule` object shape into a `ScheduleInput` discriminated union.

---

## Tests

**File: [`apps/server/src/tools/task-schedules/task-schedules.test.ts`](apps/server/src/tools/task-schedules/task-schedules.test.ts)**

20 test cases covering:

| Area                             | Tests                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Registration                     | 8 tools registered, correct names, `task_schedules_` prefix                                                         |
| Service unavailable              | Every tool returns a friendly error when service is `undefined`                                                     |
| `task_schedules_list`            | Returns schedule for task, "no schedule" message, empty taskId rejection                                            |
| `task_schedules_create`          | Preset, cron+tz, replanPolicy/maxExecutions pass-through, missing taskId/schedule rejection, service error verbatim |
| `task_schedules_update`          | Field updates, status pass-through, empty body rejection, missing taskId                                            |
| `task_schedules_pause`           | Pauses and returns updated schedule, service error, requires taskId                                                 |
| `task_schedules_resume`          | Resumes and returns updated schedule, service error, requires taskId                                                |
| `task_schedules_delete`          | Success with confirm=true, safety interlock (false/omitted), 404 error                                              |
| `task_schedules_trigger`         | History ID returned, no-schedule error, requires taskId                                                             |
| `task_schedules_list_executions` | Pagination, status filter, empty result message, error info for failed runs                                         |

All tests use a mock `TaskScheduleService` — the tools are thin pass-throughs.

---

## Rollout

Phase 5 makes the feature accessible to agents. The user can now ask in chat: "Make this task run every hour."

Rollout steps:

1. Ship the tool changes (all files in `apps/server/src/tools/task-schedules/` + catalog + registry wiring)
2. Run the test suite: `npx vitest run apps/server/src/tools/task-schedules/task-schedules.test.ts`
3. Manual chat test: ask the agent to "show me the schedule for task X" → verify it uses `task_schedules_list`
4. Verify all 8 new tools appear in the agent's tool manifest (built from `ALL_TOOL_METAS`)
5. If clean, proceed to Phase 6

## Risk assessment

| Risk                                             | Mitigation                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Agent accidentally removes a schedule            | `task_schedules_delete` requires `confirm=true` explicitly — not destructive by default          |
| Tool description is misleading                   | Descriptions are reviewed for clarity; examples in description help                              |
| Tool call overflows token budget                 | Parameter schemas are inline JSON Schema (no Zod) matching existing tool patterns                |
| New tools appear in system prompt unexpectedly   | The agent's tool list grows by 8; tested for prompt length                                       |
| Missing tool implementations for catalog entries | All 8 catalog entries have corresponding tool implementations in the `task-schedules/` directory |
