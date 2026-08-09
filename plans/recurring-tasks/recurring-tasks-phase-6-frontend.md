# Phase 6: Web UI

## Overview

Phase 6 brings the feature to the operator UI. The Schedule tab in `TaskModal` lets users configure recurrence. The Kanban card shows a recurring badge. A new `TaskExecutionsPage` shows the run history. The visual language matches the existing Pulses UI for consistency.

The UI is a thin client over the API routes added in Phase 4. No business logic lives in the frontend.

## Objectives

- Add a Schedule tab to `TaskModal` with: schedule type selector, preset/cron/one-shot inputs, validation, status display, and pause/resume/trigger buttons
- Add a recurring badge to `TaskCard` on the Kanban board
- Create `TaskExecutionsPage` at `/tasks/:id/executions` with a paginated history table
- Extract shared `ScheduleEditor` and `ScheduleDisplay` components to `apps/web/src/components/common/`
- Update `apps/web/src/lib/api-tasks.ts` with the new API methods
- Update the routing in `apps/web/src/lib/router.ts` to include the new view
- Add optimistic updates where appropriate (pause/resume should feel instant)

## Success criteria

- The Schedule tab is reachable from any task modal
- The schedule editor matches the Pulses editor (same inputs, same validation)
- The Kanban card shows a recurring badge when a schedule is attached
- The executions page paginates and links to the underlying session
- All API calls go through `lib/api-tasks.ts` — no raw fetch in components
- The UI is responsive (no layout shift when the tab loads)
- The web app builds without TypeScript errors
- Existing UI continues working (no regressions)

---

## Implementation tasks

### 1. Extend the API client

**Update: `apps/web/src/lib/api-tasks.ts`**

Add the new methods:

```ts
export type TaskSchedule = {
  id: string;
  taskId: string;
  schedule: {
    every?: string;
    daily?: { hour: number; minute: number };
    cron?: string;
    at?: string;
  };
  cronExpression: string | null;
  preset: string | null;
  scheduleDate: string | null;
  nextRunAt: string;
  lastRunAt: string | null;
  status: 'active' | 'paused' | 'expired';
  replanPolicy: 'never' | 'on-description-change' | 'always';
  maxExecutions: number; // always finite (default 9999)
  remainingExecutions: number; // maxExecutions - executionCount, computed server-side
  executionCount: number;
  scheduleHuman: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskExecutionHistoryItem = {
  id: string;
  taskId: string;
  scheduleId: string;
  status:
    | 'planned'
    | 'planning'
    | 'executing'
    | 'verifying'
    | 'completed'
    | 'failed';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sessionId: string | null;
  attemptNumber: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export async function getTaskSchedule(
  taskId: string,
  token: string,
): Promise<TaskSchedule | null> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/schedule`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch task schedule: ${res.status}`);
  return res.json();
}

export async function createOrUpdateTaskSchedule(
  taskId: string,
  input: {
    schedule: ScheduleInput;
    maxExecutions?: number;
    status?: 'active' | 'paused';
  },
  token: string,
): Promise<TaskSchedule> {
  // POST handles "add" if no schedule exists; PATCH handles "update"
  const existing = await getTaskSchedule(taskId, token);
  if (existing) {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}/schedule`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok)
      throw new Error(`Failed to update task schedule: ${res.status}`);
    return res.json();
  } else {
    const res = await fetch(`${API_BASE}/api/tasks/${taskId}/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok)
      throw new Error(`Failed to create task schedule: ${res.status}`);
    return res.json();
  }
}

export async function removeTaskSchedule(
  taskId: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/schedule`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404)
    throw new Error(`Failed to remove schedule: ${res.status}`);
}

export async function pauseTaskSchedule(
  taskId: string,
  token: string,
): Promise<TaskSchedule> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/schedule/pause`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to pause schedule: ${res.status}`);
  return res.json();
}

export async function resumeTaskSchedule(
  taskId: string,
  token: string,
): Promise<TaskSchedule> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/schedule/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to resume schedule: ${res.status}`);
  return res.json();
}

export async function triggerTaskNow(
  taskId: string,
  token: string,
): Promise<{ historyId: string }> {
  const res = await fetch(`${API_BASE}/api/tasks/${taskId}/trigger`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to trigger task: ${res.status}`);
  return res.json();
}

export async function listTaskExecutions(
  taskId: string,
  filters: { status?: string; limit?: number; offset?: number } = {},
  token: string,
): Promise<{
  items: TaskExecutionHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined)
    params.set('offset', String(filters.offset));
  const res = await fetch(
    `${API_BASE}/api/tasks/${taskId}/executions?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Failed to list executions: ${res.status}`);
  return res.json();
}
```

### 2. Extract the `ScheduleEditor` component

**New file: `apps/web/src/components/common/ScheduleEditor.tsx`**

A reusable component for editing a schedule. Reused by both the Pulses page and the Task Modal Schedule tab.

```tsx
import { createSignal, Show } from 'solid-js';

export type ScheduleEditorValue =
  | { kind: 'every'; every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'cron'; cron: string; tz?: string }
  | { kind: 'at'; at: string };

export type ScheduleEditorProps = {
  value: ScheduleEditorValue | null;
  onChange: (value: ScheduleEditorValue | null) => void;
  // Validation: returns an error message string or null
  validate?: (value: ScheduleEditorValue) => string | null;
};

const PRESETS = ['15m', '30m', '1h', '6h', '12h', '1d', '1w'] as const;

export function ScheduleEditor(props: ScheduleEditorProps) {
  const [kind, setKind] = createSignal<ScheduleEditorValue['kind']>(
    props.value?.kind ?? 'every',
  );

  // ... renders a type selector + the appropriate input for the chosen kind
  // ... displays the human-readable preview using describeCronExpression
  // ... calls onChange with the current value
  // ... shows the validation error if any
}
```

The implementation mirrors the pattern used in `apps/web/src/components/pulses/PulseForm.tsx` (or whichever component the existing Pulses UI uses). Extract from there to avoid duplication.

### 3. Extract the `ScheduleDisplay` component

**New file: `apps/web/src/components/common/ScheduleDisplay.tsx`**

A small read-only display used in `TaskCard`, the executions page, and the modal header.

```tsx
import type { TaskSchedule } from '../../lib/api-tasks';

export type ScheduleDisplayProps = {
  schedule: TaskSchedule;
  size?: 'sm' | 'md';
  showStatus?: boolean;
};

export function ScheduleDisplay(props: ScheduleDisplayProps) {
  // Renders an icon (Repeat, Calendar, Clock) + the human-readable text
  // Optionally shows status badge (active/paused/expired)
  // For 'sm' size, used in TaskCard. For 'md', used in the modal header.
}
```

### 4. Add the Schedule tab to `TaskModal`

**Update: `apps/web/src/components/tasks/TaskModal.tsx`**

Currently the modal has tabs: `Details`, `Subtasks`, `Agents`, `History`. Add `Schedule`.

```tsx
const TABS = ['details', 'subtasks', 'agents', 'history', 'schedule'] as const;
type Tab = (typeof TABS)[number];

// Inside the modal body, add a new branch:
<Show when={activeTab() === 'schedule'}>
  <TaskScheduleTab taskId={props.task.id} onClose={props.onClose} />
</Show>;
```

**New file: `apps/web/src/components/tasks/TaskScheduleTab.tsx`**

```tsx
import { createResource, createSignal, Show } from 'solid-js';
import {
  getTaskSchedule,
  createOrUpdateTaskSchedule,
  removeTaskSchedule,
  pauseTaskSchedule,
  resumeTaskSchedule,
  triggerTaskNow,
} from '../../lib/api-tasks';
import { resolveToken } from '../../lib/auth-token';
import {
  ScheduleEditor,
  type ScheduleEditorValue,
} from '../common/ScheduleEditor';
import { ScheduleDisplay } from '../common/ScheduleDisplay';

export function TaskScheduleTab(props: {
  taskId: string;
  onClose: () => void;
}) {
  const [schedule, { refetch }] = createResource(
    () => props.taskId,
    async (id) => {
      return getTaskSchedule(id, resolveToken() ?? '');
    },
  );

  const [editing, setEditing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Render:
  // - Loading state while fetching
  // - If no schedule exists: empty state + "Add schedule" button → shows editor
  // - If schedule exists: ScheduleDisplay + status badge + action buttons (Pause, Resume, Run now, Edit, Remove)
  // - When editing: show the ScheduleEditor with Save/Cancel buttons
}
```

### 5. Add the recurring badge to `TaskCard`

**Update: `apps/web/src/components/tasks/TaskCard.tsx`**

```tsx
import { Show } from 'solid-js';
import type { Task } from '../../lib/api-tasks';
import { Repeat } from 'lucide-solid';

export function TaskCard(props: { task: Task & { schedule?: TaskSchedule } }) {
  return (
    <div class="task-card ...">
      <h3>{props.task.title}</h3>
      <Show when={props.task.schedule}>
        {(schedule) => (
          <div class="flex items-center gap-1 text-xs text-gray-500">
            <Repeat class="w-3 h-3" />
            <span>{schedule().scheduleHuman}</span>
            <Show when={schedule().status === 'paused'}>
              <span class="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                paused
              </span>
            </Show>
          </div>
        )}
      </Show>
      {/* ... rest of card ... */}
    </div>
  );
}
```

### 6. Create `TaskExecutionsPage`

**New file: `apps/web/src/components/pages/TaskExecutionsPage.tsx`**

```tsx
import { createResource, createSignal, For, Show } from 'solid-js';
import {
  listTaskExecutions,
  type TaskExecutionHistoryItem,
} from '../../lib/api-tasks';
import { resolveToken } from '../../lib/auth-token';
import { useParams } from '@solidjs/router';

const STATUS_COLORS: Record<TaskExecutionHistoryItem['status'], string> = {
  planned: 'bg-gray-100 text-gray-700',
  planning: 'bg-blue-100 text-blue-700',
  executing: 'bg-yellow-100 text-yellow-700',
  verifying: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export function TaskExecutionsPage() {
  const params = useParams<{ id: string }>();
  const [page, setPage] = createSignal(0);
  const [statusFilter, setStatusFilter] = createSignal<string | undefined>(
    undefined,
  );
  const pageSize = 20;

  const [data, { refetch }] = createResource(
    () => ({ taskId: params.id, page: page(), status: statusFilter() }),
    async ({ taskId, page, status }) => {
      return listTaskExecutions(
        taskId,
        {
          limit: pageSize,
          offset: page * pageSize,
          ...(status ? { status } : {}),
        },
        resolveToken() ?? '',
      );
    },
  );

  // Render: title, status filter dropdown, table (when/started/finished/duration/status/session link), pagination
}
```

### 7. Add the executions route

**Update: `apps/web/src/lib/router.ts`**

Add the route:

```ts
case 'task-executions': {
  return { view: 'task-executions', taskId: pathSegments[1] };
}
```

**Update: `apps/web/src/components/App.tsx`**

Add the routing branch:

```tsx
<Show when={view() === 'task-executions'}>
  <TaskExecutionsPage />
</Show>
```

### 8. Update the sidebar/task navigation

The sidebar already lists views. Add a "Task executions" entry that appears when the user is on the executions page. Or, more simply, add a button in the `TaskModal` Schedule tab:

```tsx
<a href={`/tasks/${props.taskId}/executions`} class="...">
  View execution history →
</a>
```

### 9. Add tests for the new components

**New file: `apps/web/src/components/tasks/TaskScheduleTab.test.tsx`**

- Renders the empty state when no schedule exists
- Renders the schedule info when one exists
- Calls `createOrUpdateTaskSchedule` on save
- Calls `removeTaskSchedule` on remove
- Calls `pauseTaskSchedule` on pause
- Calls `triggerTaskNow` on run-now

**New file: `apps/web/src/components/common/ScheduleEditor.test.tsx`**

- Renders the type selector with all four kinds
- Switches input UI based on selected kind
- Calls onChange with the correct value when inputs change
- Shows validation errors from the validate prop

**New file: `apps/web/src/components/pages/TaskExecutionsPage.test.tsx`**

- Renders the executions table
- Paginates correctly
- Filters by status

### 10. Build and smoke test

```bash
pnpm --filter web build
pnpm --filter web test
```

Manual smoke test:

1. Open the Kanban board
2. Click on a task → Schedule tab
3. Add a schedule (e.g. `every: '1h'`)
4. Verify the recurring badge appears on the card
5. Pause the schedule → verify the badge changes
6. Click "Run now" → verify a new row appears in the executions page
7. Remove the schedule → verify the badge disappears

---

## Rollout

Phase 6 is the user-visible change. All previous phases are infrastructure.

Rollout steps:

1. Ship the UI changes
2. Build and deploy the web app
3. Manual QA pass through the user flows above
4. If clean, proceed to Phase 7 (testing + cleanup)

## Risk assessment

| Risk                                          | Mitigation                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ScheduleEditor` extraction breaks Pulses UI  | Keep the existing Pulses form working first; extract as a copy, then refactor          |
| API contract drift between web and server     | Web uses the documented DTO types from `shared-types`; mismatches caught at build time |
| Large history tables slow the executions page | Pagination is mandatory in the API; default `limit=20`                                 |
| Mobile layout broken on the Schedule tab      | Use existing modal responsive classes; test on a narrow viewport                       |
