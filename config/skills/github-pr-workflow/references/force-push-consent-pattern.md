# Force-Push Consent Pattern

When a `git push --force` is needed (rewriting commit history, updating PR with corrected commits), Hermes Agent's consent system may block the command and require user approval.

## The Pattern

```bash
# Attempt force push → blocked
git push origin feat/sessions-cli --force
# → BLOCKED: "Command timed out without user response"

# Use clarify to request consent
clarify(question="Force push to update PR #320? This rewrites commit history.", choices=null)
# → waiting for user response

# User approves → retry succeeds
```

## What to Say in the Clarify

Be specific. Include:

- Which branch
- What the force push changes (e.g. "replaces Hermes Agent with Jetson Agent on 3 commits")
- Whether it's safe (no other people have based work on the branch)

**Bad:** "Can I push?"
**Good:** "Force push to feat/sessions-cli — this replaces Hermes Agent with Jetson Agent on 3 commits in PR #320. Safe because no one else is working on this branch. Proceed?"

## When Force Push Is Needed

1. Rewriting commit author metadata (fix-commit-author-on-pr.md)
2. Rebasing onto updated main to resolve conflicts
3. Squashing commits before merge
4. Deleting old/incorrect commits from a branch

## Non-Force Alternatives

Before reaching for force push, check if a regular push works:

- `git push` (fast-forward only) — always safe, never requires force
- `git push --force-with-lease` — safer than `--force` (rejects if someone else pushed) but still requires consent

When in doubt: use `--force-with-lease` instead of `--force` when available.
