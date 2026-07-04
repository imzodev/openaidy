---
name: Test-Driven Development
description: Use when implementing a new function, endpoint, bug fix, or behavior change — write a failing test first, then the code, following RED-GREEN-REFACTOR.
version: 1.0.0
---

# Test-Driven Development

Write the test before the code. The test defines "done," catches
regressions for free, and forces you to design the interface from the
caller's side.

## The loop

1. **RED** — Write one small test for the next slice of behavior. Run it.
   Watch it fail _for the reason you expect_ (assertion failed — not a
   typo or import error). A test that has never failed proves nothing.
2. **GREEN** — Write the minimum code to make it pass. Not the elegant
   version — the passing version. Run the test; see it go green.
3. **REFACTOR** — Now clean up implementation _and_ test while green:
   remove duplication, rename, extract. Re-run after each change.

Repeat, one behavior at a time. Commit at green points.

## What to test first

- The normal case that describes the feature's purpose.
- Then edge cases: empty, zero, null/undefined, boundary values, large
  input, wrong types.
- Then failure modes: what _should_ throw or return an error, and does it?

Write these as separate tiny tests, not one giant test — a focused test
names exactly what broke when it fails.

## For a bug fix

Reverse the order: first write a test that reproduces the bug (RED — it
fails on the current, broken code). Then fix the code (GREEN). The test
now guards against the bug returning. This is the fastest way to be sure
you actually fixed it.

## Discipline

- Never write production code without a failing test demanding it.
- Never write more of a test than needed to fail; never more production
  code than needed to pass.
- If a test passes the moment you write it, be suspicious — you either
  already had the behavior or the test asserts nothing.

See `references/red-green-example.md` for a worked vitest example that
matches this repo's conventions.
