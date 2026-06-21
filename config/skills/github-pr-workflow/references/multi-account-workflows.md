# Multi-Account GitHub Workflows

When one human user has two GitHub accounts — personal and bot — and needs to use them for different purposes in the same session.

## The Two Accounts

| Account              | Purpose                 | Has push to upstream?     |
| -------------------- | ----------------------- | ------------------------- |
| `imzodev`            | User's personal account | Yes (owner)               |
| `agentjetsonimzodev` | Bot/agent account       | No — only to its own fork |

The agent works as `agentjetsonimzodev`, making commits and pushing branches from that identity.

## Git Configuration for the Bot

When the agent operates as the bot account, its git identity should be configured separately:

```bash
git config --global user.email "agent.jetson.imzodev@gmail.com"
git config --global user.name "Jetson Agent"
```

The agent's `.git-credentials` or SSH key should be associated with the `agentjetsonimzodev` account, not `imzodev`.

## The Fork Access Pattern

```
imzodev/openaidy (upstream, owned by user)
    └── agentjetsonimzodev/openaidy (fork, bot account's copy)
```

- Bot has push access to its fork
- Bot does NOT have push access to upstream
- To contribute: PR from fork → upstream (requires `--head owner:branch` and `--repo upstream`)

## SSH and Credential Strategy

**If using SSH:**

```bash
# Host alias in ~/.ssh/config
Host github-bot
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_bot
    IdentitiesOnly yes

# The SSH key must be registered to agentjetsonimzodev
```

**If using HTTPS with token:**

```bash
# Store token for the bot account
git config --global credential.https://github.com.agentjetsonimzodev.username agentjetsonimzodev
git config --global credential.https://github.com.agentjetsonimzodev.password "ghp_..."

# Push uses the bot token automatically for github.com
```

## Critical Distinction: Remote URLs vs --repo Flag

The `--repo` flag in `gh pr create` refers to the **GitHub repository** (owner/repo), NOT the local git remote. You can be in a clone of the upstream but create a PR against it by passing `--repo upstream`.

```bash
# Local clone is of upstream (imzodev/openaidy), but we push to our fork
git remote add origin git@github.com:agentjetsonimzodev/openaidy.git

# Create PR targeting the upstream using --repo
gh pr create \
  --repo imzodev/openaidy \           # targets the upstream repo on GitHub
  --head agentjetsonimzodev:feat/xxx \  # branch lives on our fork
  --title "..."
```

## Verifying Which Account Is Active

```bash
# Check git identity for current repo
git config user.email

# Check gh auth status — which account is authenticated?
gh auth status

# Check which GitHub account is associated with the current remote
git remote get-url origin
# git@github.com:agentjetsonimzodev/openaidy.git → bot account's fork
# git@github.com:imzodev/openaidy.git → user's personal
```

## Common Mistake: Creating PR Against Fork Instead of Upstream

When the agent runs `gh pr create` without `--repo upstream`, it creates the PR against whatever `origin` points to — which for the bot is its own fork. The PR then appears at `agentjetsonimzodev/openaidy/pull/N` instead of `imzodev/openaidy/pull/N`.

**Always pass `--repo imzodev/openaidy`** (the upstream) to target the correct repository, since in the OpenAidy workflow `origin` is the bot's fork — a bare `gh pr create` without `--repo` would create the PR in the fork, not upstream.
