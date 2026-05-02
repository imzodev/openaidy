/**
 * Agents List Command Handler
 *
 * Implements `openaidy agents list` command.
 * Reads agent config files directly from the agents config directory.
 */

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

function formatAgentList(agents: AgentConfig[]): string {
  const lines: string[] = ['Agents', '======', ''];

  if (agents.length === 0) {
    lines.push('No agents found.');
    lines.push('');
    lines.push('Create one with: pnpm openaidy agents create <name>');
    return lines.join('\n');
  }

  const enabled = agents.filter((a) => a.enabled !== false);
  const disabled = agents.filter((a) => a.enabled === false);

  if (enabled.length > 0) {
    lines.push(`Enabled (${enabled.length})`);
    lines.push('');
    for (const a of enabled) {
      lines.push(`  ${a.name}`);
      lines.push(`    ID:       ${a.id}`);
      if (a.description) lines.push(`    Desc:     ${a.description}`);
      if (a.model) lines.push(`    Model:    ${a.model}`);
      if (a.tags?.length) lines.push(`    Tags:     ${a.tags.join(', ')}`);
      lines.push('');
    }
  }

  if (disabled.length > 0) {
    lines.push(`Disabled (${disabled.length})`);
    lines.push('');
    for (const a of disabled) {
      lines.push(`  ${a.name} [disabled]`);
      lines.push(`    ID:  ${a.id}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function agentsListHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    return {
      exitCode: 0,
      output: `
Usage: openaidy agents list

List all configured agents.

Examples:
  pnpm openaidy agents list

Exit Codes:
  0  Success
  1  Error reading agent configs
`,
    };
  }

  const agents = await readAgentConfigs();
  return { exitCode: 0, output: formatAgentList(agents) };
}
