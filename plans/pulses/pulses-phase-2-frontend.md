# Phase 2: Frontend — Pulses Implementation

## Overview

Phase 2 builds the `PulsesPage` UI: pulse list, create/edit modal, history drawer, and wiring into the existing router and app shell.

## Objectives

- Add pulse API client methods
- Build `PulsesPage` with list, empty state, and pulse cards
- Build `CreateEditPulseModal`
- Build `PulseHistoryDrawer`
- Wire `PulsesPage` into `App.tsx`

---

## Implementation Tasks

### 1. API Client

#### 1.1 Add pulse types

**File: `apps/web/src/lib/api.ts`**

Add types:

```ts
export type Pulse = {
  id: string;
  name: string;
  prompt: string;
  scheduleHuman: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  agentId: string | null;
  sessionId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
};

export type PulseRun = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attemptNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};
```

#### 1.2 Implement `listPulses`

**File: `apps/web/src/lib/api.ts`**

`GET /api/pulses` → `{ pulses: Pulse[], total: number }`

#### 1.3 Implement `createPulse`

**File: `apps/web/src/lib/api.ts`**

`POST /api/pulses` with body → `{ pulse: Pulse }`

#### 1.4 Implement `updatePulse`

**File: `apps/web/src/lib/api.ts`**

`PATCH /api/pulses/:id` with partial body → `{ pulse: Pulse }`

#### 1.5 Implement `deletePulse`

**File: `apps/web/src/lib/api.ts`**

`DELETE /api/pulses/:id` → void

#### 1.6 Implement `triggerPulse`

**File: `apps/web/src/lib/api.ts`**

`POST /api/pulses/:id/trigger` → `{ run: PulseRun }`

#### 1.7 Implement `getPulseHistory`

**File: `apps/web/src/lib/api.ts`**

`GET /api/pulses/:id/history?limit=20` → `{ runs: PulseRun[], total: number }`

---

### 2. PulsesPage

#### 2.1 Create `PulsesPage.tsx`

**File: `apps/web/src/components/pages/PulsesPage.tsx`**

Scaffold the component with:

- `pulses` signal (initially empty)
- `loading` signal
- `onMount` → call `listPulses` and set state

#### 2.2 Implement loading state

Show a skeleton loader (3 placeholder cards) while `loading()` is true.

#### 2.3 Implement empty state

When `pulses().length === 0` and not loading, show centred empty state:

- Icon, heading "No pulses yet", subtext, "Create your first pulse" button

#### 2.4 Implement pulse list

`<For each={pulses()}>` renders a `PulseCard` per pulse.

---

### 3. PulseCard

#### 3.1 Create `PulseCard` component

**File: `apps/web/src/components/pages/PulsesPage.tsx`** (inner component or separate file)

Display:

- Pulse name
- Prompt preview (truncated to ~80 chars)
- Schedule in human-readable form (`scheduleHuman`)
- Status badge: `active` (green), `paused` (yellow), `failed` (red)
- Next run timestamp (relative: "in 3 hours")
- Last run timestamp (relative: "2 hours ago") or "Never"

#### 3.2 Add action buttons to PulseCard

- **Run now** — calls `triggerPulse`, shows spinner while in-flight, shows brief success/error toast
- **Pause / Resume** — calls `updatePulse({ status: 'paused' | 'active' })`, optimistically toggles badge
- **Edit** — opens `CreateEditPulseModal` pre-populated with this pulse's data
- **History** — opens `PulseHistoryDrawer` for this pulse
- **Delete** — shows inline confirmation, then calls `deletePulse`, optimistically removes card

---

### 4. CreateEditPulseModal

#### 4.1 Create modal component

**File: `apps/web/src/components/pages/PulsesPage.tsx`** (or `CreateEditPulseModal.tsx`)

Props: `pulse?: Pulse` (undefined = create mode), `onClose`, `onSaved`

#### 4.2 Implement Name field

Text input, required, max 100 chars. Inline error if empty on submit.

#### 4.3 Implement Prompt field

Textarea, required, min 1 char. Grows with content.

#### 4.4 Implement Schedule picker — Simple mode

`<select>` dropdown with options:

- Every 15 minutes
- Every 30 minutes
- Every hour
- Every 6 hours
- Every 12 hours
- Every day
- Every week

Maps to `{ every: '15m' }` etc. in the request body.

#### 4.5 Implement Schedule picker — Advanced mode

Toggle link "Advanced (cron expression)" switches to a text input for a raw cron string. Shows a human description below the input derived from the value (call `GET /api/pulses/preview-schedule?cron=<value>` or compute client-side).

#### 4.6 Implement Agent selector

Optional `<select>` populated from `GET /api/agents`. First option: "Default agent".

#### 4.7 Implement Session selector

Optional `<select>` populated from `GET /api/sessions`. First option: "Isolated (new session per run)".

#### 4.8 Implement form submission

On submit:

1. Validate all required fields
2. Call `createPulse` or `updatePulse` depending on mode
3. On success: call `onSaved(pulse)`, close modal
4. On error: show inline error message

---

### 5. PulseHistoryDrawer

#### 5.1 Create drawer component

**File: `apps/web/src/components/pages/PulsesPage.tsx`** (or `PulseHistoryDrawer.tsx`)

Opens as a right-side drawer or bottom sheet. Props: `pulse: Pulse`, `onClose`.

#### 5.2 Fetch and display run history

On open, call `getPulseHistory(pulse.id)`. Display a list of runs:

- Run number (`#14`)
- Status icon: ✅ succeeded / ❌ failed / ⏳ running
- Started at timestamp (absolute)
- Duration (`finishedAt - startedAt` in seconds)
- Error message if failed (collapsible)

#### 5.3 Implement empty history state

If no runs yet: "This pulse hasn't run yet."

---

### 6. Wire into App.tsx

#### 6.1 Import `PulsesPage`

**File: `apps/web/src/App.tsx`**

Add import for `PulsesPage`.

#### 6.2 Render in pulses view slot

In the view switch block, add:

```tsx
<Show when={currentView() === 'pulses'}>
  <PulsesPage />
</Show>
```

---

## Success Criteria

- Pulses page loads, shows skeleton then list of pulses
- Empty state shown when no pulses exist
- Create modal validates fields and creates a pulse — it appears in the list
- Edit modal pre-populates and saves changes
- Status badge toggles correctly on pause/resume
- "Run now" triggers execution and shows feedback
- Delete removes the card with confirmation
- History drawer shows runs with status, time, and errors
- `PulsesPage` is reachable via the sidebar Pulses link
