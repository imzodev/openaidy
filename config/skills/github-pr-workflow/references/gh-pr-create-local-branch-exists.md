# gh pr create: "No commits between main and X" when branch exists on fork

## Symptom

```bash
gh pr create --repo imzodev/openaidy --base main --head feat/desktop-app --title "..." --body "..."
# GraphQL: Head sha can't be blank, Base sha can't be blank,
# No commits between main and feat/desktop-app, Head ref must be a branch
```

`git log origin/main..feat/desktop-app` shows commits (so the branch definitely has diff), but `gh` reports zero commits.

## Root Cause (two independent bugs)

**Bug 1 — Missing `--head owner:branch` prefix**

`--head feat/desktop-app` tells GitHub: "find branch `feat/desktop-app` **in the target repo** (`imzodev/openaidy`)." That branch does not exist there — it lives on the fork. GitHub cannot find it, so it returns "Head sha can't be blank."

The fix: prepend the fork owner with a colon: `--head agentjetsonimzodev:feat/desktop-app`.

**Bug 2 — Wrong `--repo` in earlier version of this skill (NOW CORRECTED)**

Some older documentation suggested using `--repo <fork>` as a workaround. This is wrong — it creates the PR at `https://github.com/agentjetsonimzodev/openaidy/pull/N` instead of `https://github.com/imzodev/openaidy/pull/N`. Always use `--repo <upstream>`.

## Correct Fix (both flags required together)

```bash
# The ONLY correct form: --repo=upstream, --head=fork-owner:branch
gh pr create \
  --repo imzodev/openaidy \
  --head agentjetsonimzodev:feat/desktop-app \
  --base main \
  --title "feat(desktop): implement desktop app" \
  --body-file /tmp/pr-body.md
```

## Why Both Flags Are Required

| Flag     | Purpose                | Value for fork→upstream                                              |
| -------- | ---------------------- | -------------------------------------------------------------------- |
| `--repo` | Where the PR opens     | `imzodev/openaidy` (upstream)                                        |
| `--head` | Where the branch lives | `agentjetsonimzodev:feat/desktop-app` (fork, **with owner: prefix**) |

Without `--repo upstream`: gh defaults to origin remote (the fork) → PR opens at wrong URL.
Without `owner:` in `--head`: GitHub looks in the target repo → branch not found.

## Verification After Creation

```bash
gh pr view --json number,title,url,headRefName,baseRefName
# Expected:
# url:   https://github.com/imzodev/openaidy/pull/N     ← correct upstream
# headRefName: feat/desktop-app                          ← bare branch name
# baseRefName: main
```

The `headRefName` will be the bare branch name (the `owner:` prefix is only needed in `--head`, not in the response).

## When You Already See the Wrong URL

If `gh pr list` shows the PR at `agentjetsonimzodev/openaidy/pull/N` instead of `imzodev/openaidy/pull/N`, close it and recreate with the correct flags. There is no `gh pr move` command.

## Decision Tree

```
Is the branch pushed to your fork remote?
├── NO  → git push -u origin HEAD, then use correct form below
└── YES → Are you using BOTH --repo=upstream AND --head=owner:branch?
          ├── YES → should work ✓
          └── NO  → close PR, re-create with both flags
```
