# Cross-Repo PR: Fork Branch → Upstream Repo

When working from a fork and the PR needs to target the original repo (not the fork), use `--head owner:branch` to specify the branch on the fork.

## The Pattern

```bash
# 1. Create branch on fork, push
git checkout -b feat/my-feature
git add -A && git commit -m "feat: description"
git push -u origin feat/my-feature

# 2. Create PR targeting upstream from fork's branch
gh pr create \
  --repo upstream-owner/upstream-repo \
  --head fork-owner:feat/my-feature \
  --title "feat: description" \
  --body-file /tmp/pr-body.md \
  --base main
```

## Key Rules

1. **`--repo` = target repo** (where the PR opens), NOT the branch's origin repo
2. **`--head` = `owner:branch`** — branch name alone is not enough; the owner prefix is required
3. **Push to fork first** — the branch must exist on the fork before `gh` can reference it

## Why `--head owner:branch` Instead of Pushing to Upstream?

Bot accounts often have write access to the fork but NOT to the upstream repo. You cannot `git push upstream branch`. The workaround: push to fork, then use `--head owner:branch` to create a PR from the fork's branch into the upstream repo — without needing push access to upstream.

## Permissions Check

Before attempting push, check permissions:

```bash
gh api repos/owner/repo --jq '.permissions'
# {push: true}  → can push directly
# {push: false} → cannot push; use --head owner:branch pattern instead
```

## Error: "Head sha can't be blank" or "No commits between"

**Symptom:** `gh pr create --head feat/my-feature` fails with "Head sha can't be blank" or "No commits between main and feat/my-feature".

**Cause:** Omitting `--repo` causes `gh` to look for the branch on the wrong repo (usually upstream, where it doesn't exist).

**Fix:** Always pass `--repo <fork-owner>/<fork-repo>` AND use `owner:branch` format:

```bash
gh pr create \
  --repo agentjetsonimzodev/openaidy \
  --base main \
  --head agentjetsonimzodev:feat/my-feature \
  --title "feat: description" \
  --body-file /tmp/pr-body.md
```

## `--body-file` Is Mandatory When Body Has Special Characters

The PR body often contains markdown tables (`|`), backticks (`` ` ``), or `$` — these get interpreted as shell commands when passed via `--body "inline text"`. Always use `--body-file`:

```bash
cat > /tmp/pr-body.md << 'EOF'
## Summary

- Feature description here

| Route | Method | Scope |
|-------|--------|-------|
| GET /agents | agents.list |
| DELETE /agents/:id | agents.delete |

Closes #123
EOF

gh pr create \
  --repo upstream-owner/upstream-repo \
  --head fork-owner:feat/my-feature \
  --title "feat: description" \
  --body-file /tmp/pr-body.md \
  --base main
```

## Verification After Creation

Always verify the PR is correct after creation:

```bash
gh pr view --json number,title,url,headRefName,baseRefName
```

Expected:

- `url`: `https://github.com/upstream-owner/upstream-repo/pull/N`
- `headRefName`: `feat/my-feature`
- `baseRefName`: `main`

## Summary

| Situation                          | Action                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Bot has push to fork, not upstream | Push to fork, create PR with `--head fork-owner:branch --repo upstream/repo` |
| Body has `\|`, backticks, `$`      | Use `--body-file /tmp/pr-body.md`                                            |
| Got "Head sha can't be blank"      | Add `--repo <fork-owner>/<fork-repo>` and `owner:branch` format              |
| Got "No commits between"           | Same fix — wrong `--repo` target                                             |
| Can push to upstream directly      | Normal flow: push to upstream, `gh pr create --repo upstream/repo`           |
