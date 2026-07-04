---
name: Web Research
description: Use when you need current or external facts — searching the web, reading multiple sources, cross-checking claims, and synthesizing an answer with citations instead of guessing from memory.
version: 1.0.0
---

# Web Research

Your training data is stale and incomplete. When a question turns on
current events, prices, versions, docs, or any fact you're not sure of,
look it up — and show where the answer came from.

## When to reach for the web

- The answer could have changed since your knowledge cutoff — releases,
  prices, news, who holds a role.
- The user asks about a specific product, library version, API, or company.
- You're about to state a number, date, or quote you can't verify from the
  conversation.
- Do _not_ search for things you already know reliably or that are already
  in the repo or context.

## Method

1. Check for a search/fetch tool or a configured MCP server. If none is
   available, say so and answer from what you know — flagged as unverified.
   Do not invent a citation.
2. Start broad, then narrow. Turn the question into 2–4 focused queries,
   not one vague one.
3. Open the primary source. Prefer official docs, the vendor's own site, or
   the original report over a blog summarizing it.
4. Cross-check anything surprising or load-bearing against a second,
   independent source before you rely on it.
5. Note the date on each source — a confident older page can be wrong now.

## Reporting

- Cite each non-obvious claim with its source (title + link), and end with
  a short "Sources" list.
- Separate what the sources say from your own inference. Don't launder a
  guess as a finding.
- If sources conflict, say so and give the most credible reading rather
  than averaging them.

See `references/source-checklist.md`.

## Anti-patterns

- Answering a "what's the latest…" question from memory without checking.
- Citing a single source for a contested or high-stakes claim.
- Quoting a page you never actually opened.
- Dumping raw search results instead of synthesizing an answer.
