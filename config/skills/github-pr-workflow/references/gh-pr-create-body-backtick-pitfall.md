# `gh pr create --body` with backticks fails silently

## Symptom

`gh pr create --body "..."` fails with cryptic bash errors:

```
/usr/bin/bash: line 24: sessionId: command not found
/usr/bin/bash: line 24: executeSubtask: command not found
/usr/bin/bash: command substitution: line 28: syntax error near unexpected token `taskId'
```

The PR still gets created (exit 0) but the body is garbage because bash
interpreted backtick-wrapped words like `sessionId`, `executeSubtask`,
`clearSessionIdsByTask` as command substitutions.

## Root Cause

Inline `--body "..."` with backticks causes bash to try to execute the
bracketed text as a command substitution. The shell parses `taskId` inside
backticks as a command name, finds no such command, and throws.

## Fix

Use `--body-file` instead of `--body` for any PR body that contains code
snippets, variable names, or technical terms with underscores/backticks:

```bash
# Write body to a temp file first
cat > /tmp/pr-body.md << 'ENDOFFILE'
## Problem

Recurring planned tasks (replanPolicy=never) execute correctly on Run 1,
but on every subsequent run the task appears to do nothing.

## Root Cause

On Run 2+ of a recurring planned task, subtasks still held `sessionId`
references from the previous run. When `executeSubtask` checked
`subtask.sessionId ? skip : create new`, it found the stale Run 1 session.

## Fix

Call `clearSessionIdsByTask(taskId)` in the cleanup block when NOT replanning.

## Testing

- 30/30 unit tests pass in task-schedule-executor suite
ENDOFFILE

# Use the file, not inline body
gh pr create \
  --repo imzodev/openaidy \
  --head agentjetsonimzodev:fix/recurring-planned-tasks \
  --title "fix: recurring planned tasks fail on Run 2+" \
  --body-file /tmp/pr-body.md \
  --base main
```

## Alternative: escape inline body

If you must use `--body`, escape every backtick with a backslash or use
double-here-doc (note the quotes around the delimiter):

```bash
# Escape backticks — risky, easy to miss one
gh pr create \
  --title "fix: recurring planned tasks" \
  --body "The fix calls \`clearSessionIdsByTask\` when not replanning." \
  ...

# Safer: use $'...' quoting which disables command substitution
gh pr create \
  --title "fix: recurring planned tasks" \
  --body $'The fix calls `clearSessionIdsByTask` when not replanning.' \
  ...
```

The `$'...'` quoting approach is safer for short bodies but breaks if the
body contains single quotes. Use `--body-file` for any non-trivial content.

## Session note

Issue observed in session with imzodev/openaidy. PR #5 was created with
broken body (corrupted by bash substitution). Deleted and recreated via
GitHub web UI with correct body.
