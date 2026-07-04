# Reproduction checklist

A bug you can't trigger on demand is a bug you can't verify fixed. Before
touching code, pin down a reliable reproduction.

## Capture

- [ ] Exact command, request, or user action that triggers it
- [ ] Full inputs (payload, args, file, env vars) — copy real values
- [ ] Expected result, in one sentence
- [ ] Actual result, in one sentence (error message, wrong value, crash)
- [ ] Environment: OS, runtime version, branch/commit, config that differs
      from defaults

## Shrink

- [ ] Remove unrelated steps until only the failing path remains
- [ ] Replace the UI with a direct call (test, script, curl) where possible
- [ ] Hard-code the triggering input so the repro is one deterministic step

## Intermittent bugs

If it fails only sometimes, treat the _rate_ as data:

- [ ] How often (1 in 3? 1 in 100?)
- [ ] What differs between pass and fail runs — timing, ordering,
      concurrency, cache state, clock, network?
- [ ] Can you raise the rate? (add load, shrink a timeout, run in a loop)

A reproduction that fails 100% of the time is worth the effort — it turns
verification from "seems better" into "provably fixed."
