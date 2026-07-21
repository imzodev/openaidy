---
name: Data and APIs
description: Use when calling external REST APIs or querying databases on the user's behalf through available tools or MCP servers — read-only by default, parametrized queries, and confirmation before any write.
version: 1.0.0
---

# Data and APIs

Pulling data from an API or a database is routine; a careless write or an
unbounded query is not. Default to read-only, be precise about what you
request, and treat every write as something to confirm first.

## Before the call

- Confirm the right tool or configured MCP server is available and already
  holds the credentials. Don't ask the user to paste secrets into chat.
- Know the shape of what you're hitting: the endpoint or table, the
  parameters, and what a successful response looks like.
- Read the auth and rate-limit rules. Respect pagination instead of
  demanding everything at once.

## Querying safely

- Start read-only. A `SELECT` or `GET` to understand the data before any
  change.
- Parametrize inputs. Never splice raw user text into a query string —
  build filters from typed values.
- Bound your reads: add a `LIMIT`, a date range, or a page size. An
  unfiltered pull on a large table is a mistake, not thoroughness.
- Handle failures explicitly. A 4xx/5xx or an empty result is information,
  not a reason to retry blindly.

## Writes and side effects

- Any insert, update, delete, POST, or payment is outward-facing: state
  exactly what will change and confirm before running it.
- Prefer a dry run or a one-record test before a bulk operation.
- After a write, read the affected record back to confirm the change took.

See `references/request-checklist.md`.

## Anti-patterns

- Splicing untrusted input into a query instead of parametrizing it.
- Running an unbounded full export when a filter would do.
- Performing a write or bulk update without confirmation.
- Retrying a failing call in a loop instead of reading the error.
