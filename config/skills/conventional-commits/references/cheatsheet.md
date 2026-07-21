# Conventional Commits cheatsheet

## Types

| Type       | Use for                                                 |
| ---------- | ------------------------------------------------------- |
| `feat`     | A new user-facing feature or capability                 |
| `fix`      | A bug fix                                               |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | A change that improves performance                      |
| `test`     | Adding or correcting tests only                         |
| `docs`     | Documentation only                                      |
| `style`    | Formatting/whitespace, no code-behavior change          |
| `chore`    | Build, deps, tooling, config                            |
| `ci`       | CI/pipeline changes                                     |
| `revert`   | Reverts a previous commit                               |

## Anatomy

```
feat(skills): recursively seed skill subdirectories
^    ^         ^
type scope     imperative summary, lower-case, no period, ~72 chars max

<blank line>
Body: why this change exists and why this approach. Wrap ~72 cols.
<blank line>
BREAKING CHANGE: <what breaks + migration>   (only if applicable)
refs #123
```

## Do / Don't

| Do                                           | Don't                              |
| -------------------------------------------- | ---------------------------------- |
| `fix(cli): correct exit code on empty input` | `Fixed stuff`                      |
| `feat(mcp): resolve ${VAR} secrets for http` | `feat: MCP changes and also a fix` |
| imperative: "add", "remove", "correct"       | past tense: "added", "removed"     |
| one logical change per commit                | bundle unrelated changes           |
| reuse scopes seen in `git log`               | invent a new scope per commit      |

## Quick self-check before committing

- [ ] Does the type match the actual change?
- [ ] Is the summary in the imperative and under ~72 chars?
- [ ] Does the body explain _why_, not just restate the diff?
- [ ] Is this one logical change (no "and" in the summary)?
- [ ] Breaking? Then there's a `BREAKING CHANGE:` footer.
