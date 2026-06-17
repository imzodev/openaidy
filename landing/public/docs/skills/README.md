# OpenAidy Skills Documentation

This directory contains documentation for the OpenAidy Skills system — a mechanism for attaching reusable prompt fragments to agents, giving them domain-specific expertise without duplicating configuration.

## Overview

Skills are filesystem-based, named prompt packages. Each skill lives in its own directory containing a `SKILL.md` file with YAML frontmatter (metadata) and a markdown body (the actual instructions). When an agent has a skill assigned, the skill's body is appended to the agent's system prompt at dispatch time.

Skills are:

- **Reusable** — defined once, assignable to many agents
- **Opt-in** — an agent only gets a skill if it is explicitly listed in `agent.skills`
- **File-based** — no database required; managed as plain files
- **Non-destructive** — skills extend the system prompt; they never replace it

## File Structure

```
.openaidy/
└── skills/
    ├── git-workflow/
    │   └── SKILL.md
    ├── concise-responder/
    │   ├── SKILL.md
    │   └── REFERENCE.md        ← optional supporting file
    └── sql-expert/
        ├── SKILL.md
        └── examples/
            └── queries.sql     ← optional supporting files
```

Bundled default skills ship in the repo at:

```
config/skills/<skill-id>/SKILL.md
```

They are copied to `.openaidy/skills/` on first boot (existing files are never overwritten).

## SKILL.md Format

Every skill directory must contain exactly one `SKILL.md` file.

````markdown
---
name: Git Workflow
description: Step-by-step git workflow for branching, committing, and opening PRs
---

Always create a feature branch before making changes:

```bash
git checkout -b feat/<short-description>
```
````

Commit with conventional commit messages: `feat:`, `fix:`, `chore:`, etc.

Open a PR as soon as the first commit is pushed. Mark it as Draft until ready for review.

````

### Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Human-readable display name |
| `description` | ✅ | One-sentence summary shown in the UI and used for discovery |

The skill **id** is derived from the directory name, not from the frontmatter. For example, a skill in `skills/git-workflow/` has id `git-workflow`.

### Body

Everything after the closing `---` is the skill body. This content is appended verbatim to the agent's system prompt, separated by `\n\n---\n\n`.

The body can include:
- Plain instructions
- Markdown formatting (headers, bullet points, code blocks)
- References to supporting files in the same directory

## Assigning Skills to Agents

Skills are assigned per-agent via the `skills` array in the agent's configuration or through the API/UI.

### In agent JSON (static)
```json
{
  "id": "my-agent",
  "name": "My Agent",
  "systemPrompt": "You are a helpful assistant.",
  "model": "openai/gpt-4o-mini",
  "skills": ["git-workflow", "concise-responder"]
}
````

### Via the API (dynamic)

```http
PATCH /agents/:agentId/skills
Content-Type: application/json

{ "skills": ["git-workflow", "concise-responder"] }
```

### Via the UI

Navigate to **Agents → [select agent] → Skills tab** and toggle skills on or off.

## How Skills Are Injected

At dispatch time, when an agent has `skills` set, the server:

1. Resolves the agent's `skills` array (e.g. `["git-workflow"]`)
2. Looks up each skill by ID in `SkillRegistry`
3. Concatenates matching skill bodies in order
4. Appends the result to the agent's `systemPrompt` with a `---` separator

**Effective system prompt structure:**

```
<agent.systemPrompt>

---

<skill: git-workflow body>

---

<skill: concise-responder body>
```

Skills with unknown IDs are silently skipped. Order follows the `skills` array.

## Installing Skills

### Default bundled skills

Default skills ship with OpenAidy in `config/skills/`. They are automatically seeded to `.openaidy/skills/` on first server boot. Existing files are never overwritten, so you can edit them freely.

### Custom skills

Create a new directory under `.openaidy/skills/`:

```bash
mkdir -p .openaidy/skills/my-skill
cat > .openaidy/skills/my-skill/SKILL.md << 'EOF'
---
name: My Skill
description: Does something useful
---

Your instructions here.
EOF
```

Restart the server (or it will pick it up on next load). The skill will appear in `GET /skills` and in the UI.

### Supporting files

A skill directory may contain additional files that the skill body references (e.g. templates, reference docs, scripts). They are not parsed or injected automatically — they exist purely for the skill body to reference by name, or for the agent to read via workspace tools.

## API Reference

### `GET /skills`

List all installed skills.

**Response:**

```json
{
  "items": [
    { "id": "git-workflow", "name": "Git Workflow", "description": "..." },
    {
      "id": "concise-responder",
      "name": "Concise Responder",
      "description": "..."
    }
  ]
}
```

### `PATCH /agents/:agentId/skills`

Assign (or clear) skills for an agent.

**Request:**

```json
{ "skills": ["git-workflow"] }
```

**Response:** Updated `AgentSummary` (200), or `{ "error": "..." }` (400 / 404).

Pass an empty array `[]` to remove all skills from an agent.

## Backend Architecture

```
.openaidy/skills/           ← runtime skill directory (SKILLS_DIR)
       │
       ▼
SkillRegistry               ← src/skills/registry.ts
  load()                    ← scans skillsDir, parses each SKILL.md
  listSkills()              ← returns SkillSummary[]
  getSkill(id)              ← returns SkillDefinition | undefined
  getSkillsForAgent(ids[])  ← returns SkillDefinition[] for given IDs
       │
       ▼
DispatchService             ← src/dispatch/service.ts
  buildMessages(            ← assembles system message + skill bodies
    history,
    systemPrompt,
    skillIds?,
  )
```

### Key types

```ts
// src/skills/parser.ts
type SkillDefinition = {
  id: string; // directory name
  name: string; // from frontmatter
  description: string; // from frontmatter
  body: string; // markdown body after ---
};

type SkillSummary = {
  id: string;
  name: string;
  description: string;
};
```

### Environment variable

| Variable     | Default                 | Description                          |
| ------------ | ----------------------- | ------------------------------------ |
| `SKILLS_DIR` | `$OPENAIDY_HOME/skills` | Directory scanned by `SkillRegistry` |

## Security Notes

- Skills are **plain text** — they cannot execute code or call APIs on their own
- A skill body is injected into the system prompt as text; the model interprets it like any other instruction
- Skills are loaded from `SKILLS_DIR` only — no remote fetching
- The seed step never overwrites existing files — user-modified skills are always preserved
- Skills do not grant additional tool access; tool assignment remains separate via `agent.tools`

## File Map

| File                      | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `src/skills/parser.ts`    | Parses `SKILL.md` frontmatter + body                       |
| `src/skills/registry.ts`  | Loads, caches, and exposes skills                          |
| `src/skills/index.ts`     | Barrel exports                                             |
| `src/routes/skills.ts`    | REST endpoints (`GET /skills`, `PATCH /agents/:id/skills`) |
| `src/agents/schema.ts`    | `skills: string[]` field on `AgentSchema`                  |
| `src/agents/registry.ts`  | `updateAgentSkills()` method                               |
| `src/dispatch/service.ts` | Injects skill bodies into system prompt                    |
| `src/lib/env.ts`          | `SKILLS_DIR` env var                                       |
| `src/app.ts`              | Seed + instantiation + route registration                  |
| `config/skills/`          | Bundled default skills (repo source)                       |
| `.openaidy/skills/`       | Runtime skills directory                                   |

## Related Documentation

- `docs/architecture.md` — overall system architecture
- `docs/addons/README.md` — addon plugin system (separate from skills)
- GitHub issues [#261–#275](https://github.com/imzodev/openaidy/issues/261) — implementation tracking
