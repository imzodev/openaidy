---
name: Writing Plans
description: Use before implementing anything non-trivial — turn a task into a short, ordered list of small, verifiable steps with concrete file paths, so work is reviewable before code is written.
version: 1.0.0
---

# Writing Plans

A plan is a cheap place to be wrong. Sketch the work as small, ordered,
verifiable steps _before_ writing code — it surfaces unknowns, gets
agreement on approach, and prevents half-built dead ends.

## When to plan

Plan when the task touches more than one file, has an unclear approach,
or is easy to get wrong. Skip the ceremony for a one-line fix.

## What a good plan contains

1. **Goal** — one or two sentences: what will be true when this is done.
2. **Constraints & assumptions** — what must not change, and what you're
   taking as given (call these out so a reviewer can correct them).
3. **Steps** — an ordered list of small tasks. Each step should name the
   concrete file(s) it touches and how you'll know it worked.
4. **Risks / open questions** — what might go wrong or needs a decision.

## Sizing steps

- Each step should be independently checkable — ideally it ends with a
  test passing, a command succeeding, or an observable behavior.
- If a step can't be verified until three later steps land, it's too big
  or out of order. Split it or resequence.
- Order so that something works as early as possible. Prefer a thin
  end-to-end slice over building all the plumbing first.

Good: "Add `parseRange()` to `src/lib/range.ts` + unit tests for empty,
single, and inverted ranges."
Too vague: "Implement the range feature."

## Working the plan

- Do the steps in order. When reality diverges from the plan, update the
  plan — don't silently improvise.
- Check off steps as their verification passes.
- A plan is a tool, not a contract: revise it when you learn something,
  but keep it reflecting the current intended path.

See `references/plan-template.md` for a fill-in template and a
good-vs-bad task-sizing example.
