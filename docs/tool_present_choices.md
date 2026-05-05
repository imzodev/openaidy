# `present_choices` Tool — Feature Specification & Implementation Plan

A native built-in tool that allows an agent to present the user with a list of
selectable options, rendered in the chat UI as an interactive choice card. The
user picks one option with keyboard, mouse, or touch; the selection is submitted
as the next user message and the conversation continues normally.

---

## Design Principles

- **SOLID throughout** — each new class has a single responsibility and depends
  on abstractions, not concretions.
- **Types in shared-type files** — every cross-package type lives in
  `packages/shared-types/src/`. Server-internal types live in
  `apps/server/src/types.ts` or the owning module's `types.ts`. No type is
  declared at the point of use.
- **Open for extension** — the native tool registry is already the extension
  point. Adding `present_choices` does not modify existing tools or handler logic.
- **Backward compatible** — clients that do not handle `session.run.choices`
  degrade gracefully; they ignore the event and the user can still type manually.
- **Best-effort UI** — if the frontend has not rendered the choice card yet and
  the user types a reply, that is fine. The card dismisses and the typed reply
  is used.

---

## Layers & Files Touched

### 1. Shared Types (`packages/shared-types/src/`)

**File: `packages/shared-types/src/choices.ts`** ← NEW

```ts
/**
 * Payload for the present_choices native tool call.
 * This is the argument object the LLM passes when it calls the tool.
 */
export type PresentChoicesArgs = {
  /** Optional framing question shown above the choices */
  question?: string;
  /** Between 2 and 6 labelled options */
  choices: string[];
};

/**
 * The structured event emitted by the server when an agent calls present_choices.
 * Sent over WebSocket as part of the run event stream.
 */
export type ChoicesEvent = {
  runId: string;
  sessionId: string;
  agentId: string;
  question?: string;
  choices: string[];
};
```

**File: `packages/shared-types/src/websocket.ts`** ← EXTEND

Add a new WS run event type alongside the existing `session.run.delta`,
`session.run.tool_call`, etc.:

```ts
// New export — session.run.choices event
export type SessionRunChoicesEvent = WSMessage<
  'session.run.choices',
  ChoicesEvent // imported from ./choices
>;
```

Add `'session.run.choices'` to the existing union of run event types (wherever
`SessionRunEvent` or equivalent is defined).

**File: `packages/shared-types/src/index.ts`** ← EXTEND

```ts
export * from './choices';
```

---

### 2. Native Tool Definition (`apps/server/src/tools/`)

The existing `BuiltinToolRegistry` (referenced in `SessionMessageServiceOptions`)
is the correct extension point. Each native tool is a self-contained unit that
implements a common interface.

**File: `apps/server/src/tools/present-choices.ts`** ← NEW

Responsibilities (Single Responsibility Principle):

- Declare the tool's JSON schema descriptor so the LLM knows how to call it.
- Implement the `execute` method — which in this case does **not** run any
  side-effect logic. Instead it returns a sentinel result that the agentic loop
  recognises as "interrupt and emit a choices event".

```ts
import type { NativeTool, NativeToolResult } from './types';
import type { PresentChoicesArgs } from '@openaidy/shared-types';

export const presentChoicesTool: NativeTool = {
  definition: {
    name: 'present_choices',
    description:
      'Present the user with a list of selectable options. Use this when you want the user to pick one of several predefined answers rather than typing freely. Ideal for onboarding questions, configuration decisions, or guided workflows.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Optional framing text shown above the choices.',
        },
        choices: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 6,
          description: 'Between 2 and 6 options for the user to choose from.',
        },
      },
      required: ['choices'],
    },
  },

  execute(args: PresentChoicesArgs): NativeToolResult {
    // Returns an interrupt signal — no side effects here.
    // The agentic loop detects INTERRUPT_CHOICES and breaks out.
    return {
      type: 'INTERRUPT_CHOICES',
      question: args.question,
      choices: args.choices,
    };
  },
};
```

**File: `apps/server/src/tools/types.ts`** ← EXTEND

Add the new result variant to the existing `NativeToolResult` discriminated union:

```ts
export type NativeToolResult =
  | { type: 'SUCCESS'; output: string }
  | { type: 'ERROR'; message: string }
  | { type: 'INTERRUPT_CHOICES'; question?: string; choices: string[] }; // NEW
```

**File: `apps/server/src/tools/index.ts`** ← EXTEND

Register `presentChoicesTool` in the `BuiltinToolRegistry` default set so it
is available to all agents automatically.

---

### 3. Run Event System (`apps/server/src/dispatch/events.ts`) ← EXTEND

The existing `RunEventEmitter` already has `emitDelta`, `emitToolCall`,
`emitCompleted`, `emitFailed`. Add:

```ts
emitChoices(payload: ChoicesEvent): void;
```

Implementation follows the same pattern as the other emit methods — publishes
to the in-process event bus that the WebSocket stream manager listens to.

---

### 4. Agentic Loop Interception (`apps/server/src/sessions/service.ts`) ← EXTEND

Inside `submitMessageStreaming`, the agentic tool-call loop already processes
`tool_call` events. When a tool call resolves to `{ type: 'INTERRUPT_CHOICES' }`:

1. **Do not** continue the loop.
2. **Do not** append a tool result message.
3. Emit a `choices` stream event via `onStreamEvent`:
   ```ts
   onStreamEvent({
     type: 'choices',
     choices: result.choices,
     question: result.question,
   });
   ```
4. Return early — the run is suspended awaiting the user's selection.

**File: `apps/server/src/sessions/types.ts`** ← EXTEND

Add `'choices'` to the `onStreamEvent` union:

```ts
onStreamEvent: (event:
  | { type: 'delta'; content?: string }
  | { type: 'tool_call'; toolCall: ... }
  | { type: 'usage'; usage: ... }
  | { type: 'error'; error: ... }
  | { type: 'choices'; question?: string; choices: string[] }  // NEW
) => void;
```

---

### 5. WebSocket Session Handler (`apps/server/src/websocket/handlers/session.ts`) ← EXTEND

In `executeStreamingRun`, the `onStreamEvent` switch already handles `delta`,
`tool_call`, `usage`, `error`. Add a `choices` case:

```ts
case 'choices':
  this.runEvents?.emitChoices({
    runId,
    sessionId,
    agentId,
    question: event.question,
    choices: event.choices,
  });
  break;
```

The `RunEventEmitter.emitChoices` call then broadcasts `session.run.choices`
over the WebSocket to all subscribers of this run.

---

### 6. SDK (`packages/sdk/src/`) ← EXTEND

The SDK's `WebSocketClient` already exposes a stream of run events to the
frontend. Extend the event union type to include `session.run.choices` so
TypeScript-consuming frontends get full type safety.

**File: `packages/sdk/src/websocket-client.types.ts`** ← EXTEND

```ts
export type RunEvent =
  | { type: 'session.run.delta'; ... }
  | { type: 'session.run.completed'; ... }
  | { type: 'session.run.failed'; ... }
  | { type: 'session.run.choices'; payload: ChoicesEvent }; // NEW
```

---

### 7. Frontend — Choices UI Component (`apps/web/src/`) ← NEW

**File: `apps/web/src/components/ChoicesCard.tsx`** ← NEW

Responsibilities (Single Responsibility):

- Render a card with optional question text and a list of choice buttons.
- Handle keyboard navigation (↑ ↓ Enter) and click/touch selection.
- Call `onSelect(choice: string)` when a choice is made; caller is responsible
  for submitting it and dismissing the card.

Props:

```ts
type ChoicesCardProps = {
  question?: string;
  choices: string[];
  onSelect: (choice: string) => void;
  onDismiss: () => void;
};
```

**File: `apps/web/src/App.tsx`** ← EXTEND

- Track a `currentChoices` signal: `Signal<ChoicesEvent | null>`.
- When the SDK emits `session.run.choices`, set `currentChoices`.
- Render `<ChoicesCard>` above the composer when `currentChoices` is set.
- `onSelect`: call `submitMessageStreaming` with the chosen text as content,
  then clear `currentChoices`.
- `onDismiss`: clear `currentChoices` (user dismissed without selecting).

---

### 8. System Prompt Injection (`apps/server/src/prompts/build-system-prompt.ts`) ← EXTEND

When `isFirstMessage` is true and blank personality files are detected (the
`[ONBOARDING]` block is appended), also append a tool-awareness note:

```
You have access to the `present_choices` tool. Use it whenever you ask the user
to pick between a small set of options — especially during onboarding. Do not
list options as plain text when you could use the tool instead.
```

This is additive — no existing logic changes.

---

## Execution Order

| Step | File(s)                                          | What                                              |
| ---- | ------------------------------------------------ | ------------------------------------------------- |
| 1    | `packages/shared-types/src/choices.ts`           | New types: `PresentChoicesArgs`, `ChoicesEvent`   |
| 2    | `packages/shared-types/src/websocket.ts`         | New WS event: `SessionRunChoicesEvent`            |
| 3    | `packages/shared-types/src/index.ts`             | Export `./choices`                                |
| 4    | `apps/server/src/tools/types.ts`                 | Add `INTERRUPT_CHOICES` to `NativeToolResult`     |
| 5    | `apps/server/src/tools/present-choices.ts`       | New tool implementation                           |
| 6    | `apps/server/src/tools/index.ts`                 | Register tool in default registry                 |
| 7    | `apps/server/src/dispatch/events.ts`             | Add `emitChoices` to `RunEventEmitter`            |
| 8    | `apps/server/src/sessions/types.ts`              | Add `choices` to `onStreamEvent` union            |
| 9    | `apps/server/src/sessions/service.ts`            | Intercept `INTERRUPT_CHOICES` in agentic loop     |
| 10   | `apps/server/src/websocket/handlers/session.ts`  | Handle `choices` stream event, call `emitChoices` |
| 11   | `packages/sdk/src/websocket-client.types.ts`     | Add `session.run.choices` to `RunEvent` union     |
| 12   | `apps/web/src/components/ChoicesCard.tsx`        | New UI component                                  |
| 13   | `apps/web/src/App.tsx`                           | Wire choices state, render card, handle selection |
| 14   | `apps/server/src/prompts/build-system-prompt.ts` | Inject tool-awareness note during onboarding      |

---

## What Is Reused (Do Not Duplicate)

| Existing                                                          | Reuse Point                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `WSMessage<TType, TPayload>` in `shared-types/src/websocket.ts`   | Wrap `ChoicesEvent` as a typed WS message                          |
| `RunEventEmitter` in `dispatch/events.ts`                         | Add `emitChoices` alongside existing emitters                      |
| `BuiltinToolRegistry` in `tools/index.ts`                         | Register `presentChoicesTool` without modifying registry internals |
| `onStreamEvent` callback in `sessions/types.ts`                   | Add `choices` variant to existing union                            |
| `executeStreamingRun` switch in `websocket/handlers/session.ts`   | Add `case 'choices'` alongside existing cases                      |
| `withWebSocketFallback` + `submitMessageStreaming` in `ws-api.ts` | Selection submits via the existing message path — no new API       |

---

## What Is Not In Scope

- Persisting the choices event as a session message (it is ephemeral UI state).
- Multi-select (choose multiple options) — can be a follow-up variant.
- Choices with rich content (images, descriptions) — plain strings only for v1.
- Timeout / auto-dismiss of the choice card — out of scope for v1.
