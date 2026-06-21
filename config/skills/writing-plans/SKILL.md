---
name: writing-plans
description: 'Write implementation plans: bite-sized tasks, paths, code.'
version: 1.0.0
author: Hermes Agent (adapted from obra/superpowers)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [planning, design, implementation, workflow, documentation]
    related_skills:
      [
        subagent-driven-development,
        test-driven-development,
        requesting-code-review,
      ]
---

# Writing Implementation Plans

## Overview

Write comprehensive implementation plans assuming the implementer has zero context for the codebase and questionable taste. Document everything they need: which files to touch, complete code, testing commands, docs to check, how to verify. Give them bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume the implementer is a skilled developer but knows almost nothing about the toolset or problem domain. Assume they don't know good test design very well.

**Core principle:** A good plan makes implementation obvious. If someone has to guess, the plan is incomplete.

## When to Use

**Always use before:**

- Implementing multi-step features
- Breaking down complex requirements
- Delegating to subagents via subagent-driven-development

**Don't skip when:**

- Feature seems simple (assumptions cause bugs)
- You plan to implement it yourself (future you needs guidance)
- Working alone (documentation matters)

## Bite-Sized Task Granularity

**Each task = 2-5 minutes of focused work.**

Every step is one action:

- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

**Too big:**

```markdown
### Task 1: Build authentication system

[50 lines of code across 5 files]
```

**Right size:**

```markdown
### Task 1: Create User model with email field

[10 lines, 1 file]

### Task 2: Add password hash field to User

[8 lines, 1 file]

### Task 3: Create password hashing utility

[15 lines, 1 file]
```

## Plan Document Structure

### Header (Required)

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

### Task Structure

Each task follows this format:

````markdown
### Task N: [Descriptive Name]

**Objective:** What this task accomplishes (one sentence)

**Files:**

- Create: `exact/path/to/new_file.py`
- Modify: `exact/path/to/existing.py:45-67` (line numbers if known)
- Test: `tests/path/to/test_file.py`

**Step 1: Write failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

**Step 2: Run test to verify failure**

Run: `pytest tests/path/test.py::test_specific_behavior -v`
Expected: FAIL — "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test to verify pass**

Run: `pytest tests/path/test.py::test_specific_behavior -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

### When Tasks Need to Be Larger

The "2-5 minute task" heuristic applies to **code implementation** tasks. For these categories, larger tasks are appropriate — aim for 300-600 lines of detailed documentation per task:

**Design/documentation features:** When the primary output is a design doc, architecture spec, or comprehensive implementation plan (not just code). Example: a full desktop app plan with 10 phases, each with Rust/TypeScript code, dependencies, and verification steps.

**New service/daemon components:** When a task creates a standalone service with its own lifecycle, configuration, and IPC surface — the planning overhead justifies larger tasks.

**Multi-platform features:** When the same feature needs distinct implementations on Linux, macOS, and Windows (e.g., system tray, service installation).

**Pattern documentation tasks:** When the goal is to document an existing pattern with full examples, references, and alternatives — not write new code.

**Heuristic:** If the task involves writing more than ~50 lines of code AND explaining why those lines are correct, it's probably a "medium task" (~300-600 lines of doc) rather than a micro-task.

Use judgment: a 2-hour feature shouldn't be one 2-hour task, but neither should it be fifty 2-minute tasks. Group by **coherent phases** (e.g., "Task 1: scaffold + config", "Task 2: core service wiring", "Task 3: crash recovery").

### OpenAidy-Specific Guidance

For the OpenAidy project at `/tmp/openaidy`:

- **Plans go in `docs/<feature>/`** — e.g. `docs/providers/registry-plan.md`
- **NOT `.hermes/plans/`** — that directory is for Hermes-internal plans
- The repo itself holds implementation plans so they're visible to all contributors
- Plans that create new top-level features (desktop app, new agents, etc.) should include:
  - `SPEC.md` — product/feature specification
  - `ARCHITECTURE.md` — component diagrams, data flows, IPC
  - `DEPENDENCIES.md` — all dependencies with rationale
  - `tasks/01-NN-name.md` — one file per task with complete implementation detail

## Writing Process

### Step 1: Understand Requirements

Read and understand:

- Feature requirements
- Design documents or user description
- Acceptance criteria
- Constraints

### Step 2: Explore the Codebase

Use Hermes tools to understand the project:

```python
# Understand project structure
search_files("*.py", target="files", path="src/")

# Look at similar features
search_files("similar_pattern", path="src/", file_glob="*.py")

# Check existing tests
search_files("*.py", target="files", path="tests/")

# Read key files
read_file("src/app.py")
```

### Step 3: Design Approach

Decide:

- Architecture pattern
- File organization
- Dependencies needed
- Testing strategy

### Step 4: Write Tasks

Create tasks in order:

1. Setup/infrastructure
2. Core functionality (TDD for each)
3. Edge cases
4. Integration
5. Cleanup/documentation

### Step 5: Add Complete Details

For each task, include:

- **Exact file paths** (not "the config file" but `src/config/settings.py`)
- **Complete code examples** (not "add validation" but the actual code)
- **Exact commands** with expected output
- **Verification steps** that prove the task works

### Step 6: Review the Plan

Check:

- [ ] Tasks are sequential and logical
- [ ] Each task is bite-sized (2-5 min)
- [ ] File paths are exact
- [ ] Code examples are complete (copy-pasteable)
- [ ] Commands are exact with expected output
- [ ] No missing context
- [ ] DRY, YAGNI, TDD principles applied

### Step 7: Save the Plan

```bash
mkdir -p docs/plans
# Save plan to docs/plans/YYYY-MM-DD-feature-name.md
git add docs/plans/
git commit -m "docs: add implementation plan for [feature]"
```

## Principles

### DRY (Don't Repeat Yourself)

**Bad:** Copy-paste validation in 3 places
**Good:** Extract validation function, use everywhere

### YAGNI (You Aren't Gonna Need It)

**Bad:** Add "flexibility" for future requirements
**Good:** Implement only what's needed now

```python
# Bad — YAGNI violation
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
        self.preferences = {}  # Not needed yet!
        self.metadata = {}     # Not needed yet!

# Good — YAGNI
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
```

### TDD (Test-Driven Development)

Every task that produces code should include the full TDD cycle:

1. Write failing test
2. Run to verify failure
3. Write minimal code
4. Run to verify pass

See `test-driven-development` skill for details.

### Frequent Commits

Commit after every task:

```bash
git add [files]
git commit -m "type: description"
```

## Common Mistakes

### Vague Tasks

**Bad:** "Add authentication"
**Good:** "Create User model with email and password_hash fields"

### Incomplete Code

**Bad:** "Step 1: Add validation function"
**Good:** "Step 1: Add validation function" followed by the complete function code

### Missing Verification

**Bad:** "Step 3: Test it works"
**Good:** "Step 3: Run `pytest tests/test_auth.py -v`, expected: 3 passed"

### Missing File Paths

**Bad:** "Create the model file"
**Good:** "Create: `src/models/user.py`"

## Execution Handoff

After saving the plan, offer the execution approach:

**"Plan complete and saved. Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?"**

When executing, use the `subagent-driven-development` skill:

- Fresh `delegate_task` per task with full context
- Spec compliance review after each task
- Code quality review after spec passes
- Proceed only when both reviews approve

### Alternative: Cron-Job-Based Execution

For long-running multi-task plans (e.g., 10-task desktop app), a **cron job with a state file** is preferred over subagent delegation:

**Key characteristics:**

- Single target branch for ALL tasks (no per-task feature branches)
- State file tracks current task index (e.g., `~/.hermes/openaidy-desktop-task.txt`)
- Cron job reads state → implements task → updates state → commits to the same branch
- Delivers completion report to the originating chat

**Cron job prompt must include:**

1. Read task index from state file
2. Read the corresponding `docs/<feature>/tasks/XX-name.md`
3. Implement on the existing feature branch (e.g., `feat/desktop-app`)
4. Verify compilation + lint: `cargo check && cargo clippy -- -D warnings && cargo fmt --check`
5. Update state file to next task number
6. Push commits to the shared branch
7. Output: "Task XX complete (01-10). Next: Task YY."

**User correction (2026-06-04):** "We don't need a separate branch for each task. It must be all in the same branch." — Always use a single shared branch for multi-task plans executed via cron job.

## Bug-Fix Plans

For clearly diagnosed bugs (root cause known, fix is obvious), pure TDD's RED phase is less applicable. Use **Fix-Then-Test**:

1. **Fix** — implement the production code change and commit with `fix: <description>`
2. **Write regression test** — add a test that would have caught the bug, assert the correct behavior
3. **Commit the test** — `git commit -m "test: regression for <bug>"`
4. **Push and PR**

The regression test still proves the fix and prevents future regression. This differs from feature TDD (where you write test-first) but is appropriate when the bug is already diagnosed.

**When to use pure TDD instead:** New features, unknown root causes, or when the correct behavior is unclear.

## OpenAidy Plan Location

For the OpenAidy project at `/tmp/openaidy`:

- **Plans go in `docs/<feature>/`** — e.g. `docs/providers/registry-plan.md`
- **NOT** `.hermes/plans/` — that directory is for Hermes-internal plans
- The repo itself holds implementation plans so they're visible to all contributors
- **Feature branches** follow the pattern `feat/<feature-name>` (e.g., `feat/installer`, `feat/desktop-app`)

## OpenAidy Architecture Principle

OpenAidy follows the **server-as-core** pattern: `apps/server` is the single source of truth for business logic. CLI and future desktop surfaces spawn the server as a subprocess and interact with it via HTTP. See `references/multi-surface-monorepo.md` for the full pattern.

---

## Section: plan mode (absorbed from `plan` skill)

The `plan` skill is a narrow alias for a subset of this skill's capability. When the user asks for a plan instead of execution, the behavior is identical: write a markdown plan to `.hermes/plans/`, do not execute.

**Trigger conditions:** user says "plan mode", "/plan", "write a plan", or "just plan it"

**Behavior when triggered:**

- Do not implement code or edit project files except the plan markdown
- Do not run mutating terminal commands (git commit/push, rm, etc.)
- Inspect context read-only when needed
- Save plan as `.hermes/plans/YYYY-MM-DD_HHMMSS-<slug>.md`

---

## Section: spike (absorbed from `spike` skill)

A **spike** is a time-boxed investigation task — a single session used to answer a question or validate an approach before committing to a full implementation. A spike produces a definite answer (or a set of known bounds), not production code.

**When to spike:**

- Unknown technology or library — validate it works before designing around it
- Architectural uncertainty — prototype two approaches and compare
- Risk reduction — "what happens if we do X at scale?" can only be answered empirically
- Tool evaluation — "does this tool do what we need?"

**Spike workflow:**

1. State the question to answer explicitly
2. Set a time limit (1-4 hours max; if you need more, chunk into multiple spikes)
3. Research/protype to answer the question
4. Write the answer in a short report
5. Decide: use the approach, try another spike, or abandon

**Spike outputs:**

- A definite answer to the original question
- Known bounds: "this library does X but not Y"
- A short report saved to the workspace

---

## Section: subagent-driven-development (absorbed from `subagent-driven-development` skill)

Subagent-driven development uses `delegate_task` to spawn focused workers for implementation tasks, with two-stage review between tasks. Use this when executing a multi-task plan.

**Architecture:**

- Orchestrator (you) writes the plan, dispatches workers, reviews results
- Workers (leaf subagents) execute one task at a time with full context
- Review stage gates between tasks

**Dispatch pattern:**

```python
delegate_task(
    goal="Full task description with file paths, constraints, and acceptance criteria",
    context="Current state: ..., What to do: ..., What not to touch: ...",
    toolsets=["terminal", "file", "web"],
)
```

**Two-stage review:**

1. **Spec compliance** — does the output match the task description exactly?
2. **Code quality** — does it follow project conventions, pass lint, have tests?

If either fails: send back for revision. If both pass: dispatch next task.

**Context injection:** Pass complete context per task — subagents have no memory of prior turns. Include: file paths to read, what was already done, what the next task is, constraints.

**⚠️ Pitfall: Subagent working directory is NOT the orchestrator's cwd**

Subagents run in an isolated terminal session with their own working directory. They cannot see or infer the orchestrator's current context unless you explicitly state it. This commonly causes:

- Subagent writes files to `$HOME/.hermes/docs/` instead of `/tmp/openaidy/docs/`
- Subagent runs `git status` in the wrong repo
- Subagent assumes the wrong project root

**Prevention:** Always include the absolute path to the project root in the `context` field. Never rely on "you're in /tmp/openaidy" or "the repo is at /tmp/openaidy" — state it as an absolute path in every delegate_task call:

```
context: "Project root: /tmp/openaidy (absolute path). Write all files there.
Current branch: docs/user-docs. Run 'cd /tmp/openaidy && git status' to verify."
```

After the subagent returns, verify the output with `ls` or `git status` in the correct directory before proceeding.

---

## Remember

```
Bite-sized tasks (2-5 min each)
Exact file paths
Complete code (copy-pasteable)
Exact commands with expected output
Verification steps
DRY, YAGNI, TDD
Frequent commits
```

**A good plan makes implementation obvious.**

## Consolidation Note

The `plan`, `spike`, and `subagent-driven-development` narrow skills have been **absorbed as labeled subsections** inside the `software-development` class-level umbrella skill. Their content is now at:

- **Section: plan mode** — inside `writing-plans` skill (search for `plan mode`)
- **Section: spike** — inside `writing-plans` skill (search for `spike`)
- **Section: subagent-driven-development** — inside `writing-plans` skill (search for `subagent-driven-development`)

This skill (`writing-plans`) is itself a subsection of the `software-development` umbrella. The full class-level skill with all absorbed subsections is the canonical reference for planning methodology.
