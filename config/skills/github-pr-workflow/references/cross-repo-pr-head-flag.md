# Cross-Repository PRs: Fork Branch → Upstream Repo

When your bot account (e.g. `agentjetsonimzodev`) has write access to its **fork** but NOT to the **original upstream** (e.g. `imzodev/openaidy`), you cannot push branches directly to the upstream. The solution is the `--head` flag on `gh pr create`.

## The Golden Rule

**Always check target repo permissions FIRST**, before attempting any push:

```bash
# Check the UPSTREAM repo (imzodev/openaidy), not the fork
gh api repos/imzodev/openaidy --jq '.permissions'
# → {"admin":false,"maintain":false,"pull":true,"push":false,"triage":false,"push":false}

# If push=false → skip the push step entirely, use --head
# If push=true  → push normally, gh pr create without --head
```

## Workflow: PR from Fork to Upstream

```bash
# 1. Check permissions on the TARGET repo
gh api repos/imzodev/openaidy --jq '.permissions'
# → {"push": false, ...}

# 2. Since push=false, do NOT try to push to upstream.
#    Push the branch to YOUR fork (the remote you DO have push access to)
git push -u origin feat/tasks-cli
# → To github.com:agentjetsonimzodev/openaidy.git ✓

# 3. Create the PR targeting the upstream repo using --head
gh pr create \
  --repo imzodev/openaidy \
  --head agentjetsonimzodev:feat/tasks-cli \
  --title "feat(cli): add tasks command group" \
  --body "..." \
  --base main
```

`--head owner:branch` tells GitHub: "the branch `feat/tasks-cli` lives on `agentjetsonimzodev`'s fork, but the PR should target `imzodev/openaidy`."

## Syntax: --head takes `owner:branch`, not just `branch`

```bash
# WRONG — gh will misinterpret this as a branch name in the target repo
gh pr create --repo imzodev/openaidy --head feat/tasks-cli ...

# CORRECT — must specify the fork owner
gh pr create --repo imzodev/openaidy --head agentjetsonimzodev:feat/tasks-cli ...
```

## The --repo Flag Is Your Safety Net

`--repo owner/repo` always targets the **upstream** (imzodev/openaidy), NOT your fork. Without it, `gh pr create` defaults to the origin remote — which for a bot is its own fork, producing a PR that lives at `agentjetsonimzodev/openaidy/pull/N` instead of `imzodev/openaidy/pull/N`.

Always pass `--repo` when creating a PR for the upstream repo, even if you are already in a clone of that repo. The `--repo` flag overrides whatever the local git remote would default to.

```bash
# Safe template — use this every time
gh pr create \
  --repo imzodev/openaidy \               # ALWAYS the upstream
  --head agentjetsonimzodev:feat/xxx \    # your fork branch
  --title "feat: ..." \
  --body "..." \
  --base main
```

> **⚠️ The most common mistake**: omitting `--repo imzodev/openaidy`, so the PR is created against your fork instead of the upstream. The PR will still look correct in `gh pr list` output, but its URL will show the wrong owner. Always verify the URL ends in `imzodev/openaidy/pull/N`, not `agentjetsonimzodev/openaidy/pull/N`.

## Quick Decision Tree

```
Do you have push access to the target repo?
├── YES → git push -u origin HEAD
│         gh pr create --repo owner/repo (no --head needed)
└── NO  → git push -u origin HEAD (pushes to YOUR fork)
          gh pr create --repo owner/repo --head MY_USER:my-branch
```

## Common Pitfalls

1. **Pushing to upstream when you lack push access** — get `terminal prompts disabled` or `could not read Username`. Fix: always check permissions first.
2. **Forgetting `--head owner:branch`** — creates the PR against your own fork instead of the upstream. The PR URL will show `agentjetsonimzodev/openaidy/pull/N`, not `imzodev/openaidy/pull/N`.
3. **`--head` syntax confusion** — the colon separator (`owner:branch`) is required. Without it, GitHub interprets the value as a branch name in the target repo.
4. **Checking the wrong repo's permissions** — check the target (upstream), not your fork. Your fork always shows `push: true`.
5. **`--body` with multi-line or markdown-heavy content** — PR bodies for implementation PRs (architecture changes, migration docs) typically contain markdown tables, `|`, code blocks, or `$` characters. These corrupt when passed inline via `--body "..."`. Always use `--body-file /tmp/pr-body.md` instead. Write the body to a temp file first, then reference it.
