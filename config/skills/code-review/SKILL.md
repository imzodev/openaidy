---
name: Code Review
description: Use when reviewing a diff or pull request — find correctness bugs first, then reuse/simplification cleanups, and report each finding with a concrete failure scenario ranked by severity.
version: 1.0.0
---

# Code Review

A review's job is to catch what tests and the type checker won't. Read
the diff for correctness first; treat style and cleanup as secondary.

## Scope

- The **diff** is the scope. But read the _enclosing_ function of each
  hunk — a change can re-expose or fail to fix a bug in nearby lines.
- Check callers and callees of anything the diff changes: a new
  precondition, a changed return shape, or a new thrown error can break
  a call site the diff doesn't touch.

## Look for, in order

1. **Correctness** — the highest-value findings:
   - Inverted/wrong conditions, off-by-one, wrong variable (copy-paste).
   - Null/undefined access, missing `await`, unhandled promise rejection.
   - Falsy-zero / empty-string bugs (`if (!count)` when `0` is valid).
   - Removed guards or validation with nothing re-establishing them.
   - Error swallowed in a `catch` that should propagate.
2. **Cleanup** — only after correctness:
   - Reinvented helpers that already exist in the codebase.
   - Duplicated logic, dead code, needless complexity, redundant state.
   - Wasted work: repeated I/O, sequential calls that could be parallel.
3. **Conventions** — clear violations of the repo's stated rules, quoted.

## Reporting a finding

Every finding needs a **concrete failure scenario**, not a vibe:

> `src/foo.ts:42` — `parseId` returns `undefined` for empty input, but the
> caller indexes into it → `TypeError` when the list is empty.

- Rank most-severe first. A correctness bug always outranks a cleanup.
- Say how sure you are. If you can't name inputs that break it, mark it
  as "possible" rather than asserting a bug.
- Prefer "here's the failing case" over "consider refactoring."

## Restraint

Don't flag style the linter already enforces, don't rewrite to personal
taste, and don't invent requirements. A short list of real bugs beats a
long list of nitpicks. See `references/review-checklist.md`.
