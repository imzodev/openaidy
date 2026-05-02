/**
 * Agents Create Command Handler
 *
 * Implements `openaidy agents create` command.
 * Creates a new agent config file and its workspace directory.
 * Optionally copies model/provider settings from an existing agent.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  CommandResult,
  AgentConfig,
  OpenAidyConfig,
  SkillSummary,
} from '../../types.js';

function resolveConfigPath(): string {
  return resolve(process.env.APP_CONFIG_PATH ?? '.openaidy/openaidy.json');
}

function resolveWorkspaceBaseDir(): string {
  return resolve(process.env.WORKSPACE_BASE_DIR ?? '.openaidy/workspaces');
}

function resolveSkillsDir(): string {
  return resolve(process.env.SKILLS_DIR ?? '.openaidy/skills');
}

async function readGlobalSkills(): Promise<SkillSummary[]> {
  const skillsDir = resolveSkillsDir();
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return [];
  }
  const skills: SkillSummary[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const skillMdPath = join(skillsDir, entry, 'SKILL.md');
    try {
      const raw = await readFile(skillMdPath, 'utf-8');
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      skills.push({ id: entry, name: nameMatch?.[1]?.trim() ?? entry });
    } catch {
      // skip dirs without SKILL.md
    }
  }
  return skills;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function readAgentConfigs(): Promise<AgentConfig[]> {
  try {
    const raw = await readFile(resolveConfigPath(), 'utf-8');
    const config = JSON.parse(raw) as OpenAidyConfig;
    return config.agents ?? [];
  } catch {
    return [];
  }
}

export async function agentsCreateHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    return {
      exitCode: 0,
      output: `
Usage: openaidy agents create [<name>]

Create a new agent with its own workspace directory.
You will be prompted for a name, description, system prompt,
and whether to copy model/provider settings from an existing agent.

Options:
  --name <name>          Agent display name (skips prompt)
  --id <id>              Agent ID slug (derived from name if omitted)
  --description <desc>   Short description (skips prompt)

Examples:
  pnpm openaidy agents create
  pnpm openaidy agents create "Research Assistant"
  pnpm openaidy agents create --name "Research Assistant" --description "Helps with research"

Exit Codes:
  0  Agent created successfully
  1  Error (invalid input, ID conflict)
`,
    };
  }

  const rl = createInterface({ input, output });

  try {
    const workspaceBaseDir = resolveWorkspaceBaseDir();
    const configPath = resolveConfigPath();

    // Parse --name / --description / --id from args
    let nameArg: string | undefined;
    let idArg: string | undefined;
    let descArg: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--name') nameArg = args[++i];
      else if (args[i] === '--id') idArg = args[++i];
      else if (args[i] === '--description' || args[i] === '--desc')
        descArg = args[++i];
      else if (!args[i].startsWith('-') && !nameArg) nameArg = args[i];
    }

    // Prompt: name
    const name = nameArg ?? (await rl.question('Agent name: ')).trim();

    if (!name) {
      return { exitCode: 1, error: 'Agent name is required.' };
    }

    const id = idArg ?? slugify(name);
    if (!id) {
      return {
        exitCode: 1,
        error: `Cannot derive a valid ID from name "${name}". Use --id to specify one explicitly.`,
      };
    }

    // Check for ID conflict
    const existingAgentsCheck = await readAgentConfigs();
    if (existingAgentsCheck.some((a) => a.id === id)) {
      return {
        exitCode: 1,
        error: `An agent with ID "${id}" already exists.`,
      };
    }

    // Prompt: description
    const description =
      descArg ?? (await rl.question('Description (optional): ')).trim();

    // Prompt: system prompt
    const systemPrompt = (
      await rl.question('System prompt (leave blank for default): ')
    ).trim();

    // Prompt: which global skills to assign?
    let assignedSkills: string[] = [];
    const globalSkills = await readGlobalSkills();
    if (globalSkills.length > 0) {
      const skillList = globalSkills
        .map((s, i) => `  ${i + 2}. ${s.name} (${s.id})`)
        .join('\n');
      const answer = (
        await rl.question(
          `\nWhich global skills should be assigned to this agent?\n  1. All (${globalSkills.length} skills)\n${skillList}\n  0. None\n\nEnter numbers separated by commas [1]: `,
        )
      ).trim();

      const input = answer === '' ? '1' : answer;
      const selections = input.split(',').map((s) => parseInt(s.trim(), 10));

      if (selections.includes(0)) {
        assignedSkills = [];
      } else if (selections.includes(1)) {
        assignedSkills = globalSkills.map((s) => s.id);
      } else {
        for (const sel of selections) {
          const skill = globalSkills[sel - 2];
          if (skill) assignedSkills.push(skill.id);
        }
      }

      if (assignedSkills.length > 0) {
        console.log(`  → Assigned skills: ${assignedSkills.join(', ')}`);
      }
    }

    // Prompt: copy model/provider from existing agent?
    let inheritedModel: string | undefined;
    const existingAgents = await readAgentConfigs();
    if (existingAgents.length > 0) {
      const agentList = existingAgents
        .map((a, i) => `  ${i + 1}. ${a.name} (${a.model ?? '—'})`)
        .join('\n');
      const answer = (
        await rl.question(
          `\nCopy model/provider from an existing agent?\n${agentList}\n  0. No, use defaults\n\nEnter number [0]: `,
        )
      ).trim();
      const idx = parseInt(answer, 10);
      if (idx > 0 && idx <= existingAgents.length) {
        const source = existingAgents[idx - 1]!;
        inheritedModel = source.model;
        console.log(`  → Copied model settings from "${source.name}"`);
      }
    }

    // Build new agent entry
    const newAgent: AgentConfig = {
      id,
      name,
      description: description || `${name} agent`,
      enabled: true,
      systemPrompt:
        systemPrompt ||
        'You are a helpful AI assistant. Be concise, accurate, and helpful.',
      model: inheritedModel ?? 'openai/gpt-4o-mini',
      tags: [],
      ...(assignedSkills.length > 0 ? { skills: assignedSkills } : {}),
      workspace: {
        enabled: true,
        defaultPermissions: {
          read: true,
          write: true,
          delete: false,
          list: true,
        },
        workspaces: [
          {
            path: id,
            permissions: { read: true, write: true, delete: false, list: true },
          },
        ],
      },
      version: 1,
    };

    // Append agent to openaidy.json
    let liveConfig: Record<string, unknown> & { agents?: AgentConfig[] };
    try {
      const raw = await readFile(configPath, 'utf-8');
      liveConfig = JSON.parse(raw) as typeof liveConfig;
    } catch {
      liveConfig = { version: 1 };
    }
    liveConfig.agents = [...(liveConfig.agents ?? []), newAgent];
    await writeFile(
      configPath,
      JSON.stringify(liveConfig, null, 2) + '\n',
      'utf-8',
    );

    // Create agent workspace directory
    const workspacePath = join(workspaceBaseDir, id);
    await mkdir(workspacePath, { recursive: true });

    return {
      exitCode: 0,
      output: [
        ``,
        `✓ Agent "${name}" created`,
        `  ID:        ${id}`,
        `  Config:    ${configPath}`,
        `  Workspace: ${workspacePath}`,
        `  Model:     ${newAgent.model}`,
        ...(assignedSkills.length > 0
          ? [`  Skills:    ${assignedSkills.join(', ')}`]
          : []),
        ``,
        `Restart the server to load the new agent.`,
      ].join('\n'),
    };
  } finally {
    rl.close();
  }
}
