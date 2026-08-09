# Creating Skills

A guide for writing and installing custom skills in OpenAidy.

---

## Quick Start

```bash
# 1. Create a directory for your skill (directory name = skill ID)
mkdir -p .openaidy/skills/my-skill

# 2. Write the SKILL.md file
cat > .openaidy/skills/my-skill/SKILL.md << 'EOF'
---
name: My Skill
description: A brief description of what this skill does
---

Your instructions here. This text is appended to the agent's system prompt.
EOF

# 3. Restart the server — your skill is now available
```

---

## SKILL.md Structure

```markdown
---
name: Human-Readable Name
description: One sentence describing what this skill does and when to use it
---

The body of the skill.

This is appended verbatim to the agent's system prompt.
Use standard markdown formatting.
```

### Rules

- The `---` delimiters are required. The file must have exactly one frontmatter block.
- `name` and `description` are both required in the frontmatter.
- The skill **id** comes from the directory name, not the frontmatter. Choose a short, lowercase, hyphenated name (e.g. `git-workflow`, `sql-expert`).
- The body can be empty if you only need the metadata (but a non-empty body is recommended).

---

## Writing Effective Skill Bodies

### Be specific and actionable

```markdown
❌ Bad:
Be helpful.

✅ Good:
When the user asks about SQL queries:

1. Always ask for the target database dialect (PostgreSQL, MySQL, SQLite) if not specified.
2. Format all queries with consistent indentation and uppercase keywords.
3. Include comments explaining non-obvious joins or subqueries.
```

### Use markdown structure

```markdown
## Tone and Style

- Keep responses concise and direct.
- Use bullet points for lists, not inline commas.
- Never start a sentence with "Certainly!" or "Great question!".

## Code Formatting

- Always include the language identifier on code blocks.
- For shell commands, prefix with `$` for user commands, `#` for root.
```

### Keep skills focused

One skill = one domain of expertise. If you find yourself writing multiple unrelated sections, split into multiple skills and assign both to the agent.

---

## Supporting Files

A skill directory can contain additional files alongside `SKILL.md`:

```
.openaidy/skills/sql-expert/
├── SKILL.md                 ← required
├── DIALECT-REFERENCE.md     ← optional: the agent can read this when needed
└── examples/
    ├── pagination.sql
    └── upsert.sql
```

Supporting files are **not** automatically injected into the prompt. They exist for:

- The skill body to reference by name ("see `DIALECT-REFERENCE.md` for details")
- The agent to read via workspace tools if needed

---

## Bundling Skills With OpenAidy

To ship a skill as a built-in default (auto-installed on first boot):

1. Create the skill directory under `config/skills/` in the repo root:

   ```
   config/skills/my-skill/SKILL.md
   ```

2. On server boot, this is automatically copied to `.openaidy/skills/my-skill/SKILL.md`.
   Existing files at the destination are **never overwritten**.

3. Submit a pull request to the OpenAidy repository.

---

## Assigning Skills to Agents

### Option A: In the agent JSON config

Edit `config/agents/<agent-id>.json` (or the agent JSON in `openaidy.json`):

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "systemPrompt": "You are a helpful assistant.",
  "model": "openai/gpt-4o-mini",
  "skills": ["git-workflow", "concise-responder"]
}
```

### Option B: Via the REST API

```bash
curl -X PATCH http://localhost:3001/agents/my-agent/skills \
  -H "Content-Type: application/json" \
  -d '{"skills": ["git-workflow", "concise-responder"]}'
```

### Option C: Via the UI

Go to **Agents → [select agent] → Skills tab** and toggle skills on/off.

---

## Example Skills

### Concise Responder

```markdown
---
name: Concise Responder
description: Instructs the agent to keep all responses brief, structured, and direct
---

Always respond concisely. Avoid unnecessary preamble or filler phrases.

Structure your responses with:

- A direct answer or action first
- Supporting details only if necessary
- Bullet points for lists, never inline commas

Never start a response with phrases like "Great question!" or "Certainly!".
```

### Git Workflow

```markdown
---
name: Git Workflow
description: Step-by-step git workflow for branching, committing, and opening PRs
---

Always create a feature branch before making changes:

- Branch name format: `feat/<short-description>` or `fix/<short-description>`

Commit with conventional commit messages:

- `feat: add user authentication`
- `fix: resolve null pointer in agent registry`
- `chore: update dependencies`

Open a draft PR as soon as the first commit is pushed. Convert to Ready for Review only when all tests pass and the description is complete.
```

### SQL Expert

```markdown
---
name: SQL Expert
description: Best practices for writing and reviewing SQL queries
---

Before writing a query, confirm the database dialect (PostgreSQL, MySQL, SQLite, etc.).

Formatting rules:

- SQL keywords in UPPERCASE: SELECT, FROM, WHERE, JOIN, GROUP BY
- One clause per line for queries longer than two lines
- Indent subqueries by 2 spaces

Always consider:

- Index usage — mention if a query may cause a full table scan
- NULL handling — use IS NULL / IS NOT NULL, not = NULL
- Injection safety — use parameterized queries in application code, never string interpolation
```

---

## Validation

Before your skill goes live, verify it parses correctly. You can check the `GET /skills` endpoint to confirm it appears:

```bash
curl http://localhost:3001/skills
```

If your skill does not appear:

- Confirm the directory is directly under `SKILLS_DIR` (not nested deeper)
- Confirm `SKILL.md` has both `name` and `description` in its frontmatter
- Check the server logs for a warning about the parse error

---

## FAQ

**Can a skill call external APIs?**
No. Skills are pure text injected into the system prompt. They cannot execute code or make API calls. For that, use an agent's assigned tools or [MCP servers](./mcp-servers.md).

**Can I edit a bundled default skill?**
Yes. Default skills are copied to `.openaidy/skills/` on first boot and never overwritten. Edit the copy in `.openaidy/skills/<id>/SKILL.md` freely.

**What happens if I delete a skill that an agent references?**
The missing skill ID is silently skipped. The agent continues to work using only the skills that exist. No error is thrown.

**Can the same skill be assigned to multiple agents?**
Yes. Skills are shared — the file is read once per server boot and cached. Assign any skill to as many agents as needed.

**Is there a size limit on skill bodies?**
No hard limit is enforced, but keep bodies focused. Large skill bodies consume context tokens on every request. If a skill grows beyond ~500 words, consider splitting it or moving reference material into supporting files.
