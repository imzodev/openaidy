/**
 * Agents List Command Handler
 *
 * Implements `openaidy agents list` command.
 * Reads agent config files directly from the agents config directory.
 */

import * as p from '@clack/prompts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  CommandResult,
  AgentConfig,
  OpenAidyConfig,
} from '../../types.js';

function resolveConfigPath(): string {
  return resolve(process.env.APP_CONFIG_PATH ?? '.openaidy/openaidy.json');
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

function formatAgent(a: AgentConfig): string {
  const lines: string[] = [
    `${a.name}${a.enabled === false ? ' [disabled]' : ''}`,
  ];
  lines.push(`ID:     ${a.id}`);
  if (a.description) lines.push(`Desc:   ${a.description}`);
  if (a.model) lines.push(`Model:  ${a.model}`);
  if (a.tags?.length) lines.push(`Tags:   ${a.tags.join(', ')}`);
  if (a.skills?.length) lines.push(`Skills: ${a.skills.join(', ')}`);
  return lines.join('\n');
}

export async function agentsListHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy agents list

List all configured agents.

Examples:
  pnpm openaidy agents list

Exit Codes:
  0  Success
  1  Error reading agent configs`,
      'Help',
    );
    return { exitCode: 0 };
  }

  const agents = await readAgentConfigs();

  if (agents.length === 0) {
    p.note(
      'No agents found.\n\nCreate one with: openaidy agents create',
      'Agents',
    );
    return { exitCode: 0 };
  }

  const enabled = agents.filter((a) => a.enabled !== false);
  const disabled = agents.filter((a) => a.enabled === false);

  const sections: string[] = [
    ...enabled.map((a) => formatAgent(a)),
    ...disabled.map((a) => formatAgent(a)),
  ];

  p.note(sections.join('\n\n'), `Agents (${agents.length})`);

  return { exitCode: 0 };
}
