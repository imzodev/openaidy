# Subagent Context Isolation Pattern

## The Problem

`delegate_task` spawns a subagent in an **isolated terminal session** with its own working directory, environment, and no memory of the orchestrator's conversation. If the orchestrator's cwd is `/tmp/openaidy` but the subagent starts in `$HOME`, all relative paths resolve to the wrong location.

## Symptom

The subagent completes successfully and reports the files were written, but they land in the wrong directory:

```
# Orchestrator cwd: /tmp/openaidy
# Subagent default cwd: /root/
# Result: files land in /root/docs/user/ instead of /tmp/openaidy/docs/user/
```

## Pattern: Always Use Absolute Paths in Context

**In every `delegate_task` call, state:**

1. The absolute project root path
2. The exact branch or git state
3. What verification command to run after return

```python
delegate_task(
    goal="Write getting-started.md to docs/user/",
    context=(
        "Project root: /tmp/openaidy (absolute path). "
        "Write files ONLY under /tmp/openaidy/docs/user/. "
        "Current branch: docs/user-docs. "
        "After writing, run: ls -la /tmp/openaidy/docs/user/ to verify."
 ),
    toolsets=["terminal", "file"],
)
```

## Why This Happens

- `delegate_task` runs in a fresh terminal session
- The orchestrator's cwd is NOT inherited
- Subagents have no memory of prior turns
- The orchestrator's `workdir` parameter only affects terminal() calls, not the subagent's initial context

## Verification After Every Subagent Return

Always run a verification command in the correct directory after a subagent returns:

```bash
# Verify files landed in the right place
ls -la /tmp/openaidy/docs/user/

# Verify git state is as expected
cd /tmp/openaidy && git status
```

## When the Mistake Has Already Happened

If files landed in the wrong directory:

```bash
# Move files from wrong location to correct one
mkdir -p /tmp/openaidy/docs/user
cp /root/docs/user/*.md /tmp/openaidy/docs/user/

# Then write the missing files directly (don't re-delegate)
write_file(path="/tmp/openaidy/docs/user/scheduler.md", content="...")
```

Do NOT re-delegate for the fix — write the files directly to avoid repeating the same path mistake.
