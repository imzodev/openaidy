# Plan template

Copy, fill in, keep it short. A plan longer than the change is a smell.

```markdown
# <task name>

## Goal

<1–2 sentences: what is true when this is done>

## Constraints & assumptions

- <what must NOT change / public API to preserve>
- <assumption a reviewer could correct>

## Steps

1. [ ] <action> — `path/to/file.ts` — verify: <test/command/observation>
2. [ ] <action> — `path/to/other.ts` — verify: <...>
3. [ ] ...

## Risks / open questions

- <thing that might break, or a decision needed before step N>
```

## Task sizing: good vs. bad

| Bad (vague / too big)  | Good (small / verifiable)                                                             |
| ---------------------- | ------------------------------------------------------------------------------------- |
| "Add authentication"   | "Add `verifyToken()` to `auth.ts` + tests for valid, expired, malformed tokens"       |
| "Wire up the endpoint" | "Add `POST /skills` route returning 201 + a route test asserting the shape"           |
| "Refactor the parser"  | "Extract `unquote()` from `parser.ts`; no behavior change; existing tests still pass" |

## Sequencing rule of thumb

Prefer a thin working slice first:

1. Make the smallest end-to-end path work (even hard-coded).
2. Replace the hard-coded parts with real logic, one step at a time.
3. Handle edge cases and errors last.

This way you always have something demonstrable, and integration problems
show up on step 1 instead of step 10.
