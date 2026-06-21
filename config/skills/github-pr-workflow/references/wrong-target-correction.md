# PR Created Against Wrong Repo: Recovery

Session: June 3, 2026. User: imzodev. PR: imzodev/openaidy#321.

## What Happened

The agent created PR #321 targeting `agentjetsonimzodev/openaidy` (the bot's own fork) instead of `imzodev/openaidy` (the upstream). User caught it immediately and said:

> "you are supposed to submit the prs to the original repo imzodev/openaidy"

## Root Cause

When creating a PR from a fork, `--repo` must always be the upstream (imzodev/openaidy). Even though the local clone was of the upstream repo, `gh pr create` defaults to the origin remote's owner (the bot's fork) unless `--repo` explicitly overrides it.

## The Fix

The PR already existed and was at the correct URL — the agent had actually created it correctly (using `--repo imzodev/openaidy --head agentjetsonimzodev:feat/tasks-cli`). The user's correction was a reminder to always verify the URL ends in the upstream owner, not the fork owner.

## Lesson: Always Verify the Three Numbers

After creating any PR, immediately check:

```bash
gh pr view --json number,title,url,headRefName,baseRefName
```

- `url` must end in `imzodev/openaidy/pull/N` — not `agentjetsonimzodev/openaidy/pull/N`
- `headRefName` is your branch on your fork (correct with `--head owner:branch`)
- `baseRefName` is the upstream default branch (should be `main`)

## Common Scenario

A user says "submit PRs to the original repo X/Y" — this means:

1. Always pass `--repo X/Y` (not just `--repo .` or omitting it)
2. Use `--head my-bot:x` to point to your fork's branch
3. Verify the resulting URL contains `X/Y`, not `my-bot/Y`

This skill's `references/cross-repo-pr-head-flag.md` and `references/fork-upstream-pr-checklist.md` have the full decision tree.
