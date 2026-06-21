# PR Body Shell Quoting Pitfalls

When passing multi-line PR body text to `gh pr create --body`, special characters in the body can be interpreted as shell commands, causing failures like:

```
/usr/bin/bash: line 25: preHandler: command not found
/usr/bin/bash: line 25: agents.delete: command not found
```

This happens because characters like `|`, backticks, `$`, or newlines inside an inline `--body "..."` argument are processed by the shell before the command sees them.

## Symptoms

- `gh pr create` fails with "command not found" errors for words that are actually in the PR body
- The body text gets corrupted or truncated
- Works fine when body is short but fails with longer/markdown-formatted bodies

## Root Cause

The `--body` argument uses double quotes. Inside double quotes, `|`, backticks, `$`, `!`, and newlines still undergo shell interpretation. The markdown table in the body:

```
| Route | Method | Scope |
|-------|--------|-------|
```

The `|` characters become pipe operators, and subsequent words look like command invocations.

## Prevention

Always use one of these approaches instead of inline `--body`:

### 1. Use a file via `--body-file`

```bash
cat > /tmp/pr-body.md << 'EOF'
## Summary

Issue #304: Allow users to delete agents from the UI

The DELETE /agents/:agentId endpoint was protected by...

## Changes

| Route | Method | Scope |
|-------|--------|-------|
| GET /agents | agents.list |
| DELETE /agents/:agentId | agents.delete |

Each route now explicitly requires the scope matching its intended operation.
EOF

gh pr create \
  --repo owner/repo \
  --title "feat: scope-based auth per agent route" \
  --body-file /tmp/pr-body.md \
  --base main
```

### 2. Use `printf` with `$'...'` syntax (for simple bodies)

```bash
gh pr create \
  --title "fix: correct login redirect" \
  --body $'## Summary\nFixes the redirect loop after login.\n\nCloses #42' \
  --repo owner/repo
```

### 3. Use heredoc with `--body` but pass as stdin in some contexts

The `gh pr create` command reads `--body-file` from a path, not stdin. The heredoc approach in option 1 is the most reliable.

## Summary of Safe Patterns

| Approach                      | When to Use                                                |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `--body-file /tmp/pr-body.md` | Complex/multi-line bodies with special chars — always safe |
| `$'...'` with `printf`        | Simple single-line bodies, no markdown tables              |
| Double-quoted inline `"..."`  | Only when body is plain ASCII with no `                    | `, `$`, backticks, or newlines |

The `--body-file` approach is the default recommendation — it eliminates all shell interpretation risks.
