/**
 * Agents Delete Command Handler
 *
 * Implements `openaidy agents delete` command.
 * Removes an agent from openaidy.json after the user confirms by typing the agent ID.
 */

import * as p from '@clack/prompts';
import { readFile, writeFile } from 'node:fs/promises';
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

export async function agentsDeleteHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy agents delete [<id>]

Delete an agent from the configuration. You will be asked to confirm by typing
the agent ID before anything is removed.

Options:
  <id>   Agent ID to delete (prompted if omitted)

Examples:
  openaidy agents delete
  openaidy agents delete my-agent

Exit Codes:
  0  Agent deleted (or cancelled)
  1  Error`,
      'Help',
    );
    return { exitCode: 0 };
  }

  const configPath = resolveConfigPath();
  const agents = await readAgentConfigs();

  if (agents.length === 0) {
    p.log.warn('No agents found in configuration.');
    return { exitCode: 0 };
  }

  p.intro('Delete Agent');

  // Resolve target agent — from arg or prompt
  let targetId: string | undefined = args.find((a) => !a.startsWith('-'));

  if (!targetId) {
    const choice = await p.select<string>({
      message: 'Which agent do you want to delete?',
      options: agents.map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.id,
      })),
    });
    if (p.isCancel(choice)) {
      p.cancel('Cancelled.');
      return { exitCode: 0 };
    }
    targetId = choice;
  }

  const agent = agents.find((a) => a.id === targetId);
  if (!agent) {
    p.log.error(`Agent "${targetId}" not found.`);
    return { exitCode: 1, error: `Agent not found: ${targetId}` };
  }

  // Confirmation — user must type the agent ID
  p.log.warn(
    `You are about to permanently delete agent "${agent.name}" (${agent.id}).`,
  );
  const confirmation = await p.text({
    message: `Type the agent ID to confirm: ${agent.id}`,
    placeholder: agent.id,
    validate: (value) => {
      if (!value) return 'Required.';
    },
  });
  if (p.isCancel(confirmation)) {
    p.cancel('Cancelled.');
    return { exitCode: 0 };
  }
  if (confirmation !== agent.id) {
    p.log.error(
      `ID does not match. Got "${confirmation}", expected "${agent.id}". Aborted.`,
    );
    return { exitCode: 1, error: 'Confirmation mismatch' };
  }

  // Remove from config
  const s = p.spinner();
  s.start('Removing agent…');
  let liveConfig: Record<string, unknown> & { agents?: AgentConfig[] };
  try {
    const raw = await readFile(configPath, 'utf-8');
    liveConfig = JSON.parse(raw) as typeof liveConfig;
  } catch {
    s.stop('Failed.');
    p.log.error('Could not read configuration file.');
    return { exitCode: 1, error: 'Cannot read config' };
  }

  liveConfig.agents = (liveConfig.agents ?? []).filter(
    (a) => a.id !== agent.id,
  );

  await writeFile(
    configPath,
    JSON.stringify(liveConfig, null, 2) + '\n',
    'utf-8',
  );
  s.stop('Agent removed.');

  p.outro(
    [
      `Agent "${agent.name}" (${agent.id}) deleted.`,
      ``,
      `Restart the server to apply the change.`,
    ].join('\n'),
  );

  return { exitCode: 0 };
}
