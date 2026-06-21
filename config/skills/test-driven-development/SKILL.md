---
name: test-driven-development
description: 'TDD: enforce RED-GREEN-REFACTOR, tests before code.'
version: 1.0.0
author: Hermes Agent (adapted from obra/superpowers)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [testing, tdd, development, quality, red-green-refactor]
    related_skills:
      [systematic-debugging, writing-plans, subagent-driven-development]
---

# Test-Driven Development (TDD)

## Overview

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## When to Use

**Always:**

- New features
- Bug fixes
- Refactoring
- Behavior changes

**Exceptions (ask the user first):**

- Throwaway prototypes
- Generated code
- Configuration files

Thinking "skip TDD just this once"? Stop. That's rationalization.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**

- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

Implement fresh from tests. Period.

## Red-Green-Refactor Cycle

### RED — Write Failing Test

Write one minimal test showing what should happen.

**Good test:**

```python
def test_retries_failed_operations_3_times():
    attempts = 0
    def operation():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise Exception('fail')
        return 'success'

    result = retry_operation(operation)

    assert result == 'success'
    assert attempts == 3
```

Clear name, tests real behavior, one thing.

**Bad test:**

```python
def test_retry_works():
    mock = MagicMock()
    mock.side_effect = [Exception(), Exception(), 'success']
    result = retry_operation(mock)
    assert result == 'success'  # What about retry count? Timing?
```

Vague name, tests mock not real code.

**Requirements:**

- One behavior per test
- Clear descriptive name ("and" in name? Split it)
- Real code, not mocks (unless truly unavoidable)
- Name describes behavior, not implementation

### Verify RED — Watch It Fail

**MANDATORY. Never skip.**

```bash
# Use terminal tool to run the specific test
pytest tests/test_feature.py::test_specific_behavior -v
```

Confirm:

- Test fails (not errors from typos)
- Failure message is expected
- Fails because the feature is missing

**Test passes immediately?** You're testing existing behavior. Fix the test.

**Test errors?** Fix the error, re-run until it fails correctly.

### GREEN — Minimal Code

Write the simplest code to pass the test. Nothing more.

**Good:**

```python
def add(a, b):
    return a + b  # Nothing extra
```

**Bad:**

```python
def add(a, b):
    result = a + b
    logging.info(f"Adding {a} + {b} = {result}")  # Extra!
    return result
```

Don't add features, refactor other code, or "improve" beyond the test.

**Cheating is OK in GREEN:**

- Hardcode return values
- Copy-paste
- Duplicate code
- Skip edge cases

We'll fix it in REFACTOR.

### Verify GREEN — Watch It Pass

**MANDATORY.**

```bash
# Run the specific test
pytest tests/test_feature.py::test_specific_behavior -v

# Then run ALL tests to check for regressions
pytest tests/ -q
```

Confirm:

- Test passes
- Other tests still pass
- Output pristine (no errors, warnings)

**Test fails?** Fix the code, not the test.

**Other tests fail?** Fix regressions now.

### REFACTOR — Clean Up

After green only:

- Remove duplication
- Improve names
- Extract helpers
- Simplify expressions

Keep tests green throughout. Don't add behavior.

**If tests fail during refactor:** Undo immediately. Take smaller steps.

### Repeat

Next failing test for next behavior. One cycle at a time.

## Why Order Matters

**"I'll write tests after to verify it works"**

Tests written after code pass immediately. Passing immediately proves nothing:

- Might test the wrong thing
- Might test implementation, not behavior
- Might miss edge cases you forgot
- You never saw it catch the bug

Test-first forces you to see the test fail, proving it actually tests something.

**"I already manually tested all the edge cases"**

Manual testing is ad-hoc. You think you tested everything but:

- No record of what you tested
- Can't re-run when code changes
- Easy to forget cases under pressure
- "It worked when I tried it" ≠ comprehensive

Automated tests are systematic. They run the same way every time.

**"Deleting X hours of work is wasteful"**

Sunk cost fallacy. The time is already gone. Your choice now:

- Delete and rewrite with TDD (high confidence)
- Keep it and add tests after (low confidence, likely bugs)

The "waste" is keeping code you can't trust.

**"TDD is dogmatic, being pragmatic means adapting"**

TDD IS pragmatic:

- Finds bugs before commit (faster than debugging after)
- Prevents regressions (tests catch breaks immediately)
- Documents behavior (tests show how to use code)
- Enables refactoring (change freely, tests catch breaks)

"Pragmatic" shortcuts = debugging in production = slower.

**"Tests after achieve the same goals — it's spirit not ritual"**

No. Tests-after answer "What does this do?" Tests-first answer "What should this do?"

Tests-after are biased by your implementation. You test what you built, not what's required. Tests-first force edge case discovery before implementing.

## Common Rationalizations

| Excuse                                 | Reality                                                                                                                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Too simple to test"                   | Simple code breaks. Test takes 30 seconds.                                                                                                                                                                                                    |
| "I'll test after"                      | Tests passing immediately prove nothing.                                                                                                                                                                                                      |
| "Tests after achieve same goals"       | Tests-after = "what does this do?" Tests-first = "what should this do?"                                                                                                                                                                       |
| "Already manually tested"              | Ad-hoc ≠ systematic. No record, can't re-run.                                                                                                                                                                                                 |
| "Deleting X hours is wasteful"         | Sunk cost fallacy. Keeping unverified code is technical debt.                                                                                                                                                                                 |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete.                                                                                                                                                                                   |
| "Need to explore first"                | Fine. Throw away exploration, start with TDD.                                                                                                                                                                                                 |
| "Test hard = design unclear"           | Listen to the test. Hard to test = hard to use.                                                                                                                                                                                               |
| "TDD will slow me down"                | TDD faster than debugging. Pragmatic = test-first.                                                                                                                                                                                            |
| "Manual test faster"                   | Manual doesn't prove edge cases. You'll re-test every change.                                                                                                                                                                                 |
| "Existing code has no tests"           | You're improving it. Add tests for the code you touch.                                                                                                                                                                                        |
| "Scaffolding/infrastructure first"     | Scaffolding (project bootstrap, shell projects, placeholder modules) is infrastructure, not feature code. Create stubs with placeholder tests, confirm compilation, move on. TDD applies to the feature work that follows, not the bootstrap. |

## Red Flags — STOP and Start Over

If you catch yourself doing any of these, delete the code and restart with TDD:

- Code before test
- Test after implementation
- Test passes immediately on first run
- Can't explain why test failed
- Tests added "later"
- Rationalizing "just this once"
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "Keep as reference" or "adapt existing code"
- "Already spent X hours, deleting is wasteful"
- "TDD is dogmatic, I'm being pragmatic"
- "This is different because..."

**All of these mean: Delete code. Start over with TDD.**

## Verification Checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Output pristine (no errors, warnings)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered
- [ ] For Rust: `cargo check && cargo clippy -- -D warnings && cargo fmt --check`
- [ ] For TypeScript/Node: `tsc --noEmit` or equivalent type-check

**⚠️ Rust/Tauri? CHECK PRE-FLIGHT FIRST.** If you see `error[E0670]: 'async fn' is not permitted in Rust 2015` you forgot to set up the toolchain. This is the #1 reason Rust compiles fail on new projects. See the checklist below BEFORE writing any Rust code.

Can't check all boxes? You skipped TDD. Start over.

## Rust/Tauri Pre-flight Checklist

Before writing any Rust code in a Tauri project, verify the toolchain is correctly configured. Failures here produce cryptic errors that look like code bugs.

**Step 1: Verify rust-toolchain.toml exists**

```bash
# Check for rust-toolchain.toml or rust-toolchain file
cat /path/to/src-tauri/rust-toolchain.toml 2>/dev/null || cat /path/to/src-tauri/rust-toolchain 2>/dev/null || echo "MISSING"
```

If it says "MISSING", create it:

```toml
# /path/to/src-tauri/rust-toolchain.toml
[toolchain]
edition = "2021"
```

**Step 2: Verify Cargo.toml edition matches**

```toml
[package]
edition = "2021"  # Must be 2021 or later for async/await
```

**Why this matters:** Without rust-toolchain.toml, some cargo installations default to Rust 2015, which does not support `async fn` or `async move` blocks. The error messages are misleading:

- `error[E0670]: 'async fn' is not permitted in Rust 2015`
- `error: 'async move' blocks are only allowed in Rust 2018 or later`

These look like code bugs but are actually edition misconfiguration.

**Step 3: Run the Rust gate before and after every task**

```bash
cd /path/to/src-tauri && cargo check && cargo clippy -- -D warnings && cargo fmt --check
```

## When Stuck

| Problem                                                                                                  | Solution                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Don't know how to test                                                                                   | Write the wished-for API. Write the assertion first. Ask the user.                                                                                                                                                                                                                                                                     |
| Test too complicated                                                                                     | Design too complicated. Simplify the interface.                                                                                                                                                                                                                                                                                        |
| Must mock everything                                                                                     | Code too coupled. Use dependency injection.                                                                                                                                                                                                                                                                                            |
| Test setup huge                                                                                          | Extract helpers. Still complex? Simplify the design.                                                                                                                                                                                                                                                                                   |
| TypeScript: `tsc --noEmit` fails after writing test code                                                 | Run `pnpm exec tsc --noEmit` to see full error output. TypeScript type errors in test files are real — fix them before committing.                                                                                                                                                                                                     |
| TypeScript/ESLint: `no-unused-vars` on mock parameters                                                   | In test files, mock functions that don't use their parameters (e.g. Tauri `invoke` mocks) must prefix unused params with `_`. Example: `invoke: async (_cmd: string, _args?: Record<string, unknown>) => { ... }`. The `_` prefix tells ESLint the variable is intentionally unused.                                                   |
| Rust compilation fails with "async fn not permitted"                                                     | Missing or misconfigured rust-toolchain.toml — see Rust/Tauri Pre-flight Checklist above                                                                                                                                                                                                                                               |
| Clippy fails with `dead_code` on IPC commands                                                            | `#[tauri::command]` functions are called via IPC, not direct Rust calls. Clippy sees them as unused. Add `#[allow(dead_code)]` above each affected `pub async fn` or `pub struct`. For structs, add `#[allow(dead_code)]` on the struct definition itself.                                                                             |
| Rust: `error[E0428]: name already defined` for command functions                                         | You likely added `#[tauri::command]` in two modules (e.g., both `keychain.rs` and `commands.rs`) for the same function names. Tauri generates macro items from `#[tauri::command]` — define the command in ONE module only, then re-export or delegate in the other. Register only the one definitive module in `generate_handler![]`. |
| Rust: `error[E0603]: enum 'WindowEvent' is private`                                                      | `WindowEvent` is re-exported at `tauri::` root level (not `tauri::window::`). Use `use tauri::{..., WindowEvent}` directly.                                                                                                                                                                                                            |
| Rust: `error[E0599]: no method named 'emit' found`                                                       | The `Emitter` trait is not in scope. Add `use tauri::Emitter;` to imports.                                                                                                                                                                                                                                                             |
| Rust: `deprecated method 'menu_on_left_click'`                                                           | Use `show_menu_on_left_click` instead (Tauri 2 API change).                                                                                                                                                                                                                                                                            |
| Rust: `error[E0521]: borrowed data escapes outside of function` in `on_window_event` closure             | The `on_window_event` closure requires `'static` lifetime. Take `AppHandle` by value (not `&AppHandle`) and clone it inside the closure: `let app = AppHandle::clone(&app);`                                                                                                                                                           |
| Rust: `error[E0308]: mismatched types` on `app.handle()` call                                            | `app.handle()` returns `&AppHandle`, but `setup_close_to_tray` may expect `AppHandle`. Use `app.handle().clone()` to pass an owned clone.                                                                                                                                                                                              |
| Rust: `error[E0599]: no method named 'get_webview_window' found` on `&mut tauri::App`                    | The `Manager` trait is not in scope. Add `use tauri::Manager;` to imports — it provides `get_webview_window()` on `App` instances.                                                                                                                                                                                                     |
| Clippy: `error: writing '&PathBuf' instead of '&Path' involves a new object where a slice will do`       | Change function signature from `&PathBuf` to `&std::path::Path`. Clippy's `ptr_arg` lint fires when using `&PathBuf` where `&Path` suffices.                                                                                                                                                                                           |
| Clippy: `dead_code` fires on every item in an impl block when the whole block is only used via Tauri IPC | Tauri IPC commands are called indirectly via macro-generated code — clippy sees them as unused. Add `#[allow(dead_code)]` to the entire `impl` block, not individual items. Example: `#[allow(dead_code)] impl ServiceManager { ... }`                                                                                                 |
| Clippy: `needless_return` on a `return` at the end of a `#[cfg(...)]` block                              | The cfg block already returns in all branches — clippy flags the redundant `return`. Replace `return Expr;` with bare `Expr` at the end of the block.                                                                                                                                                                                  |
| `unknown field 'devtools'` during `cargo check`                                                          | `devtools` is not a valid field in `tauri.conf.json` `build` section for this Tauri version. Remove it.                                                                                                                                                                                                                                |
| `unknown field 'certificateChain'` during `cargo check`                                                  | `certificateChain` is not a valid field in `tauri.conf.json` `bundle` section for Tauri v2. Code signing is configured via `signingIdentity` only. Remove `certificateChain`.                                                                                                                                                          |
| `unknown field 'minimumDeploymentTarget'` during `cargo check`                                           | `minimumDeploymentTarget` is not valid in `bundle.macOS` section — use `minimumSystemVersion` instead (it is also at the top level of `macOS`). Remove the duplicate field.                                                                                                                                                            |
| `resource path 'scripts/...' doesn't exist` during `cargo check`                                         | Tauri bundles resources relative to `src-tauri/`, not the repo root. If `bundle.resources` references `scripts/foo.sh`, the file must exist at `src-tauri/scripts/foo.sh`. Copy or create the resource there.                                                                                                                          |

## Hermes Agent Integration

### Running Tests

Use the `terminal` tool to run tests at each step:

```python
# RED — verify failure
terminal("pytest tests/test_feature.py::test_name -v")

# GREEN — verify pass
terminal("pytest tests/test_feature.py::test_name -v")

# Full suite — verify no regressions
terminal("pytest tests/ -q")
```

### With delegate_task

When dispatching subagents for implementation, enforce TDD in the goal:

```python
delegate_task(
    goal="Implement [feature] using strict TDD",
    context="""
    Follow test-driven-development skill:
    1. Write failing test FIRST
    2. Run test to verify it fails
    3. Write minimal code to pass
    4. Run test to verify it passes
    5. Refactor if needed
    6. Commit

    Project test command: pytest tests/ -q
    Project structure: [describe relevant files]
    """,
    toolsets=['terminal', 'file']
)
```

### With systematic-debugging

Bug found? Write failing test reproducing it. Follow TDD cycle. The test proves the fix and prevents regression.

Never fix bugs without a test.

## Regression Test Pattern: Session/Task Lifecycle Bugs (Multi-Run Systems)

A common bug class in multi-run systems (recurring tasks, scheduled jobs, session pools):

> Run N's work attaches to Run N-1's stale session — verification events route to the dead session instead of the live one.

**Root cause pattern:** Entities (subtasks, sessions, work items) hold `sessionId` references created in a previous run. On cleanup between runs, `sessionId` is not reset.

**Fix pattern:** In the cleanup block between runs, call a `clearSessionIdsByTask(taskId)` method to reset `sessionId = null` on child entities. This forces each run's work to create fresh sessions attached to the current run.

**When to use:** Recurring scheduled tasks, cron jobs, any system where the same task entity runs multiple times and child work items could retain stale session references.

**Regression test must assert (all three):**

```typescript
// 1. deleteByTask was NOT called — entities are reused, not recreated
expect(mocks.subtasksRepo.deleteByTask).not.toHaveBeenCalled();

// 2. clearSessionIdsByTask WAS called — stale session refs are cleared
expect(mocks.subtasksRepo.clearSessionIdsByTask).toHaveBeenCalledWith('task-1');

// 3. The fresh run's session was passed to execution (not the stale one)
expect(mocks.taskService.executeSubtasks).toHaveBeenCalledWith(
  'task-1',
  expect.objectContaining({ sessionId: 'session-1' }), // fresh session, not stale
);
// And verify the stale session was NOT passed:
const executeCall = mocks.taskService.executeSubtasks.mock.calls[0]?.[1];
expect(executeCall?.sessionId).not.toBe('run-1-stale-session');
```

**Also add the mock method to the harness:**

```typescript
const subtasksRepo = {
  listByTask: vi.fn().mockResolvedValue(subtasks),
  deleteByTask: vi.fn().mockResolvedValue(undefined),
  clearSessionIdsByTask: vi.fn().mockResolvedValue(undefined), // add this
};
```

**TypeScript note:** Use optional chaining when accessing `mock.calls` — `mock.calls[0]?.[1]` — because the mock may not have been called yet in the test setup. Without `?.`, TypeScript will error with `Object is possibly 'undefined'`.

---

## Bug-Fix Testing Pattern (Fix-Then-Test)

TDD's RED phase assumes you write the test before touching production code. For bug fixes, a proven variant:

1. **Understand** — reproduce the bug, confirm the root cause in existing code
2. **Fix** — implement the production code change
3. **Commit the fix** — `git commit -m "fix: <description>"`
4. **Write regression test** — add a test that would have caught the bug, verify it fails against the old state (if possible) and passes now
5. **Commit the test** — `git commit -m "test: regression for <bug>"`
6. **Push and PR**

This differs from pure TDD but is appropriate when the bug is already diagnosed. The regression test still proves the fix and prevents future regression — the key goal of testing. The sequence protects the fix commit from being lost in a rebase if the test needs adjustment.

**When pure TDD is still better:** New features, unknown root causes, or when you're unsure what the correct behavior should be. Use fix-then-test for clearly diagnosed bugs only.

## Session/Task Lifecycle Bugs

A common bug class in multi-run systems (recurring tasks, scheduled jobs, session pools):

> Run N's work attaches to Run N-1's stale session — verification events route to the dead session instead of the live one.

**Pattern:** Entities (subtasks, sessions, work items) hold references to sessions created in a previous run. On cleanup, references are not reset between runs.

**Fix pattern:** In the cleanup block between runs, call a `clearReferencesByParentId()` method to reset `sessionId = null` on child entities. This forces each run's work to create fresh sessions attached to the current run.

**Regression test must assert:**

- `deleteByTask` was NOT called (entities are reused, not recreated)
- `clearSessionIdsByTask` WAS called (stale session refs are cleared)
- The fresh run's session was passed to execution (not the stale one)

## Testing Anti-Patterns

- **Testing mock behavior instead of real behavior** — mocks should verify interactions, not replace the system under test
- **Testing implementation details** — test behavior/results, not internal method calls
- **Happy path only** — always test edge cases, errors, and boundaries
- **Brittle tests** — tests should verify behavior, not structure; refactoring shouldn't break them

## Final Rule

```
Production code → test exists and failed first
Otherwise → not TDD
```

No exceptions without the user's explicit permission.

## Consolidation Note

The `requesting-code-review` and `subagent-driven-development` narrow skills have been **absorbed as labeled subsections** inside the `software-development` class-level umbrella skill:

- **Section: requesting code review** — inside `github-pr-workflow` skill (cross-referenced from `software-development`)
- **Section: subagent-driven-development** — inside `writing-plans` skill (cross-referenced from `software-development`)

This skill (`test-driven-development`) is itself a subsection of the `software-development` umbrella. The full class-level skill with all absorbed subsections is the canonical reference.
