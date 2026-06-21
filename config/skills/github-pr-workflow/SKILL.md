---
name: github-pr-workflow
description: 'GitHub workflow: auth, PRs (branch/commit/open/CI/merge), issues, code review, repo management.'
version: 2.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags:
      [
        GitHub,
        Pull-Requests,
        CI/CD,
        Git,
        Automation,
        Merge,
        Issues,
        Code-Review,
        Repository,
      ]
    related_skills: []
  absorbed:
    [github-auth, github-code-review, github-repo-management, github-issues]
---

# GitHub Pull Request Workflow

Complete guide for managing the PR lifecycle. Each section shows the `gh` way first, then the `git` + `curl` fallback for machines without `gh`.

## Prerequisites

- Authenticated with GitHub (see `github-auth` skill)
- Inside a git repository with a GitHub remote

### Quick Auth Detection

```bash
# Determine which method to use throughout this workflow
if command -v gh &>/dev/null && gh auth status &>/dev/null; then
  AUTH="gh"
else
  AUTH="git"
  # Ensure we have a token for API calls
  if [ -z "$GITHUB_TOKEN" ]; then
    if [ -f ~/.hermes/.env ] && grep -q "^GITHUB_TOKEN=" ~/.hermes/.env; then
      GITHUB_TOKEN=$(grep "^GITHUB_TOKEN=" ~/.hermes/.env | head -1 | cut -d= -f2 | tr -d '\n\r')
    elif grep -q "github.com" ~/.git-credentials 2>/dev/null; then
      GITHUB_TOKEN=$(grep "github.com" ~/.git-credentials 2>/dev/null | head -1 | sed 's|https://[^:]*:\([^@]*\)@.*|\1|')
    fi
  fi
fi
echo "Using: $AUTH"
```

### Extracting Owner/Repo from the Git Remote

Many `curl` commands need `owner/repo`. Extract it from the git remote:

```bash
# Works for both HTTPS and SSH remote URLs
REMOTE_URL=$(git remote get-url origin)
OWNER_REPO=$(echo "$REMOTE_URL" | sed -E 's|.*github\.com[:/]||; s|\.git$||')
OWNER=$(echo "$OWNER_REPO" | cut -d/ -f1)
REPO=$(echo "$OWNER_REPO" | cut -d/ -f2)
echo "Owner: $OWNER, Repo: $REPO"
```

---

## 1. Branch Creation

This part is pure `git` — identical either way:

```bash
# Make sure you're up to date
git fetch origin
git checkout main && git pull origin main

# Create and switch to a new branch
git checkout -b feat/add-user-authentication
```

Branch naming conventions:

- `feat/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — code restructuring
- `docs/description` — documentation
- `ci/description` — CI/CD changes

## 2. Making Commits

Use the agent's file tools (`write_file`, `patch`) to make changes, then commit:

```bash
# Stage specific files
git add src/auth.py src/models/user.py tests/test_auth.py

# Commit with a conventional commit message
git commit -m "feat: add JWT-based user authentication

- Add login/register endpoints
- Add User model with password hashing
- Add auth middleware for protected routes
- Add unit tests for auth flow"
```

Commit message format (Conventional Commits):

```
type(scope): short description

Longer explanation if needed. Wrap at 72 characters.
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `ci`, `chore`, `perf`

## 3. Pushing and Creating a PR

### Push the Branch (same either way)

```bash
git push -u origin HEAD
```

**Troubleshooting push in headless/CI environments:**

If `gh auth status` shows authenticated but `git push` fails with `terminal prompts disabled` or `could not read Username`:

```bash
# Switch from HTTPS to SSH — more reliable in headless
git remote set-url origin git@github.com:owner/repo.git

# Ensure known_hosts has github.com
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

# If SSH key not registered with GitHub yet:
gh api user/keys -X POST -f title="bot-key" -f key="$(cat ~/.ssh/id_ed25519.pub)"

# Now push should work
git push -u origin HEAD
```

### Create the PR

**With gh:**

```bash
gh pr create \
  --title "feat: add JWT-based user authentication" \
  --body "## Summary
- Adds login and register API endpoints
- JWT token generation and validation

## Test Plan
- [ ] Unit tests pass

Closes #42"
```

**Immediately verify the PR URL** — a common mistake is creating it against the wrong repo:

```bash
gh pr view --json number,title,url,headRefName,baseRefName
# url must be: https://github.com/OWNER/REPO/pull/N
# headRefName must be: your-branch (on your fork)
# baseRefName must be: main (the upstream default branch)
```

Options: `--draft`, `--reviewer user1,user2`, `--label "enhancement"`, `--base develop`

### Cross-Repository PRs (Fork → Upstream)

**Context:** OpenAidy agent works from fork `agentjetsonimzodev/openaidy` with `origin` remote; upstream is `imzodev/openaidy` with `upstream` remote. The agent branch must go to the fork, then the PR is created against upstream.

```bash
# 1. Branch from clean main, make changes, commit
git fetch upstream && git checkout upstream/main
git checkout -b landing-site-improvements
# ... make changes ...
git add -A && git commit -m "feat: landing site improvements"

# 2. Push branch to the FORK (origin), not upstream
git push -u origin landing-site-improvements

# 3. Create PR against upstream (imzodev/openaidy), NOT the fork
gh pr create \
  --repo imzodev/openaidy \
  --head agentjetsonimzodev:landing-site-improvements \
  --title "feat: landing site improvements" \
  --body-file /tmp/pr-body.md \
  --base main

# 4. Verify immediately
gh pr view --json number,title,url,headRefName,baseRefName
# url must be: https://github.com/imzodev/openaidy/pull/N
# headRefName must be: landing-site-improvements
# baseRefName must be: main
```

**Key rules:**

- `--repo` = the **target repo** where the PR opens (upstream, `imzodev/openaidy`)
- `--head` = `fork-owner:branch-name` — must include owner prefix, branch must exist on the fork
- Branch MUST exist on fork before creating PR — push first
- Use `--body-file` whenever the body has markdown tables, backticks, or `$`

> **⚠️ `--repo` is NOT the fork**: A common mistake is passing `--repo agentjetsonimzodev/openaidy`. That creates the PR IN the fork, not the upstream. `--repo` is always the target repo.

> **⚠️ Cannot push to upstream**: A bot account with push access to the fork but not upstream cannot `git push upstream branch`. Always push to origin (fork) first, then use `--head owner:branch` to create the cross-repo PR. See `references/fork-push-upstream-denied.md` for the full explanation of why this asymmetry exists.

### Error Recovery: `gh pr create` Failures

**Symptom:** `gh pr create --head feat/desktop-app` fails with:

```
GraphQL: Head sha can't be blank, Base sha can't be blank,
No commits between main and feat/desktop-app, Head ref must be a branch
```

**Cause:** Running from a fork without `--repo` pointing to the fork — `gh` cannot determine which repository to target, so it queries the wrong context.

**Fix:** Always pass `--repo <fork-owner>/<fork-repo>` AND use `owner:branch` format in `--head`:

```bash
gh pr create \
  --repo agentjetsonimzodev/openaidy \
  --base main \
  --head agentjetsonimzodev:feat/desktop-app \
  --title "feat: ..." \
  --body "..."
```

> The `--repo` flag specifies the **target repository** (where the PR opens), not the branch's origin repo. Even when the branch is already pushed to the fork and the local working tree is clean, omitting `--repo` causes `gh` to query the wrong context and fail with a cryptic error.
>
> The `--head` must be `owner:branch` — the branch name alone is not enough when the branch lives on a fork. Omitting the owner prefix causes `gh` to look for the branch on the target repo (where it doesn't exist), producing the "No commits between" error.

**With git + curl:**

```bash
BRANCH=$(git branch --show-current)

curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$OWNER/$REPO/pulls \
  -d "{
    \"title\": \"feat: add JWT-based user authentication\",
    \"body\": \"## Summary\nAdds login and register API endpoints.\n\nCloses #42\",
    \"head\": \"$BRANCH\",
    \"base\": \"main\"
  }"
```

The `gh pr create` response JSON includes the PR `number` — save it for later commands.

> **⚠️ Shell quoting pitfall with `--body`**: Multi-line PR bodies with markdown tables or special characters (`|`, `$`, backticks) can corrupt when passed inline via `--body "..."`. Use `--body-file /tmp/pr-body.md` instead. See `references/pr-body-shell-quoting.md` for the full explanation and safe patterns.

To create as a draft, add `"draft": true` to the JSON body.

## 4. Monitoring CI Status

### Check CI Status

**With gh:**

```bash
# One-shot check
gh pr checks

# Watch until all checks finish (polls every 10s)
gh pr checks --watch
```

**With git + curl:**

```bash
# Get the latest commit SHA on the current branch
SHA=$(git rev-parse HEAD)

# Query the combined status
curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/commits/$SHA/status \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f\"Overall: {data['state']}\")
for s in data.get('statuses', []):
    print(f\"  {s['context']}: {s['state']} - {s.get('description', '')}\")"

# Also check GitHub Actions check runs (separate endpoint)
curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/commits/$SHA/check-runs \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
for cr in data.get('check_runs', []):
    print(f\"  {cr['name']}: {cr['status']} / {cr['conclusion'] or 'pending'}\")"
```

### Poll Until Complete (git + curl)

```bash
# Simple polling loop — check every 30 seconds, up to 10 minutes
SHA=$(git rev-parse HEAD)
for i in $(seq 1 20); do
  STATUS=$(curl -s \
    -H "Authorization: token $GITHUB_TOKEN" \
    https://api.github.com/repos/$OWNER/$REPO/commits/$SHA/status \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")
  echo "Check $i: $STATUS"
  if [ "$STATUS" = "success" ] || [ "$STATUS" = "failure" ] || [ "$STATUS" = "error" ]; then
    break
  fi
  sleep 30
done
```

## 5. Auto-Fixing CI Failures

When CI fails, diagnose and fix. This loop works with either auth method.

### Step 1: Get Failure Details

**With gh:**

```bash
# List recent workflow runs on this branch\ngh run list --branch $(git branch --show-current) --limit 5

# View failed logs\ngh run view <RUN_ID> --log-failed
```

**With git + curl:**

```bash
BRANCH=$(git branch --show-current)

# List workflow runs on this branch
curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/actions/runs?branch=$BRANCH&per_page=5" \
  | python3 -c "
import sys, json
runs = json.load(sys.stdin)['workflow_runs']
for r in runs:
    print(f\"Run {r['id']}: {r['name']} - {r['conclusion'] or r['status']}\")"

# Get failed job logs (download as zip, extract, read)
RUN_ID=<run_id>
curl -s -L \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/actions/runs/$RUN_ID/logs \
  -o /tmp/ci-logs.zip
cd /tmp && unzip -o ci-logs.zip -d ci-logs && cat ci-logs/*.txt
```

### Step 2: Fix and Push

After identifying the issue, use file tools (`patch`, `write_file`) to fix it:

```bash
git add <fixed_files>
git commit -m "fix: resolve CI failure in <check_name>"
git push
```

### Step 3: Verify

Re-check CI status using the commands from Section 4 above.

### Auto-Fix Loop Pattern

When asked to auto-fix CI, follow this loop:

1. Check CI status → identify failures
2. Read failure logs → understand the error
3. Use `read_file` + `patch`/`write_file` → fix the code
4. `git add . && git commit -m "fix: ..." && git push`
5. Wait for CI → re-check status
6. Repeat if still failing (up to 3 attempts, then ask the user)

### Pitfall: Scope-Based Auth Route Bugs

When the codebase uses per-route permission scopes (e.g. `agents.read`, `agents.write`, `agents.delete`), a common CI failure root cause is **a route that declares the wrong scope**. The symptom is a 403 on every request to that endpoint even though the user is authenticated.

Symptoms:

- `gh pr checks` shows failing checks with 403s on one specific HTTP method (usually DELETE)
- The failing route is one that does a permission check via middleware (e.g. `requireAuth`)

Diagnosis:

```bash
# Find all routes and their declared scopes — look for mismatches
grep -n "scope" apps/server/src/routes/agents.ts | grep -E "delete|write|read|list"
```

Fix: Each route must declare the **correct scope name**. Common mistakes:

- DELETE route uses `agents.list` instead of `agents.delete`
- PUT/PATCH route uses a generic scope instead of `agents.write`
- Scope typos (`agents.delete` vs `agent.delete`)

Rebase-and-push pattern to update an existing PR:

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease origin HEAD
```

Do NOT close and reopen a PR to update it — use rebase + force-push instead.

## 6. Merging

**With gh:**

```bash
# Squash merge + delete branch (cleanest for feature branches)
gh pr merge --squash --delete-branch

# Enable auto-merge (merges when all checks pass)
gh pr merge --auto --squash --delete-branch
```

**With git + curl:**

```bash
PR_NUMBER=<number>

# Merge the PR via API (squash)
curl -s -X PUT \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER/merge \
  -d "{
    \"merge_method\": \"squash\",
    \"commit_title\": \"feat: add user authentication (#$PR_NUMBER)\"
  }"

# Delete the remote branch after merge
BRANCH=$(git branch --show-current)
git push origin --delete $BRANCH

# Switch back to main locally
git checkout main && git pull origin main
git branch -d $BRANCH
```

Merge methods: `"merge"` (merge commit), `"squash"`, `"rebase"`

### Enable Auto-Merge (curl)

```bash
# Auto-merge requires the repo to have it enabled in settings.
# This uses the GraphQL API since REST doesn't support auto-merge.
PR_NODE_ID=$(curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['node_id'])")

curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/graphql \
  -d "{\"query\": \"mutation { enablePullRequestAutoMerge(input: {pullRequestId: \\\"$PR_NODE_ID\\\", mergeMethod: SQUASH}) { clientMutationId } }\"}"
```

## 7. Complete Workflow Example

```bash
# 1. Start from clean main
git checkout main && git pull origin main

# 2. Branch
git checkout -b fix/login-redirect-bug

# 3. (Agent makes code changes with file tools)

# 4. Commit
git add src/auth/login.py tests/test_login.py
git commit -m "fix: correct redirect URL after login

Preserves the ?next= parameter instead of always redirecting to /dashboard."

# 5. Push
git push -u origin HEAD

# 6. Create PR (picks gh or curl based on what's available)
# ... (see Section 3)

# 7. Monitor CI (see Section 4)

# 8. Merge when green (see Section 6)
```

## Useful PR Commands Reference

| Action                 | gh                                 | git + curl                                                                                                     |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| List my PRs            | `gh pr list --author @me`          | `curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$OWNER/$REPO/pulls?state=open"` |
| View PR diff           | `gh pr diff`                       | `git diff main...HEAD` (local) or `curl -H "Accept: application/vnd.github.diff" ...`                          |
| Add comment            | `gh pr comment N --body "..."`     | `curl -X POST .../issues/N/comments -d '{"body":"..."}'`                                                       |
| Request review         | `gh pr edit N --add-reviewer user` | `curl -X POST .../pulls/N/requested_reviewers -d '{"reviewers":["user"]}'`                                     |
| Close PR               | `gh pr close N`                    | `curl -X PATCH .../pulls/N -d '{"state":"closed"}'`                                                            |
| Check out someone's PR | `gh pr checkout N`                 | `git fetch origin pull/N/head:pr-N && git checkout pr-N`                                                       |

## Section: GitHub Authentication (absorbed from `github-auth`)

This section covers authentication setup so the agent can work with GitHub repositories, PRs, issues, and CI. Two paths: `git` (always available — HTTPS tokens or SSH) and `gh` CLI (richer access, simpler auth flow).

### Detection

```bash
git --version
gh --version 2>/dev/null || echo "gh not installed"
gh auth status 2>/dev/null || echo "gh not authenticated"
git config --global credential.helper 2>/dev/null || echo "no git credential helper"
```

Decision: `gh auth status` → good, use `gh`; `gh` installed but not authed → use "gh auth" method; `gh` not installed → use "git-only" method.

### Method 1: Git-Only (No gh, No sudo)

**Option A — HTTPS with Personal Access Token (Recommended)**

Tell the user to go to https://github.com/settings/tokens → Generate new token (classic) with scopes: `repo` (full), `workflow`, `read:org`.

```bash
git config --global credential.helper store
# Test: git ls-remote https://github.com/<username>/<any-repo>.git
# Username: <github-username>, Password: <personal-access-token>

# Alternative: embed token directly in remote URL
git remote set-url origin https://<username>:<token>@github.com/<owner>/<repo>.git

# Configure identity
git config --global user.name "Their Name"
git config --global user.email "their-email@example.com"
```

**Option B — SSH Key**

```bash
ls -la ~/.ssh/id_*.pub 2>/dev/null || echo "No SSH keys found"
ssh-keygen -t ed25519 -C "their-email@example.com" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# User adds public key at https://github.com/settings/keys

ssh -T git@github.com  # Should say "Hi <username>! You've successfully authenticated..."

git config --global url."git@github.com:".insteadOf "https://github.com/"
git config --global user.name "Their Name"
git config --global user.email "their-email@example.com"
```

### Method 2: gh CLI

```bash
# Interactive browser login
gh auth login

# Device flow (headless — recommended for SSH servers)
gh auth login -c -h github.com -s repo,read:user
# Shows a code; user approves at https://github.com/login/device on another device

# Token-based (headless)
echo "<THEIR_TOKEN>" | gh auth login --with-token
gh auth setup-git

# SSH key setup via gh API (when gh is authed but git push fails)
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -C "bot-email@example.com" -f ~/.ssh/id_ed25519 -N ""
gh api user/keys -X POST -f title="Hermes Agent" -f key="$(cat ~/.ssh/id_ed25519.pub)"
git remote set-url origin git@github.com:owner/repo.git
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
```

### Helper: Detect Auth Method in Scripts

```bash
if command -v gh &>/dev/null && gh auth status &>/dev/null; then
  echo "AUTH_METHOD=gh"
elif [ -n "$GITHUB_TOKEN" ]; then
  echo "AUTH_METHOD=curl"
elif [ -f ~/.hermes/.env ] && grep -q "^GITHUB_TOKEN=" ~/.hermes/.env; then
  export GITHUB_TOKEN=$(grep "^GITHUB_TOKEN=" ~/.hermes/.env | head -1 | cut -d= -f2 | tr -d '\n\r')
  echo "AUTH_METHOD=curl"
elif grep -q "github.com" ~/.git-credentials 2>/dev/null; then
  export GITHUB_TOKEN=$(grep "github.com" ~/.git-credentials | head -1 | sed 's|https://[^:]*:\([^@]*\)@.*|\1|')
  echo "AUTH_METHOD=curl"
else
  echo "AUTH_METHOD=none"
fi
```

### Troubleshooting

| Problem                                                       | Solution                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git push` asks for password                                  | GitHub disabled password auth — use PAT or SSH                                                                  |
| `remote: Permission to X denied`                              | Token may lack `repo` scope — regenerate with correct scopes                                                    |
| `fatal: Authentication failed`                                | Cached credentials stale — run `git credential reject` then re-authenticate                                     |
| `ssh: connect to host github.com port 22: Connection refused` | Try SSH over HTTPS port: add `Host github.com` with `Port 443` and `Hostname ssh.github.com` to `~/.ssh/config` |
| `gh: command not found` + no sudo                             | Use git-only Method 1 above — no installation needed                                                            |

---

## Section: GitHub Issues Management (absorbed from `github-issues`)

Create, search, triage, and manage GitHub issues. `gh` first, then `curl` fallback.

### Viewing Issues

```bash
# gh
gh issue list --state open --label "bug"
gh issue list --assignee @me
gh issue view 42

# curl
curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/issues?state=open&per_page=20" \
  | python3 -c "
import sys, json
for i in json.load(sys.stdin):
    if 'pull_request' not in i:
        labels = ', '.join(l['name'] for l in i['labels'])
        print(f\"#{i['number']:5}  {i['state']:6}  {labels:30}  {i['title']}\")"
```

### Creating Issues

```bash
# gh
gh issue create \
  --title "Login redirect ignores ?next= parameter" \
  --body "## Description\nAfter logging in, users always land on /dashboard." \
  --label "bug,backend" \
  --assignee "username"

# curl
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/issues \
  -d '{"title": "...", "body": "...", "labels": ["bug"], "assignees": ["username"]}'
```

### Managing Labels, Assignees, Comments

```bash
# Labels
gh issue edit 42 --add-label "priority:high" --remove-label "needs-triage"
curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/issues/42/labels \
  -d '{"labels": ["priority:high"]}'

# Assignees
gh issue edit 42 --add-assignee username
curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/issues/42/assignees \
  -d '{"assignees": ["username"]}'

# Comments
gh issue comment 42 --body "Investigated — root cause is in auth middleware."
curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/issues/42/comments \
  -d '{"body": "Investigated — root cause is in auth middleware."}'

# Close/reopen
gh issue close 42
curl -s -X PATCH -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/issues/42 \
  -d '{"state": "closed", "state_reason": "completed"}'
```

### Issue Triage Workflow

1. `gh issue list --label "needs-triage" --state open`
2. Read and categorize each issue
3. Apply labels and priority
4. Assign if owner is clear
5. Comment with triage notes

### Bug Report and Feature Request Templates

**Bug:**

```
## Bug Description
<What's happening>

## Steps to Reproduce
1. <step>

## Expected Behavior
<What should happen>

## Actual Behavior
<What actually happens>
```

**Feature:**

```
## Feature Description
<What you want>

## Motivation
<Why this would be useful>

## Proposed Solution
<How it could work>

## Alternatives Considered
<Other approaches>
```

### Bulk Operations

```bash
# Close all issues with a label
gh issue list --label "wontfix" --json number --jq '.[].number' | \
  xargs -I {} gh issue close {} --reason "not planned"

# curl equivalent
curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/issues?labels=wontfix&state=open" \
  | python3 -c "import sys,json; [print(i['number']) for i in json.load(sys.stdin)]" \
  | while read num; do
    curl -s -X PATCH -H "Authorization: token $GITHUB_TOKEN" \
      https://api.github.com/repos/$OWNER/$REPO/issues/$num \
      -d '{"state": "closed", "state_reason": "not_planned"}'
  done
```

---

## Section: Code Review (absorbed from `github-code-review`)

Review PRs and local changes. Most of this skill uses plain `git` — `gh`/`curl` only matters for PR-level interactions.

### Reviewing Local Changes (Pre-Push)

Pure `git` — works everywhere, no API needed.

```bash
# Staged changes
git diff --staged

# All changes vs main (what a PR would contain)
git diff main...HEAD
git diff main...HEAD --name-only
git diff main...HEAD --stat

# Common issue checks
git diff main...HEAD | grep -n "print\|console\.log\|TODO\|FIXME\|HACK\|XXX\|debugger"
git diff main...HEAD | grep -in "password\|secret\|api_key\|token.*=\|private_key"
git diff main...HEAD | grep -n "<<<<<<\|>>>>>>\|======="
```

### Review Output Format

```
## Code Review Summary

### Critical
- **src/auth.py:45** — SQL injection: user input passed directly to query.

### Warnings
- **src/models/user.py:23** — Password stored in plaintext. Use bcrypt or argon2.

### Suggestions
- **src/utils/helpers.py:8** — Duplicates logic in `src/core/utils.py:34`.

### Looks Good
- Clean separation of concerns in the middleware layer
```

### Reviewing a Pull Request on GitHub

```bash
# View PR details
gh pr view 123
gh pr diff 123 --name-only
gh pr checks 123

# Check out PR locally for full review
git fetch origin pull/123/head:pr-123
git checkout pr-123
gh pr checkout 123

# Leave a general comment
gh pr comment 123 --body "Overall looks good, a few suggestions below."

# Leave inline review comment (gh API)
HEAD_SHA=$(gh pr view 123 --json headRefOid --jq '.headRefOid')
gh api repos/$OWNER/$REPO/pulls/123/comments \
  --method POST \
  -f body="This could be simplified with a list comprehension." \
  -f path="src/auth/login.py" \
  -f commit_id="$HEAD_SHA" \
  -f line=45 \
  -f side="RIGHT"
```

### Submit a Formal Review (Approve / Request Changes / Comment)

```bash
# gh
gh pr review 123 --approve --body "LGTM!"
gh pr review 123 --request-changes --body "See inline comments."
gh pr review 123 --comment --body "Some suggestions, nothing blocking."
```

**curl — atomic review with multiple inline comments:**

```bash
HEAD_SHA=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['head']['sha'])")

curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER/reviews \
  -d "{
    \"commit_id\": \"$HEAD_SHA\",
    \"event\": \"REQUEST_CHANGES\",
    \"body\": \"Found issues — see inline comments.\",
    \"comments\": [
      {\"path\": \"src/auth.py\", \"line\": 45, \"body\": \"SQL injection — use parameterized queries.\"},
      {\"path\": \"src/models.py\", \"line\": 23, \"body\": \"Plaintext password storage.\"}
    ]
  }"
```

Event values: `"APPROVE"`, `"REQUEST_CHANGES"`, `"COMMENT"`.

### Review Checklist

- **Correctness**: Does the code do what it claims? Edge cases handled?
- **Security**: No hardcoded secrets, input validation, no injection vulnerabilities
- **Code Quality**: Clear naming, DRY, single responsibility
- **Testing**: New code paths tested? Happy path and error cases?
- **Performance**: No N+1 queries, appropriate caching
- **Documentation**: Public APIs documented, non-obvious logic explained

---

## Section: Repository Management (absorbed from `github-repo-management`)

Clone, create, fork, configure, and manage GitHub repositories. `gh` first, then `curl`.

### Cloning

```bash
# HTTPS
git clone https://github.com/owner/repo-name.git
git clone --depth 1 https://github.com/owner/repo-name.git  # shallow

# gh shortcut
gh repo clone owner/repo-name
```

### Creating Repositories

```bash
# gh
gh repo create my-project --public --clone
gh repo create my-org/my-project --public

# curl
curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user/repos \
  -d '{"name": "my-new-project", "description": "A useful tool", "private": false, "auto_init": true, "license_template": "mit"}'
```

### Forking

```bash
# gh
gh repo fork owner/repo-name --clone

# curl
curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/owner/repo-name/forks
sleep 3
git clone https://github.com/$GH_USER/repo-name.git
git remote add upstream https://github.com/owner/repo-name.git
```

### Keeping a Fork in Sync

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
# DO NOT git push upstream main — upstream is read-only for push
```

### Verify Against Upstream Before Reporting "Missing" Content

When a repo has two remotes (fork as `origin`, original as `upstream`), the agent's local clone often lacks content that exists on `upstream/main` because the fork was never synced.

**Rule:** If the question is "does X exist in the project at all?", the answer lives on `upstream`, not `origin`. Always `git fetch upstream` first before concluding any file, branch, or feature is "missing".

### Repository Settings

```bash
gh repo edit --description "Updated description" --visibility public
gh repo edit --enable-wiki=false --enable-issues=true
gh repo edit --default-branch main
```

### Branch Protection

```bash
curl -s -X PUT -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/$OWNER/$REPO/branches/main/protection \
  -d '{
    "required_status_checks": {"strict": true, "contexts": ["ci/test"]},
    "enforce_admins": false,
    "required_pull_request_reviews": {"required_approving_review_count": 1},
    "restrictions": null
  }'
```

### Secrets Management (GitHub Actions)

```bash
gh secret set API_KEY --body "your-secret-value"
gh secret set SSH_KEY < ~/.ssh/id_rsa
gh secret list
gh secret delete API_KEY
```

### Releases

```bash
gh release create v1.0.0 --title "v1.0.0" --generate-notes
gh release list
gh release download v1.0.0 --dir ./downloads
```

### GitHub Actions Workflows

```bash
gh run list --limit 10
gh run view <RUN_ID> --log-failed
gh run rerun <RUN_ID>
gh workflow run ci.yml --ref main
```

### Quick Reference

| Action         | gh                             | curl                                       |
| -------------- | ------------------------------ | ------------------------------------------ |
| Clone          | `gh repo clone o/r`            | `git clone https://github.com/o/r.git`     |
| Create repo    | `gh repo create name --public` | `curl POST /user/repos`                    |
| Fork           | `gh repo fork o/r --clone`     | `curl POST /repos/o/r/forks`               |
| Repo info      | `gh repo view o/r`             | `curl GET /repos/o/r`                      |
| Create release | `gh release create v1.0`       | `curl POST /repos/o/r/releases`            |
| Set secret     | `gh secret set KEY`            | `curl PUT /.../secrets/KEY` (+ encryption) |

---

## OpenAidy-Specific Pattern

**Context:** OpenAidy monorepo at `/tmp/openaidy` — agent works from fork `agentjetsonimzodev/openaidy`, PRs target upstream `imzodev/openaidy`. Branch `feat/provider-profile-registry` was created from main, pushed to fork, PR opened against upstream.

```bash
# Branch from clean main
git fetch origin && git checkout main && git pull origin main
git checkout -b feat/provider-profile-registry

# Make changes, commit
git add -A && git commit -m "feat(scope): description"

# Push to fork (not upstream)
git push -u origin feat/provider-profile-registry

# Create PR targeting upstream repo from fork branch
gh pr create \
  --repo imzodev/openaidy \
  --head agentjetsonimzodev:feat/provider-profile-registry \
  --title "feat(providers): add ProviderProfile registry package" \
  --body "..." \
  --base main
```

**Plan location for OpenAidy:** Plans go in `docs/<feature>/` (e.g. `docs/providers/registry-plan.md`), NOT `.hermes/plans/`. OpenAidy plans live inside the repo.

**PR verification after creation:**

```bash
gh pr view --json number,title,url,headRefName,baseRefName
# url must be: https://github.com/imzodev/openaidy/pull/N
# headRefName must be: feat/provider-profile-registry
# baseRefName must be: main
```

---

## Section: requesting code review (absorbed from `requesting-code-review` skill)

Requesting reviews is a specific step in the PR lifecycle. After your PR is open, request review from the right people.

### Pre-review checklist

Before requesting review, verify:

- [ ] PR description is complete (what, why, how)
- [ ] All CI checks pass
- [ ] Self-review done (diff read, no debug artifacts)
- [ ] Labels set correctly
- [ ] Reviewers know what areas to focus on

### Request reviewers

```bash
# Request specific reviewers
gh pr edit 123 --add-reviewer alice --add-reviewer bob

# Request a team
gh pr edit 123 --add-reviewer @myorg/frontend-team

# Request from PR creation
gh pr create --reviewer alice,bob --label enhancement --base main
```

### Draft vs ready PR

- **Draft PR:** `gh pr create --draft` — not yet ready for review, reviewers won't be notified
- **Ready for review:** convert draft to ready via GitHub UI or `gh pr edit N --remove-draft`

### Review request message template

When you request review, leave a comment to focus the reviewers:

```
/cc @alice @bob — FP and auth reviewed, please focus on:
- The new rate limiter in `src/middleware/ratelimit.py`
- The error handling change in `src/api/handlers.py`
- Any missing test coverage
```

### Handling review feedback

1. **Address every comment** — even if just acknowledging
2. **Push fixes promptly** — don't leave review limbo
3. **Reply to review comments** with explanation if you didn't change something
4. **Re-request review** after addressing feedback (`gh pr edit N --remove-draft` then re-add reviewers)

### Merge requirements

Set branch protection rules before merging:

- Required status checks
- Required reviewers (e.g., 2 approvals)
- Dismiss stale reviews
- Require branches to be up to date

### Squash merge vs merge commit

- **Squash merge** (preferred for single-topic PRs): `gh pr merge --squash` — history stays linear
- **Merge commit**: `gh pr merge --admin --合并` — preserves full history
- **Rebase**: `gh pr merge --rebase` — clean linear history

---

## Additional Reference Files

- `references/commit-timeout-recovery.md` — git commit times out but operation succeeded; recovery pattern
- `references/fork-upstream-pr-checklist.md` — complete decision tree, the three verification numbers, and common failure modes for PRs from fork branch to upstream repo
- `references/fix-commit-author-on-pr.md` — fix commit author on existing PR: cherry-pick + rebase --exec technique for rewriting author metadata without interactive EDITOR
- `references/force-push-consent-pattern.md` — when force-push is needed and how to get user consent via clarify before retrying
- `references/wrong-target-correction.md` — session note: user corrected PR was aimed at wrong repo; root cause was omitting `--repo upstream`
- `references/openaidy-monorepo-patterns.md` — OpenAidy-specific context: repo layout, plan location convention, provider profile registry structure
- `references/openaidy-landing-patterns.md` — OpenAidy landing site (Vite+React SPA at `/tmp/openaidy/landing`): static→SPA docs transition, blog patterns, PR update workflow, adding new pages
- `references/gh-pr-create-local-branch-exists.md` — gh pr create "No commits between" when branch exists locally but gh can't resolve it (wrong --repo target)
- `references/gh-pr-create-body-backtick-pitfall.md` — `gh pr create --body` with inline code snippets fails with "command not found" bash errors; use `--body-file` instead
- `references/cross-repo-pr-from-fork.md` — fork branch → upstream repo PR: `--head owner:branch`, `--repo` meaning, push-to-fork-first pattern, body-file requirement, error recovery
- `references/cross-repo-pr-rest-api-reliable.md` — `gh pr create` fails from fork to upstream despite correct flags; REST API with `owner:branch` succeeds; cherry-pick branch-divergence fix pattern
- `references/write-access-asymmetry.md` — bot account has push access to fork but not to upstream; always check permissions before pushing, use `--head owner:branch` for PRs without push access
