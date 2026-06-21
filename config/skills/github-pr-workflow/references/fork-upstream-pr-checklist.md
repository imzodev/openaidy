# Fork → Upstream PR: Complete Decision Tree

The pattern for bot accounts (agentjetsonimzodev) that have push access to their **fork** but NOT to the **upstream** (imzodev/openaidy).

## Always Check Permissions First

```bash
gh api repos/imzodev/openaidy --jq '.permissions.push'
# → false  → use --head flag
# → true   → push normally, no --head needed
```

## Decision Tree

```
Am I in a clone of the upstream (imzodev/openaidy)?
├── YES
│   └── Do I have push access to imzodev/openaidy?
│       ├── YES → git push origin HEAD
│       │         gh pr create --repo imzodev/openaidy ...
│       └── NO  → git push -u origin HEAD           (pushes to YOUR fork)
│                 gh pr create \
│                   --repo imzodev/openaidy \       ← ALWAYS the upstream
│                   --head agentjetsonimzodev:xxx \ ← MUST include owner:
│                   --title "..." --body "..."
└── NO (in a clone of my own fork)
    └── Do I have push access to the target upstream?
        ├── YES → git push origin HEAD
        │         gh pr create --repo imzodev/openaidy ...
        └── NO  → ⚠️ You are already on your fork, just push and create:
                  git push -u origin HEAD
                  gh pr create \
                    --repo imzodev/openaidy \       ← upstream target
                    --head YOUR_USER:your-branch \ ← still needed to route PR
                    --title "..."
```

## The Three Numbers to Verify After Creating

```bash
gh pr view --json number,title,url,headRefName,baseRefName
```

1. **`url`** — must end in `imzodev/openaidy/pull/N`, NOT `agentjetsonimzodev/openaidy/pull/N`
2. **`headRefName`** — must be your branch on your fork
3. **`baseRefName`** — must be `main` (or whatever the upstream default branch is)

## Common Failure Modes

| Symptom                                            | Cause                                             | Fix                                               |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| PR created at `agentjetsonimzodev/openaidy/pull/N` | Forgot `--repo upstream`                          | Close it, recreate with `--repo imzodev/openaidy` |
| `gh pr create` says "ref not found"                | `--head` missing owner prefix                     | Use `--head agentjetsonimzodev:feat/xxx`          |
| Push fails with "terminal prompts disabled"        | Trying to push to upstream without access         | Skip push, use `--head owner:branch`              |
| PR has wrong base branch                           | `--base` defaults to `main` but should be checked | Explicitly pass `--base main`                     |

## Updating an Existing PR (Rebase + Force-Push)

If you need to update the branch of an already-open PR:

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease origin HEAD
```

**Do NOT** close and reopen a PR to update it. The PR number and comment history are lost that way.

## Cross-Repo PRs Without --head

If you have push access to the upstream directly (e.g. you're a collaborator, not a bot):

```bash
git push -u origin HEAD
gh pr create \
  --repo imzodev/openaidy \
  --title "feat: ..." \
  --body "..." \
  --base main
# No --head needed when you have push access
```
