# Hypothesis log

Debugging is a search. Writing down each hypothesis and its outcome keeps
you from re-testing the same idea and makes the trail auditable.

Keep a running list while you work:

```
## Bug: <one-line summary>

Repro: <command / steps>
Expected: <...>
Actual: <...>

### H1: <what you think is wrong and why>
Prediction if true: <what you'd observe>
Test: <log / breakpoint / experiment>
Result: CONFIRMED | REFUTED — <what you saw>
Notes: <what this rules in or out>

### H2: ...
```

## Rules

- One hypothesis at a time. Falsifiable. Predict before you check.
- A refuted hypothesis is progress — it shrinks the search space. Record
  what it ruled out.
- Don't edit product code to test a hypothesis; use a log or breakpoint.
  Save edits for the confirmed root cause.
- When confirmed, the log entry becomes your commit rationale and the basis
  for the regression test.
