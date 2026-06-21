# Cross-Repo PR: REST API More Reliable Than `gh` CLI

## The Problem

`gh pr create` from a fork targeting upstream repeatedly fails with:

```
GraphQL: Head sha can't be blank, Base sha can't be blank,
No commits between main and feat/landing-page, Head ref must be a branch
```

Even with correct `--repo`, `--head owner:branch`, and `--base` flags. The `gh` CLI can't resolve the cross-repo context reliably.

## The Fix: REST API

```bash
gh api repos/imzodev/openaidy/pulls \
  --method POST \
  --field title="feat(landing): add public landing page" \
  --field base=main \
  --field head=agentjetsonimzodev:feat/landing-page-v2 \
  --field body="$(cat .pr-body-landing.md)"
```

Key: `--head` must be `owner:branch` format (not just `branch`).

## Why gh CLI Fails Here

`gh` queries the target repository context to verify "commits between main and branch". When the branch lives on a fork and the local checkout is also from the fork, `gh` can misresolve which repository to query for the commit comparison. The REST API bypasses this by accepting the fully-qualified `owner:branch` and resolving it server-side.

## Branch Divergence Fix (Cherry-Pick Pattern)

When a branch has wrong-history commits that cause "No commits between" errors even via REST API:

```bash
# 1. Delete old branch, checkout fresh from upstream main
git checkout main && git pull origin main
git branch -D feat/landing-page

# 2. Create new clean branch
git checkout -b feat/landing-page-v2

# 3. Cherry-pick the desired commit(s) from old branch
git cherry-pick <good-commit-sha> --strategy=recursive -X theirs

# 4. Push new branch to fork
git push origin feat/landing-page-v2

# 5. Create PR via REST API
gh api repos/imzodev/openaidy/pulls \
  --method POST \
  --field title="..." \
  --field base=main \
  --field head=agentjetsonimzodev:feat/landing-page-v2 \
  --field body="$(cat .pr-body.md)"
```

This gives a clean branch with exactly the commits needed, no force-push required.
