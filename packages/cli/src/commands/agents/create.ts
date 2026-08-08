/**
 * Agents Create Command Handler
 *
 * Implements `openaidy agents create` command.
 * Creates a new agent config file and its workspace directory.
 * Optionally copies model/provider settings from an existing agent.
 */

import * as p from '@clack/prompts';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isAgentIdentityHexColor } from '@openaidy/shared-types';
import type {
  CommandResult,
  AgentConfig,
  OpenAidyConfig,
  SkillSummary,
  CreateAgentInput,
  AgentIdentity,
} from '../../types.js';

const ACCENT_COLOR_PALETTE: Array<{ label: string; value: string }> = [
  { label: 'Violet', value: '#7C3AED' },
  { label: 'Blue', value: '#2563EB' },
  { label: 'Green', value: '#16A34A' },
  { label: 'Amber', value: '#D97706' },
  { label: 'Rose', value: '#E11D48' },
  { label: 'Slate', value: '#475569' },
];

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
    p.note(
      `Usage: openaidy agents create [<name>]

Create a new agent with its own workspace directory.

Options:
  --name <name>          Agent display name (skips prompt)
  --id <id>              Agent ID slug (derived from name if omitted)
  --description <desc>   Short description (skips prompt)
  --emoji <emoji>        Identity emoji (skips identity prompts)
  --color <hex>          Identity accent color, e.g. #7C3AED (skips identity prompts)
  --no-identity          Skip the identity (emoji + accent color) prompts entirely

Examples:
  pnpm openaidy agents create
  pnpm openaidy agents create "Research Assistant"
  pnpm openaidy agents create --name "Research Assistant" --description "Helps with research"
  pnpm openaidy agents create --name "Research Assistant" --emoji "🔬" --color "#2563EB"
  pnpm openaidy agents create --name "Research Assistant" --no-identity

Exit Codes:
  0  Agent created successfully
  1  Error (invalid input, ID conflict)`,
      'Help',
    );
    return { exitCode: 0 };
  }

  const workspaceBaseDir = resolveWorkspaceBaseDir();
  const configPath = resolveConfigPath();

  // Parse --name / --description / --id / --emoji / --color / --no-identity from args.
  // A value-taking flag with no following value (or one immediately followed
  // by another flag) is a usage error — it must not silently fall through to
  // an interactive prompt, which would hang a non-interactive (CI) invocation.
  const VALUE_FLAGS = new Set([
    '--name',
    '--id',
    '--description',
    '--desc',
    '--emoji',
    '--color',
  ]);
  const isFlagValue = (token: string | undefined): token is string =>
    token !== undefined && !token.startsWith('-');

  let nameArg: string | undefined;
  let idArg: string | undefined;
  let descArg: string | undefined;
  let emojiArg: string | undefined;
  let colorArg: string | undefined;
  let noIdentity = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;

    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (!isFlagValue(value)) {
        const message = `${arg} requires a value.`;
        p.cancel(message);
        return { exitCode: 1, error: message };
      }
      if (arg === '--name') nameArg = value;
      else if (arg === '--id') idArg = value;
      else if (arg === '--description' || arg === '--desc') descArg = value;
      else if (arg === '--emoji') emojiArg = value;
      else if (arg === '--color') colorArg = value;
      i++;
      continue;
    }

    if (arg === '--no-identity') noIdentity = true;
    else if (!arg.startsWith('-') && !nameArg) nameArg = arg;
  }

  p.intro('Create Agent');

  // Prompt: name
  const nameResult = nameArg
    ? nameArg
    : await p.text({
        message: 'Agent name',
        placeholder: 'My Agent',
        validate: (v) =>
          !(v ?? '').trim() ? 'Agent name is required.' : undefined,
      });
  if (p.isCancel(nameResult)) {
    p.cancel('Cancelled.');
    return { exitCode: 1, error: 'Cancelled.' };
  }
  const name = (nameResult as string).trim();

  if (!name) {
    p.cancel('Agent name is required.');
    return { exitCode: 1, error: 'Agent name is required.' };
  }

  const id = idArg ?? slugify(name);
  if (!id) {
    p.cancel(
      `Cannot derive a valid ID from name "${name}". Use --id to specify one explicitly.`,
    );
    return { exitCode: 1, error: `Cannot derive a valid ID from "${name}".` };
  }

  // Check for ID conflict
  const existingAgentsCheck = await readAgentConfigs();
  if (existingAgentsCheck.some((a) => a.id === id)) {
    p.cancel(`An agent with ID "${id}" already exists.`);
    return { exitCode: 1, error: `An agent with ID "${id}" already exists.` };
  }

  // Prompt: description
  const descResult = descArg
    ? descArg
    : await p.text({
        message: 'Description',
        placeholder: 'Optional — leave blank to skip',
      });
  if (p.isCancel(descResult)) {
    p.cancel('Cancelled.');
    return { exitCode: 1, error: 'Cancelled.' };
  }
  const description = ((descResult as string | undefined) ?? '').trim();

  // Identity: emoji + accent color (skippable via --no-identity, or preset via --emoji/--color)
  let identity: AgentIdentity | undefined;
  if (!noIdentity) {
    let emoji: string | undefined = emojiArg?.trim();
    if (emoji !== undefined && (!emoji || emoji.length > 8)) {
      p.cancel('Emoji must be 1-8 characters.');
      return { exitCode: 1, error: 'Emoji must be 1-8 characters.' };
    }
    if (emoji === undefined) {
      const emojiResult = await p.text({
        message: 'Identity emoji',
        placeholder: '🦊',
        validate: (v) => {
          const trimmed = (v ?? '').trim();
          if (!trimmed) return 'Emoji is required.';
          if (trimmed.length > 8) return 'Emoji must be at most 8 characters.';
          return undefined;
        },
      });
      if (p.isCancel(emojiResult)) {
        p.cancel('Cancelled.');
        return { exitCode: 1, error: 'Cancelled.' };
      }
      emoji = (emojiResult as string).trim();
    }

    let accentColor: string | undefined = colorArg?.trim();
    if (accentColor !== undefined && !isAgentIdentityHexColor(accentColor)) {
      p.cancel(
        `Invalid accent color "${accentColor}". Expected a 6-digit hex color like #7C3AED.`,
      );
      return {
        exitCode: 1,
        error: `Invalid accent color "${accentColor}".`,
      };
    }
    if (accentColor === undefined) {
      const colorResult = await p.select<string>({
        message: 'Identity accent color',
        options: [
          ...ACCENT_COLOR_PALETTE.map((c) => ({
            value: c.value,
            label: c.label,
            hint: c.value,
          })),
          { value: 'custom', label: 'Custom…' },
        ],
      });
      if (p.isCancel(colorResult)) {
        p.cancel('Cancelled.');
        return { exitCode: 1, error: 'Cancelled.' };
      }
      if (colorResult === 'custom') {
        const customColorResult = await p.text({
          message: 'Custom accent color (hex)',
          placeholder: '#7C3AED',
          validate: (v) =>
            !isAgentIdentityHexColor((v ?? '').trim())
              ? 'Must be a 6-digit hex color, e.g. #7C3AED.'
              : undefined,
        });
        if (p.isCancel(customColorResult)) {
          p.cancel('Cancelled.');
          return { exitCode: 1, error: 'Cancelled.' };
        }
        accentColor = (customColorResult as string).trim();
      } else {
        accentColor = colorResult;
      }
    }

    identity = { emoji, accentColor: accentColor as `#${string}` };
  }

  // Prompt: system prompt
  const systemPromptResult = await p.text({
    message: 'System prompt',
    placeholder: 'Leave blank for default',
  });
  if (p.isCancel(systemPromptResult)) {
    p.cancel('Cancelled.');
    return { exitCode: 1, error: 'Cancelled.' };
  }
  const systemPrompt = (
    (systemPromptResult as string | undefined) ?? ''
  ).trim();

  // Prompt: global skills (multiselect)
  let assignedSkills: string[] = [];
  const globalSkills = await readGlobalSkills();
  if (globalSkills.length > 0) {
    const skillsResult = await p.multiselect<string>({
      message: 'Assign global skills (space to toggle, enter to confirm)',
      options: globalSkills.map((s) => ({
        value: s.id,
        label: s.name,
        hint: s.id,
      })),
      initialValues: globalSkills.map((s) => s.id),
      required: false,
    });
    if (p.isCancel(skillsResult)) {
      p.cancel('Cancelled.');
      return { exitCode: 1, error: 'Cancelled.' };
    }
    assignedSkills = skillsResult as string[];
  }

  // Prompt: copy model from existing agent
  let inheritedModel: string | undefined;
  const existingAgents = await readAgentConfigs();
  if (existingAgents.length > 0) {
    const modelResult = await p.select<AgentConfig | null>({
      message: 'Copy model from an existing agent?',
      options: [
        ...existingAgents.map((a) => ({
          value: a,
          label: a.name,
          hint: a.model ?? '—',
        })),
        {
          value: null,
          label: 'No — use default (openai/gpt-4o-mini)',
        },
      ],
    });
    if (p.isCancel(modelResult)) {
      p.cancel('Cancelled.');
      return { exitCode: 1, error: 'Cancelled.' };
    }
    if (modelResult) inheritedModel = modelResult.model;
  }

  // Build the minimal user-provided input — all structural defaults applied by registry.createAgent()
  const input: CreateAgentInput = {
    id,
    name,
    systemPrompt:
      systemPrompt ||
      'You are a helpful AI assistant. Be concise, accurate, and helpful.',
    model: inheritedModel ?? 'openai/gpt-4o-mini',
    description: description || undefined,
    tags: [],
    skills: assignedSkills.length > 0 ? assignedSkills : undefined,
    identity,
  };

  // Construct the full AgentConfig for openaidy.json (mirrors what registry.createAgent() produces)
  const newAgent: AgentConfig = {
    ...input,
    enabled: true,
    description: input.description || `${name} agent`,
    version: 1,
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
  };

  // Write to openaidy.json
  const s = p.spinner();
  s.start('Saving agent config…');
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

  // Create workspace directory
  const workspacePath = join(workspaceBaseDir, id);
  await mkdir(workspacePath, { recursive: true });
  s.stop('Agent config saved.');

  p.outro(
    [
      `Agent "${name}" created!`,
      `  ID:        ${id}`,
      `  Model:     ${newAgent.model}`,
      ...(assignedSkills.length > 0
        ? [`  Skills:    ${assignedSkills.join(', ')}`]
        : []),
      ``,
      `Restart the server to load the new agent.`,
    ].join('\n'),
  );

  return { exitCode: 0 };
}
