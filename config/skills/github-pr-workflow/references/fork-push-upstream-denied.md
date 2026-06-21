# Fork Push Asymmetry — Cannot Push to Upstream

## The Problem

When working from a fork (`agentjetsonimzodev/openaidy`) with an upstream remote (`imzodev/openaidy`), a common mistake is trying to `git push upstream <branch>`. This fails with exit 128 because the bot account only has push access to the fork, not the upstream.

## Symptoms

```bash
$ git push upstream landing-site-improvements
remote: Permission to imzodev/openaidy.git denied.
fatal: Authentication failed for 'https://github.com/imzodev/openaidy.git/'
```

But `git push origin landing-site-improvements` succeeds (push to fork works).

## Root Cause

The `--repo` flag on `gh pr create` means "target repo where the PR opens", NOT "repo where the branch lives". The bot account's token has write access to the fork but read-only access to upstream.

## Correct Workflow

```bash
# 1. Always push to origin (fork), never upstream
git push -u origin landing-site-improvements

# 2. Create PR targeting upstream, from the fork branch
gh pr create \
  --repo imzodev/openaidy \
  --head agentjetsonimzodev:landing-site-improvements \
  --base main \
  --title "landing: tutorials, theme, transitions" \
  --body-file /tmp/pr-body.md
```

**Key rules:**

- `git push upstream` → almost always wrong from a fork context
- `git push origin` → correct (pushes to the fork)
- `--head owner:branch` → required format when the branch lives on a fork
- `--repo` → always the target (where you want the PR to open), not the fork

## Why `gh pr create` Works Without Push Access

`gh pr create` uses the GitHub API with the token. Even though the bot can't push to upstream, the API can create a PR from a fork branch to an upstream base — as long as the branch already exists on the fork. That's why step 1 (push to origin) is required before creating the PR.
