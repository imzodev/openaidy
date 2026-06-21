---
name: systematic-debugging
description: '4-phase root cause debugging: understand bugs before fixing.'
version: 1.0.0
author: Hermes Agent (adapted from obra/superpowers)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags:
      [debugging, troubleshooting, problem-solving, root-cause, investigation]
    related_skills:
      [test-driven-development, writing-plans, subagent-driven-development]
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## Section: Python debugging (absorbed from `python-debugpy`)

Use `python-debugpy` when you need to attach a remote debugger to a running Python process or launch Python with debugger support enabled.

### Launch with debugger enabled

```bash
python -m debugpy --listen 0.0.0.0:5678 --wait-for-client myscript.py
```

This pauses execution at the first line (or at a breakpoint set in code via `debugpy.breakpoint()`) until a client connects.

### Attach to a running process

```bash
python -m debugpy --connect localhost:5678
```

### Connect from VS Code / IDE

```json
{
  "name": "Python: Attach",
  "request": "attach",
  "type": "debugpy",
  "connect": { "host": "localhost", "port": 5678 }
}
```

### Remote host debugging

If the Python process is on a different machine or container:

```bash
python -m debugpy --listen 0.0.0.0:5678 --log-dir /tmp/debugpy
```

Then connect with `connect` pointing to that host/port. Ensure the port is open in the firewall/security group.

### Breakpoints in code

```python
import debugpy
debugpy.breakpoint()  # execution pauses here until debugger attaches
```

### Debug a specific module

```bash
python -m debugpy --listen 0.0.0.0:5678 -m mymodule
```

### PyCharm remote debug configuration

```
Host: localhost
Port: 5678
Python path: /path/to/project
```

### Common issues

- **Port already in use:** pick a different port with `--listen 0.0.0.0:5679`
- **Firewall blocking connection:** ensure the target port is reachable from the client machine
- **Debugger not stopping:** ensure `breakpoint()` is reached or `-- suspend=all` flag is used to pause at start

---

## Section: Node.js debugging (absorbed from `node-inspect-debugger`)

Use `node-inspect-debugger` when you need to debug a running Node.js process with Chrome DevTools Protocol support.

### Start Node with inspector enabled

```bash
node --inspect=0.0.0.0:9229 myscript.js
```

This starts the V8 inspector on port 9229. You can also use `--inspect-brk` to pause at the first line.

### Attach to a running process

Find the process ID and send SIGUSR1:

```bash
kill -USR1 <pid>
```

Then connect to `http://localhost:9229/json` from Chrome DevTools.

### Connect via Chrome DevTools

1. Open `chrome://inspect` in Chrome
2. Click "Open dedicated DevTools for Node"
3. Connect to the process

### Debug with VS Code

```json
{
  "type": "node",
  "request": "attach",
  "name": "Node: Attach",
  "port": 9229,
  "restart": true,
  "skipFiles": ["<node_internals>/**"]
}
```

### Remote debugging (e.g., Docker container)

```bash
node --inspect=0.0.0.0:9229 myscript.js
```

Then forward port 9229 to your local machine:

```bash
ssh -L 9229:localhost:9229 user@remote-host
```

Or in Docker: `docker run -p 9229:9229 ...`

### Node inspector CLI alternative

```bash
node inspect localhost:9229
# Then use 'cont', 'next', 'step', 'watch', etc.
```

### Common issues

- **Port 9229 already in use:** `node --inspect=0.0.0.0:9230` to use a different port
- **Cannot connect:** check if the port is exposed in the container (`-p 9229:9229`)
- **Process not pausing:** ensure `--inspect-brk` was used to pause at start, or add `debugger;` statement in code

---

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:

- Test failures
- Bugs in production
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues

**Use this ESPECIALLY when:**

- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

**Don't skip when:**

- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)
- Someone wants it fixed NOW (systematic is faster than thrashing)

## The Four Phases

You MUST complete each phase before proceeding to the next.

---

## Phase 0: Verify Correct Remote (Multi-Remote Fork Situations)

**BEFORE investigating ANY codebase state (branch contents, missing files, commit history):**

When a repo has multiple remotes (e.g., a personal fork + upstream original), the agent's local clone typically points to the fork. The fork may be out of date or lack content that exists on the original.

### 0.1 Check Remotes First

```bash
git remote -v
```

If two remotes exist (e.g., `origin` = agent fork, `upstream` = original):

- **Always verify against `upstream/main`** when the question is "does X exist in the project"
- Pull from `upstream` before concluding something is missing
- Use `git ls-tree --name-only upstream/main` to see what the original repo actually has on a given branch

### 0.2 Common Failure Mode

Agent reads from `origin` (fork) → finds nothing → concludes "X is missing from the project" → when X was actually added to `upstream/main` (original repo) and the fork was never synced.

###0.3 Correct Pattern

```
git remote -v
# → origin = agentjetsonimzodev/openaidy (fetch/push)
# → upstream = imzodev/openaidy (fetch only)

# Before asking "is X in the project?", check upstream:
git fetch upstream
git ls-tree --name-only upstream/main | grep X
git log --oneline upstream/main -5
```

**This step prevents false "missing" reports and wasted investigation of phantom problems.**

---

## Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

### 1. Read Error Messages Carefully

- Don't skip past errors or warnings
- They often contain the exact solution
- Read stack traces completely
- Note line numbers, file paths, error codes

**Action:** Use `read_file` on the relevant source files. Use `search_files` to find the error string in the codebase.

### 2. Reproduce Consistently

- Can you trigger it reliably?
- What are the exact steps?
- Does it happen every time?
- If not reproducible → gather more data, don't guess

**Action:** Use the `terminal` tool to run the failing test or trigger the bug:

```bash
# Run specific failing test
pytest tests/test_module.py::test_name -v

# Run with verbose output
pytest tests/test_module.py -v --tb=long
```

### 3. Check Recent Changes

- What changed that could cause this?
- Git diff, recent commits
- New dependencies, config changes

**Action:**

```bash
# Recent commits
git log --oneline -10

# Uncommitted changes
git diff

# Changes in specific file
git log -p --follow src/problematic_file.py | head -100
```

### 4. Gather Evidence in Multi-Component Systems

**WHEN system has multiple components (API → service → database, CI → build → deploy):**

**BEFORE proposing fixes, add diagnostic instrumentation:**

For EACH component boundary:

- Log what data enters the component
- Log what data exits the component
- Verify environment/config propagation
- Check state at each layer

Run once to gather evidence showing WHERE it breaks.
THEN analyze evidence to identify the failing component.
THEN investigate that specific component.

### 5. Trace Data Flow

**WHEN error is deep in the call stack:**

- Where does the bad value originate?
- What called this function with the bad value?
- Keep tracing upstream until you find the source
- Fix at the source, not at the symptom

**Action:** Use `search_files` to trace references:

```python
# Find where the function is called
search_files("function_name(", path="src/", file_glob="*.py")

# Find where the variable is set
search_files("variable_name\\s*=", path="src/", file_glob="*.py")
```

### Phase 1 Completion Checklist

- [ ] Error messages fully read and understood
- [ ] Issue reproduced consistently
- [ ] Recent changes identified and reviewed
- [ ] Evidence gathered (logs, state, data flow)
- [ ] Problem isolated to specific component/code
- [ ] Root cause hypothesis formed

**STOP:** Do not proceed to Phase 2 until you understand WHY it's happening.

---

## Phase 2: Pattern Analysis

**Find the pattern before fixing:**

### 1. Find Working Examples

- Locate similar working code in the same codebase
- What works that's similar to what's broken?

**Action:** Use `search_files` to find comparable patterns:

```python
search_files("similar_pattern", path="src/", file_glob="*.py")
```

### 2. Compare Against References

- If implementing a pattern, read the reference implementation COMPLETELY
- Don't skim — read every line
- Understand the pattern fully before applying

### 3. Identify Differences

- What's different between working and broken?
- List every difference, however small
- Don't assume "that can't matter"

### 4. Understand Dependencies

- What other components does this need?
- What settings, config, environment?
- What assumptions does it make?

---

## Phase 3: Hypothesis and Testing

**Scientific method:**

### 1. Form a Single Hypothesis

- State clearly: "I think X is the root cause because Y"
- Write it down
- Be specific, not vague

### 2. Test Minimally

- Make the SMALLEST possible change to test the hypothesis
- One variable at a time
- Don't fix multiple things at once

### 3. Verify Before Continuing

- Did it work? → Phase 4
- Didn't work? → Form NEW hypothesis
- DON'T add more fixes on top

### 4. When You Don't Know

- Say "I don't understand X"
- Don't pretend to know
- Ask the user for help
- Research more

---

## Phase 4: Implementation

**Fix the root cause, not the symptom:**

### 1. Create Failing Test Case

- Simplest possible reproduction
- Automated test if possible
- MUST have before fixing
- Use the `test-driven-development` skill

### 2. Implement Single Fix

- Address the root cause identified
- ONE change at a time
- No "while I'm here" improvements
- No bundled refactoring

### 3. Verify Fix

```bash
# Run the specific regression test
pytest tests/test_module.py::test_regression -v

# Run full suite — no regressions
pytest tests/ -q
```

### 4. If Fix Doesn't Work — The Rule of Three

- **STOP.**
- Count: How many fixes have you tried?
- If < 3: Return to Phase 1, re-analyze with new information
- **If ≥ 3: STOP and question the architecture (step 5 below)**
- DON'T attempt Fix #4 without architectural discussion

### 5. If 3+ Fixes Failed: Question Architecture

**Pattern indicating an architectural problem:**

- Each fix reveals new shared state/coupling in a different place
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

**STOP and question fundamentals:**

- Is this pattern fundamentally sound?
- Are we "sticking with it through sheer inertia"?
- Should we refactor the architecture vs. continue fixing symptoms?

**Discuss with the user before attempting more fixes.**

This is NOT a failed hypothesis — this is a wrong architecture.

---

## Red Flags — STOP and Follow Process

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals a new problem in a different place**

**ALL of these mean: STOP. Return to Phase 1.**

**If 3+ fixes failed:** Question the architecture (Phase 4 step 5).

## Common Rationalizations

| Excuse                                       | Reality                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| "Issue is simple, don't need process"        | Simple issues have root causes too. Process is fast for simple bugs.        |
| "Emergency, no time for process"             | Systematic debugging is FASTER than guess-and-check thrashing.              |
| "Just try this first, then investigate"      | First fix sets the pattern. Do it right from the start.                     |
| "I'll write test after confirming fix works" | Untested fixes don't stick. Test first proves it.                           |
| "Multiple fixes at once saves time"          | Can't isolate what worked. Causes new bugs.                                 |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely.                  |
| "I see the problem, let me fix it"           | Seeing symptoms ≠ understanding root cause.                                 |
| "One more fix attempt" (after 2+ failures)   | 3+ failures = architectural problem. Question the pattern, don't fix again. |

## Quick Reference

| Phase                 | Key Activities                                                          | Success Criteria             |
| --------------------- | ----------------------------------------------------------------------- | ---------------------------- |
| **1. Root Cause**     | Read errors, reproduce, check changes, gather evidence, trace data flow | Understand WHAT and WHY      |
| **2. Pattern**        | Find working examples, compare, identify differences                    | Know what's different        |
| **3. Hypothesis**     | Form theory, test minimally, one variable at a time                     | Confirmed or new hypothesis  |
| **4. Implementation** | Create regression test, fix root cause, verify                          | Bug resolved, all tests pass |

## Hermes Agent Integration

### Investigation Tools

Use these Hermes tools during Phase 1:

- **`search_files`** — Find error strings, trace function calls, locate patterns
- **`read_file`** — Read source code with line numbers for precise analysis
- **`terminal`** — Run tests, check git history, reproduce bugs
- **`web_search`/`web_extract`** — Research error messages, library docs

### With delegate_task

For complex multi-component debugging, dispatch investigation subagents:

```python
delegate_task(
    goal="Investigate why [specific test/behavior] fails",
    context="""
    Follow systematic-debugging skill:
    1. Read the error message carefully
    2. Reproduce the issue
    3. Trace the data flow to find root cause
    4. Report findings — do NOT fix yet

    Error: [paste full error]
    File: [path to failing code]
    Test command: [exact command]
    """,
    toolsets=['terminal', 'file']
)
```

### With test-driven-development

When fixing bugs:

1. Write a test that reproduces the bug (RED)
2. Debug systematically to find root cause
3. Fix the root cause (GREEN)
4. The test proves the fix and prevents regression

## References

- `references/recurring-planned-tasks.md` — Bug pattern: recurring tasks execute once then silently skip on Run 2+. Root cause: `subtask.sessionId` from Run 1 not cleared before Run 2. Fix: `clearSessionIdsByTask()` in executor cleanup block.
- `references/gateway-silent-crash.md` — Silent gateway death: health endpoint lies because a stale subprocess holds port 3000 while the Python gateway process has exited. Detection via process table + log, not just health check.
- `references/hermes-whatsapp-debugging.md` — Hermes WhatsApp gateway failure patterns: session corruption loop (`device_removed`), disk-full recovery, bridge restart loop, self-chat mode, **gateway crash loop from unpaired enabled WhatsApp**.

## Consolidation Note

The `python-debugpy` and `node-inspect-debugger` narrow skills have been **absorbed as labeled subsections** inside the `software-development` class-level umbrella skill. Their content is now at:

- **Section: Python debugging** — inside `software-development` skill (search for `python-debugpy`)
- **Section: Node.js debugging** — inside `software-development` skill (search for `node-inspect-debugger`)

This skill (`systematic-debugging`) is itself a subsection of the `software-development` umbrella. The full class-level skill with all three absorbed subsections is the canonical reference for debugging methodology.

- `references/gateway-silent-crash.md` — **silent gateway death**: health endpoint lies because a stale subprocess holds port 3000 while the Python gateway process has exited; detection via process table + log, not just health check
- `references/recurring-planned-tasks.md` — Recurring planned tasks fail on Run 2+ because subtask `sessionId` references from Run 1 are not cleared; fix is `clearSessionIdsByTask` in the executor cleanup block

## Real-World Impact

From debugging sessions:

- Systematic approach: 15-30 minutes to fix
- Random fixes approach: 2-3 hours of thrashing
- First-time fix rate: 95% vs 40%
- New bugs introduced: Near zero vs common

**No shortcuts. No guessing. Systematic always wins.**
