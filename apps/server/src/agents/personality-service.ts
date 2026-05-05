import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PersonalityFileId,
  PersonalityFileMeta,
  PersonalityFile,
} from '@openaidy/shared-types';

/**
 * Canonical metadata for each personality file.
 * Order here determines injection order in the system prompt.
 */
export const PERSONALITY_FILES: PersonalityFileMeta[] = [
  {
    id: 'AGENT',
    filename: 'AGENT.md',
    label: 'Agent Identity',
    description:
      'Who the agent is — its name, emoji, personality, tone, and character.',
    systemPromptBlock: 'AGENT_IDENTITY',
  },
  {
    id: 'USER',
    filename: 'USER.md',
    label: 'User Profile',
    description:
      'Who the user is — name, language, expertise, communication preferences.',
    systemPromptBlock: 'USER_CONTEXT',
  },
  {
    id: 'MISSION',
    filename: 'MISSION.md',
    label: 'Mission',
    description:
      "Why we're here — the project, goals, stack, and current focus.",
    systemPromptBlock: 'MISSION_CONTEXT',
  },
  {
    id: 'RULES',
    filename: 'RULES.md',
    label: 'Rules',
    description: 'Hard constraints — always enforced, no exceptions.',
    systemPromptBlock: 'RULES',
  },
];

const DEFAULT_CONTENTS: Record<PersonalityFileId, string> = {
  AGENT: `# Agent Identity

Give your agent a name, an emoji, and a personality.

## Example

🤖 My name is **Alex**. I'm a sharp, direct assistant who gets things done.

## Tone & Character

- Direct and concise — no filler, no preamble
- Honest about uncertainty
- Proactively flags risks or edge cases
`,

  USER: `# User Profile

Tell the agent who you are so it can tailor every response.

## Example

My name is **Irving**. I'm a senior software engineer.

## What I Know Well

I'm fluent in TypeScript, Node.js, and SolidJS. Don't explain basics.

## Communication Style

- Keep responses concise
- Lead with the answer, put context after
- Prefer code over prose
`,

  MISSION: `# Mission

🚀 Describe what you're working on so the agent always has context.

## Example

I'm building **openaidy** — an open-source AI agent platform built with
TypeScript, SolidJS, Fastify, and SQLite.

## Current Focus

Implementing the agent personality system.

## Out of Scope

- Mobile apps
- Infrastructure / DevOps
`,

  RULES: `# Rules

Hard constraints — the agent must always follow these, no exceptions.

## Example

- Always respond in English, even if I write in another language
- Never suggest technologies outside our approved stack
- Always flag security implications proactively
- If unsure, ask — don't guess
`,
};

/**
 * Options for AgentPersonalityService
 */
export interface AgentPersonalityServiceOptions {
  workspaceBaseDir: string;
}

/**
 * AgentPersonalityService
 *
 * Manages the four personality markdown files (AGENT.md, USER.md,
 * MISSION.md, RULES.md) stored in each agent's workspace directory.
 *
 * Responsibilities:
 * - Scaffold default files when an agent is created
 * - Read a single file's content
 * - Write (update) a single file's content
 * - Read all files for system-prompt injection
 */
export class AgentPersonalityService {
  private readonly workspaceBaseDir: string;

  constructor(options: AgentPersonalityServiceOptions) {
    this.workspaceBaseDir = options.workspaceBaseDir;
  }

  private agentDir(agentId: string): string {
    return join(this.workspaceBaseDir, agentId);
  }

  private filePath(agentId: string, fileId: PersonalityFileId): string {
    const meta = PERSONALITY_FILES.find((f) => f.id === fileId);
    if (!meta) throw new Error(`Unknown personality file: ${fileId}`);
    return join(this.agentDir(agentId), meta.filename);
  }

  /**
   * Scaffold all four personality files for a newly created agent.
   * Creates files only if they don't already exist.
   */
  async scaffold(agentId: string): Promise<void> {
    const dir = this.agentDir(agentId);
    await mkdir(dir, { recursive: true });

    for (const meta of PERSONALITY_FILES) {
      const path = join(dir, meta.filename);
      if (!existsSync(path)) {
        await writeFile(path, DEFAULT_CONTENTS[meta.id], 'utf-8');
      }
    }
  }

  /**
   * Read a single personality file.
   * Returns content and whether the file exists.
   */
  async readFile(
    agentId: string,
    fileId: PersonalityFileId,
  ): Promise<PersonalityFile> {
    const path = this.filePath(agentId, fileId);
    if (!existsSync(path)) {
      return { id: fileId, content: DEFAULT_CONTENTS[fileId], exists: false };
    }
    const content = await readFile(path, 'utf-8');
    return { id: fileId, content, exists: true };
  }

  /**
   * Write (create or overwrite) a single personality file.
   */
  async writeFile(
    agentId: string,
    fileId: PersonalityFileId,
    content: string,
  ): Promise<void> {
    const dir = this.agentDir(agentId);
    await mkdir(dir, { recursive: true });
    const path = this.filePath(agentId, fileId);
    await writeFile(path, content, 'utf-8');
  }

  /**
   * Read all personality files and return them as a map of block → content.
   * Used by the dispatch service for system-prompt injection.
   * Files that don't exist return empty string (no block injected).
   */
  async readAllForInjection(
    agentId: string,
  ): Promise<Array<{ meta: PersonalityFileMeta; content: string }>> {
    const results: Array<{ meta: PersonalityFileMeta; content: string }> = [];

    for (const meta of PERSONALITY_FILES) {
      const path = join(this.agentDir(agentId), meta.filename);
      if (!existsSync(path)) continue;
      const content = await readFile(path, 'utf-8');
      const trimmed = content.trim();
      if (trimmed) {
        results.push({ meta, content: trimmed });
      }
    }

    return results;
  }
}

export function createAgentPersonalityService(
  options: AgentPersonalityServiceOptions,
): AgentPersonalityService {
  return new AgentPersonalityService(options);
}
