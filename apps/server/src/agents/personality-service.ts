import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PersonalityFileId,
  PersonalityFileMeta,
  PersonalityFile,
} from '@openaidy/shared-types';

/**
 * Returns true if the file content is still the unedited default template
 * (only contains HTML comment blocks and markdown headings, no real content).
 */
export function isDefaultContent(content: string): boolean {
  const stripped = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s.*$/gm, '')
    .trim();
  return stripped.length === 0;
}

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

<!--
  INSTRUCTIONS (remove this block when you start editing):

  Define who this agent is. Replace the example below with your own content.
  Everything outside comment blocks will be injected into the system prompt.

  Example:
    My name is [Agent Name]. I have a [describe tone] personality.

    Tone & Character:
    - [trait 1]
    - [trait 2]
-->
`,

  USER: `# User Profile

<!--
  INSTRUCTIONS (remove this block when you start editing):

  Describe who you are so the agent can tailor its responses to you.

  Example:
    My name is [Your Name]. I work as a [your role].

    Background:
    - [skill or area of expertise]
    - [another area]

    Communication style:
    - [preference 1, e.g. "Be concise, skip the preamble"]
    - [preference 2]
-->
`,

  MISSION: `# Mission

<!--
  INSTRUCTIONS (remove this block when you start editing):

  Describe the project or goal this agent is helping with.

  Example:
    I am working on [project name] — [one-sentence description].

    Tech stack: [list the main technologies]

    Current focus: [what you are working on right now]

    Out of scope: [what to ignore or deprioritize]
-->
`,

  RULES: `# Rules

<!--
  INSTRUCTIONS (remove this block when you start editing):

  Define hard constraints the agent must always follow, no exceptions.

  Example:
    - Always respond in [language]
    - Never [something to avoid]
    - Always [something to enforce]
    - If unsure, ask — do not guess
-->
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
   * Returns the labels of personality files that are still at default (unedited) content.
   */
  async getBlankFileLabels(agentId: string): Promise<string[]> {
    const blank: string[] = [];
    for (const meta of PERSONALITY_FILES) {
      const path = join(this.agentDir(agentId), meta.filename);
      if (!existsSync(path)) {
        blank.push(meta.label);
        continue;
      }
      const content = await readFile(path, 'utf-8');
      if (isDefaultContent(content)) blank.push(meta.label);
    }
    return blank;
  }

  /**
   * Delete the entire workspace directory for an agent.
   * Called when an agent is deleted. No-op if the directory does not exist.
   */
  async deleteWorkspace(agentId: string): Promise<void> {
    const dir = this.agentDir(agentId);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Read all personality files for system-prompt injection.
   * Skips files that don't exist or still contain only the default template.
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
      if (trimmed && !isDefaultContent(trimmed)) {
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
