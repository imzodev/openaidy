# Fix Commit Author on Existing PR

When a PR has commits attributed to the wrong author (e.g. "Hermes Agent" instead of "Jetson Agent"), you need to rewrite the commit history and force-push.

## When This Happens

Commits were made with a misconfigured `user.name`/`user.email` in the local git environment. The content is correct — only the author metadata needs updating.

## Technique: Cherry-Pick + Interactive Rebase with Exec

### Step 1: Identify the commits to fix

```bash
gh pr view <PR_NUMBER> --repo <OWNER>/<REPO> --json commits
# Note the author emails on each commit — identify which ones have the wrong name
```

### Step 2: Cherry-pick the target commits onto a new branch

```bash
# Branch from the good commit (the one BEFORE the bad ones)
git checkout <GOOD_COMMIT_SHA> --detach
git checkout -b fix-author-from-<GOOD_COMMIT_SHA>
git cherry-pick <BAD_COMMIT_1> <BAD_COMMIT_2> ... --strategy=recursive -X theirs
```

### Step 3: Rebase with author-amend exec on each bad commit

```bash
# This runs git commit --amend --author for every commit being rebased
git rebase <GOOD_COMMIT_SHA> --exec 'git commit --amend --author "Correct Name <correct@email.com>" --no-edit'
```

**Why this works:** `git rebase --exec` applies the same author-amend to every commit in the range, which is much simpler than trying to use `git rebase -i` in a headless environment (which requires an EDITOR).

### Step 4: Verify the authors are correct

```bash
git log --oneline -5
git log --format="%an %ae" -3
```

### Step 5: Force push to update the PR

```bash
git push origin fix-author-from-<GOOD_COMMIT_SHA>:feat/<BRANCH_NAME> --force
```

**⚠️ Always clarify with the user before force-pushing.** It rewrites the commit history and affects anyone who has based work on the branch.

## Why Not `git rebase -i`?

`git rebase -i` requires an interactive EDITOR which doesn't work in headless/PTY-less environments ("Terminal is dumb, but EDITOR unset"). The `--exec` flag is a non-interactive alternative that achieves the same result.

## Shell Example

```bash
GOOD_COMMIT="a500f38"
BAD_COMMITS="9bf78ee 6634a56 5f570dc"
CORRECT_NAME="Jetson Agent"
CORRECT_EMAIL="agent.jetson.imzodev@gmail.com"

git checkout $GOOD_COMMIT --detach
git checkout -b fix-author-from-$GOOD_COMMIT
git cherry-pick $BAD_COMMITS --strategy=recursive -X theirs
git rebase $GOOD_COMMIT --exec "git commit --amend --author '$CORRECT_NAME <$CORRECT_EMAIL>' --no-edit"
git push origin fix-author-from-$GOOD_COMMIT:feat/sessions-cli --force
```

## After Force-Pushing

The PR will show the updated commit authors. The PR itself doesn't need to be recreated — the force-push updates the existing commits in place.
