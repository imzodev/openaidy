# Write Access Asymmetry: Bot vs Personal Account

## The Problem

In multi-account GitHub setups (bot account for agent work, personal account for
human work), write permissions are often asymmetric:

- Bot account (`agentjetsonimzodev`) has write access to **fork** (`agentjetsonimzodev/openaidy`)
- Bot account has **NO** write access to **upstream** (`imzodev/openaidy`)
- Personal account has write access to both

This asymmetry causes silent failures when creating PRs or pushing branches.

## Symptoms

### Push fails silently

```bash
git push upstream fix/recurring-planned-tasks
# ERROR: Permission to imzodev/openaidy.git denied to agentjetsonimzodev.
# fatal: Could not read from remote repository.
```

### PR created against wrong repo

```bash
gh pr create --repo agentjetsonimzodev/openaidy ...  # creates against fork, not upstream
```

### Bash substitution corrupts PR body

Backtick-wrapped code in `--body "..."` gets interpreted as shell command
substitutions. PR body is garbage but exit code is 0. See
`references/gh-pr-create-body-backtick-pitfall.md`.

## Prevention Checklist

Before every push or PR creation, ask:

1. **Which remote am I pushing to?** (`git remote -v`)
2. **Do I have write access to that remote?** (`gh api repos/owner/repo --jq '.permissions'`)
3. **Is this the correct target repo for the PR?** (upstream vs fork vs origin)
4. **Does my body contain backticks or special chars?** → use `--body-file`

## Decision Tree

```
Is the branch already pushed to a remote I have write access to?
├── YES → Push from that remote. If upstream fails, fall back to origin.
│        Check: git remote -v and git config user.email
│        If email is agent.jetson.imzodev@gmail.com, I'm on the bot account.
│        Bot has write to agentjetsonimzodev/openaidy, NOT imzodev/openaidy.
│
├── NO  → Use --head owner:branch to create PR without pushing.
│        gh pr create \
│          --repo TARGET_UPSTREAM \
│          --head botaccount:branch-name \
│          --title "..." --body-file /tmp/pr-body.md --base main
│        This creates the PR from the fork branch WITHOUT needing
│        push access to the upstream repo.
```

## Verification After PR Creation

Always verify the PR landed in the right place:

```bash
gh pr view --json number,title,url,headRefName,baseRefName

# For upstream PR from fork branch:
# url:  https://github.com/imzodev/openaidy/pull/N  (NOT agentjetsonimzodev)
# headRefName: agentjetsonimzodev:fix/some-branch
# baseRefName: main
```

## Session Note

With imzodev/openaidy:

- Bot account: agentjetsonimzodev (email: agent.jetson.imzodev@gmail.com)
- Bot has write to: agentjetsonimzodev/openaidy
- Bot does NOT have write to: imzodev/openaidy
- Personal account: imzodev — has write to both

When user asked for PRs to imzodev/openaidy, push failed with permission denied.
Workaround: ask user to push manually, or use `--head owner:branch` if gh can
create PRs without upstream push access (it can — the `--head owner:branch`
flag works without push access to the target repo).
