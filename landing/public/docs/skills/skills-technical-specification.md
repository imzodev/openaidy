# Skills — Technical Specification

## Purpose

This document describes the internal design and implementation of the OpenAidy Skills system for contributors and developers working on the server codebase.

---

## Architecture

```
config/skills/          ← bundled defaults (repo source)
      │
      │  seed on boot (no overwrite)
      ▼
.openaidy/skills/       ← SKILLS_DIR (runtime)
  git-workflow/
    SKILL.md
  concise-responder/
    SKILL.md
      │
      ▼
SkillRegistry           ← loads + caches all skills from SKILLS_DIR
      │
      ▼
DispatchService         ← resolves agent.skills → appends bodies to systemPrompt
      │
      ▼
Provider invocation     ← model receives combined system message
```

---

## Module: `src/skills/`

### `parser.ts`

Single responsibility: parse a `SKILL.md` string into a structured `SkillDefinition`.

**Exported types:**

```ts
export type SkillDefinition = {
  id: string; // directory name, passed in by caller
  name: string; // from YAML frontmatter
  description: string; // from YAML frontmatter
  body: string; // everything after the closing ---
};

export type SkillParseError = {
  filePath: string;
  errors: Array<{ message: string }>;
};
```

**Exported function:**

```ts
export function parseSkillMd(
  content: string,
  id: string,
  filePath: string,
): SkillDefinition | SkillParseError;
```

**Parsing algorithm:**

1. Split `content` on the first two occurrences of `---` lines
2. Section 0 (before first `---`): ignored
3. Section 1 (between `---` lines): YAML frontmatter — extract `name` and `description` by line scanning (no heavy YAML parser)
4. Section 2 (after closing `---`): the body, trimmed
5. Return `SkillParseError` if `name` or `description` is missing

---

### `registry.ts`

Loads, caches, and exposes skills. Follows the `AgentRegistry` lazy-load pattern.

**Exported types:**

```ts
export type SkillSummary = {
  id: string;
  name: string;
  description: string;
};

export type SkillRegistryOptions = {
  skillsDir: string;
  initialSkills?: SkillDefinition[]; // for testing — bypasses filesystem
};
```

**Class:**

```ts
export class SkillRegistry {
  constructor(options: SkillRegistryOptions);

  /** Scan skillsDir and cache all valid skills */
  load(): void;

  /** Return summaries of all loaded skills */
  listSkills(): SkillSummary[];

  /** Return full definition for a skill by ID, or undefined */
  getSkill(id: string): SkillDefinition | undefined;

  /** Return full definitions for the given IDs (unknown IDs silently skipped) */
  getSkillsForAgent(skillIds: string[]): SkillDefinition[];
}

export function createSkillRegistry(
  options: SkillRegistryOptions,
): SkillRegistry;
```

**Load algorithm:**

1. If `skillsDir` does not exist → mark as loaded, return (no throw)
2. Read subdirectory names from `skillsDir`
3. For each subdir: read `<skillsDir>/<id>/SKILL.md`
4. Call `parseSkillMd(content, id, filePath)`
5. If parse error → log warning, skip
6. Store valid skills in a `Map<string, SkillDefinition>`

---

### `index.ts` (barrel)

```ts
export { SkillRegistry, createSkillRegistry } from './registry';
export type { SkillRegistryOptions, SkillSummary } from './registry';
export { parseSkillMd } from './parser';
export type { SkillDefinition, SkillParseError } from './parser';
```

---

## Agent Schema Changes (`src/agents/schema.ts`)

```ts
// Added to AgentSchema (after tools):
skills: z.array(z.string()).optional(),

// Added to AgentSummary:
skills: string[] | undefined;

// Added to toAgentSummary():
skills: agent.skills,
```

---

## Agent Registry Changes (`src/agents/registry.ts`)

New method, mirroring `updateAgentTools()` exactly:

```ts
updateAgentSkills(agentId: string, skills: string[]): AgentSummary | undefined {
  this.ensureLoaded();
  const agent = this.agents.get(agentId);
  if (!agent) return undefined;

  const updated: Agent = {
    ...agent,
    skills: skills.length > 0 ? skills : undefined,
  };
  this.agents.set(agentId, updated);

  // Atomic write to openaidy.json
  if (this.configPath && fs.existsSync(this.configPath)) {
    const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    if (Array.isArray(raw.agents)) {
      const idx = raw.agents.findIndex((a) => a.id === agentId);
      if (idx !== -1) {
        if (skills.length > 0) raw.agents[idx].skills = skills;
        else delete raw.agents[idx].skills;
        const tmp = `${this.configPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
        fs.renameSync(tmp, this.configPath);
      }
    }
  }

  return toAgentSummary(updated);
}
```

---

## Dispatch Service Changes (`src/dispatch/service.ts`)

### `DispatchServiceOptions`

```ts
skills?: SkillRegistry;
```

### `buildMessages` signature

```ts
private buildMessages(
  history: SessionMessageRecord[] | SessionMessage[],
  systemPrompt: string,
  skillIds?: string[],
): Message[]
```

### Skill injection logic

```ts
let fullSystemPrompt = systemPrompt;
if (skillIds?.length && this.skills) {
  const bodies = this.skills
    .getSkillsForAgent(skillIds)
    .map((s) => s.body)
    .filter(Boolean)
    .join('\n\n---\n\n');
  if (bodies) {
    fullSystemPrompt += '\n\n---\n\n' + bodies;
  }
}
```

### Call sites

Both `dispatch()` and `dispatchStream()` call `buildMessages`. Pass skill IDs from the resolved agent:

```ts
const agent = this.agents.getAgent(config.agentId);
const messages = this.buildMessages(
  history,
  config.systemPrompt,
  agent?.skills,
);
```

---

## Environment (`src/lib/env.ts`)

```ts
// In z.object({...}):
SKILLS_DIR: z.string().optional(),

// In .transform():
SKILLS_DIR: value.SKILLS_DIR ?? resolveOpenAidyPath(openAidyHome, 'skills'),
```

---

## Routes (`src/routes/skills.ts`)

```ts
export type SkillRoutesOptions = {
  skillRegistry: SkillRegistry;
  agentRegistry: AgentRegistry;
  authMiddleware: AuthMiddleware;
};

export const skillRoutes: FastifyPluginAsync<SkillRoutesOptions> = async (
  app,
  options,
) => {
  // preHandler: requireAuth({ authMiddleware, requiredScope: 'agents.list' })
  // GET /skills
  // Returns: { items: SkillSummary[] }
  // PATCH /agents/:agentId/skills
  // Body: { skills: string[] }
  // Returns: AgentSummary | 400 | 404
};
```

---

## App Wiring (`src/app.ts`)

### Seed on boot

```ts
function seedSkills(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const id of fs.readdirSync(sourceDir)) {
    const src = path.join(sourceDir, id);
    if (!fs.statSync(src).isDirectory()) continue;
    const dest = path.join(targetDir, id);
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      const destFile = path.join(dest, file);
      if (!fs.existsSync(destFile)) {
        fs.copyFileSync(path.join(src, file), destFile);
      }
    }
  }
}
```

### Instantiation

```ts
seedSkills(path.join(workspaceRoot, 'config/skills'), env.SKILLS_DIR);
const skillRegistry = createSkillRegistry({ skillsDir: env.SKILLS_DIR });
```

### DispatchService

```ts
const dispatchService = new DispatchService({
  // ...existing options
  skills: skillRegistry,
});
```

### Route registration

```ts
await app.register(skillRoutes, {
  skillRegistry,
  agentRegistry: services.agents,
  authMiddleware,
});
```

---

## Frontend (`apps/web/src/lib/api.ts`)

```ts
export type SkillInfo = {
  id: string;
  name: string;
  description: string;
};

// Added to Agent type:
skills?: string[];

export async function listSkills(): Promise<{ items: SkillInfo[] }>

export async function updateAgentSkills(
  agentId: string,
  skills: string[],
): Promise<Agent>
```

---

## Test Coverage

| Test file                      | What it covers                                                              |
| ------------------------------ | --------------------------------------------------------------------------- |
| `src/skills/parser.test.ts`    | All parse cases: valid, missing fields, no frontmatter, empty body          |
| `src/skills/registry.test.ts`  | Load from tmp dir, filter, invalid dirs, missing dir, `initialSkills`       |
| `src/routes/skills.test.ts`    | GET /skills, PATCH /agents/:id/skills (200/400/404)                         |
| `src/dispatch/service.test.ts` | Skill bodies appended, empty/absent skills = no change, unknown IDs skipped |
| `src/agents/registry.test.ts`  | `updateAgentSkills` persists + clears correctly                             |

---

## Design Decisions

| Decision                                      | Rationale                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| Skill ID from directory name, not frontmatter | Prevents ID drift; directory name is the canonical identifier             |
| No overwrite on seed                          | User-edited skills are preserved across upgrades                          |
| Skills are append-only to system prompt       | Non-destructive; agent's own `systemPrompt` always takes precedence       |
| Empty `skills: []` → remove key from JSON     | Consistent with `tools` behavior; cleaner config files                    |
| Unknown skill IDs silently skipped            | Prevents agent failures when a skill is temporarily removed               |
| No YAML parser dependency                     | Only `name`/`description` keys are needed; simple line-scan is sufficient |
