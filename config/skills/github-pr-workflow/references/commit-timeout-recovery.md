# Commit Timeout Recovery

## Symptom

`git commit` times out after 60s (exit code 124) in the terminal tool, especially when the commit message contains markdown or multi-line body. The timeout kills the process but git operations may have actually completed.

## Session from this conversation

- `git commit` timed out with exit code 124 during a multi-line commit message
- `git status` afterwards showed files were already committed (no longer staged)
- `git log` confirmed the commit existed with the expected message
- `git push -u origin feat/ui-session-search` succeeded without issues

## Recovery pattern

When a git command times out:

1. Immediately run `git status` to check if the operation actually succeeded
2. If staged files are gone and a commit exists, the operation completed before the timeout
3. If files are still staged, retry the operation
4. For commits: `git log --oneline -1` to verify the commit was created
5. For pushes: verify with `git log` that your commits are present

## Prevention

- Keep commit messages single-line when possible for automated sessions
- If multi-line, use `git commit -F /tmp/msg.txt` with a file instead of `-m "..."`
- Long operations (push/pull of large repos) should use `background=true` with `notify_on_complete=true`
