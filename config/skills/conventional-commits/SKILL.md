---
name: Conventional Commits
description: Use when writing a git commit message or PR title — format it as a Conventional Commit (type(scope): summary) with a body that explains why, matching this repo's history.
version: 1.0.0
---

# Conventional Commits

Commit messages are read far more often than they're written. A
consistent, structured message makes history skimmable and explains _why_
a change exists — which the diff can't.

## Format

```
type(scope): short summary in the imperative

Optional body: what changed and, more importantly, WHY. Wrap at ~72
columns. Reference the problem this solves, not a restatement of the diff.

Optional footer: BREAKING CHANGE: ..., refs #123, Co-Authored-By: ...
```

- **type** — the kind of change (see cheatsheet). Required.
- **scope** — the area touched, e.g. `mcp`, `skills`, `cli`, `server`.
  Optional but encouraged; match scopes already used in `git log`.
- **summary** — imperative mood ("add", "fix", not "added"/"fixes"),
  lower-case, no trailing period, ≤ ~72 chars.

## Common types

`feat` new feature · `fix` bug fix · `refactor` behavior-preserving
change · `test` tests only · `docs` docs only · `chore` tooling/deps ·
`perf` performance · `ci` pipeline. Full list in
`references/cheatsheet.md`.

## Writing the body

The summary says _what_; the body says _why_. Good bodies answer:

- What problem or symptom prompted this?
- Why this approach over the obvious alternative?
- Anything a future reader would be surprised by?

Skip the body only for truly self-evident one-liners.

## Match this repo

- Look at recent `git log --oneline` and reuse existing scopes and
  phrasing rather than inventing new conventions.
- One logical change per commit. If the summary needs "and", it's
  probably two commits.
- Never bypass hooks (`--no-verify`) or signing unless explicitly asked.

## Breaking changes

Add a `BREAKING CHANGE:` footer (or `!` after the type/scope, e.g.
`feat(api)!:`) describing what breaks and how to migrate.
