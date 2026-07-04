---
name: Systematic Debugging
description: Use when a bug, failing test, crash, or wrong output needs fixing — a four-phase method to find the root cause before changing code, instead of guessing.
version: 1.0.0
---

# Systematic Debugging

Guessing at fixes wastes time and often adds new bugs. Work the problem in
four phases and do not skip ahead. You may only edit code in Phase 3.

## Phase 1 — Reproduce

You cannot fix what you cannot trigger.

- Find the smallest, most reliable way to make the bug happen. Prefer a
  failing test or a single command over "click around the UI."
- Write down the exact inputs, state, and environment. If it only fails
  sometimes, note how often and what varies between runs.
- If you cannot reproduce it, stop and gather more data (logs, a report
  with steps, the failing payload). Do not fix blind.

See `references/reproduction-checklist.md`.

## Phase 2 — Isolate

Narrow _where_ the fault is before asking _why_.

- Confirm the expected vs. actual behavior in one sentence each.
- Bisect: halve the search space repeatedly. Comment out a branch, add a
  log at the midpoint, or `git bisect` across commits. Each step should
  rule out roughly half of what's left.
- Trace the value backward from the wrong output to the first point where
  it became wrong. That point, not the crash site, is usually the bug.

## Phase 3 — Hypothesize and test

- State a single, falsifiable hypothesis: "X is wrong because Y." Record
  it (see `references/hypothesis-log.md`).
- Predict what you'd observe if it were true, then check that prediction
  with a log/test/breakpoint — before editing.
- Only once a hypothesis is confirmed, make the smallest change that
  addresses the root cause. Resist fixing symptoms.
- If the hypothesis is wrong, write down what you learned and form the
  next one. Do not stack speculative changes.

## Phase 4 — Verify and harden

- Re-run the Phase 1 reproduction. The bug is fixed only when the thing
  that used to fail now passes.
- Add a regression test that fails without your change and passes with it.
- Check for siblings: the same root cause often hides in nearby code.
- Remove debug logging and temporary scaffolding before you finish.

## Anti-patterns

- Changing several things at once so you can't tell what worked.
- "Fixing" by adding a retry, sleep, or try/catch that hides the error.
- Trusting the stack-trace location without tracing the value backward.
- Declaring victory without re-running the original reproduction.
