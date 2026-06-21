# Bot Account Setup for GitHub Operations

When the user wants to differentiate commits between human and agent, set up a dedicated bot GitHub account.

## Overview

A bot account allows the agent to:

- Push commits attributed to a distinct "Jetson Agent" author name
- Submit PRs from a separate GitHub identity
- Have explicit collaborator permissions per-repo (controlled by the user)

**Trade-off:** Bot accounts are GitHub accounts — they need email verification, can trigger GitHub's bot detection, and GitHub's ToS requires human-managed accounts (no fully automated/bot-only accounts).

## Setup Workflow

### Step 1: User Creates Dedicated Email

The user creates a new email account (Gmail, Proton, etc.) solely for the bot. The user controls this email.

**Example:** `agent.jetson.imzodev@gmail.com` created by the user

### Step 2: User Creates GitHub Account with That Email

The user signs up at github.com using the bot email. The user must complete email verification (GitHub sends a link to the bot inbox — user accesses it).

**Required:** The user must complete CAPTCHA and email verification. The agent cannot do this.

### Step 3: Generate a PAT from the Bot Account

Once the bot account is verified, the user (or the agent, if given credentials) generates a PAT:

1. Go to: `https://github.com/settings/tokens`
2. Create new token (classic)
3. Select scopes: `repo`, `read:user`, `read:org`
4. Copy the token

**Alternative: SSH keys** — more reliable in headless environments (see SSH Key Setup in main skill).

### Step 4: Agent Configures Git Identity

```bash
git config --global user.name "Jetson Agent"
git config --global user.email "agent.jetson.imzodev@gmail.com"
```

### Step 5: Agent Authenticates with the PAT

```bash
# Using gh CLI
echo "<PAT>" | gh auth login --with-token

# Or if using git-only
git config --global credential.helper store
echo "https://botusername:<PAT>@github.com" > ~/.git-credentials
```

### Step 6: Verify Auth Works

```bash
gh auth status
gh api user  # Should show bot username
```

## Bot Account in PRs

When the bot submits a PR:

- **Commit author:** Shows "Jetson Agent <bot-email>" (from git config)
- **GitHub account attribution:** Shows the bot's GitHub username
- **PR merge option:** User can require PRs from bot to be reviewed before merging

## Repo Access for Bot Account

For private repos, the bot account needs to be added as a collaborator:

1. Go to repo → Settings → Manage access
2. Invite collaborator: `bot-github-username`
3. Bot accepts via email notification

For public repos, the bot can fork, edit, and submit PRs directly.

## Session Notes

- Bot account created: `agentjetsonimzodev`
- Bot email: `agent.jetson.imzodev@gmail.com`
- Bot PAT scopes used: `repo`, `read:user`, `read:org`, `admin:public_key`, `gist`, `notifications`, `project`, `user`, `workflow`, `write:discussion`, `write:packages`
