/**
 * Tasks Create Command Handler
 *
 * Implements `openaidy tasks create` command.
 */

import * as p from '@clack/prompts';
import { resolveCLIConfig } from '../../lib/config.js';
import { readAdminToken } from '../../lib/admin-token.js';
import type { CommandResult } from '../../types.js';
import type { TaskPriority } from '@openaidy/shared-types';

const VALID_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export async function tasksCreateHandler(
  args: string[],
): Promise<CommandResult> {
  if (args.includes('-h') || args.includes('--help')) {
    p.note(
      `Usage: openaidy tasks create [title] [--description <desc>] [--priority <p>] [--planning]

Create a new task.

Arguments:
  [title]               Task title (optional — derived from description if omitted)

Options:
  --description <desc>  Task description (required if no title)
  --priority <p>         Priority: low, medium, high, urgent (default: medium)
  --planning            Enable planning agent to decompose into subtasks

Examples:
  pnpm openaidy tasks create "Fix login bug" --priority high
  pnpm openaidy tasks create --description "Implement the new API endpoint"
  pnpm openaidy tasks create "Plan database migration" --planning

Exit Codes:
  0  Success (task created)
  1  Error (server unreachable, not authenticated, validation failed)
  2  Invalid arguments`,
      'Help',
    );
    return { exitCode: 0 };
  }

  const config = resolveCLIConfig();
  const tokenResult = await readAdminToken(config.tokenPath);
  if (!tokenResult.ok) {
    p.log.error(tokenResult.error);
    return { exitCode: 1, error: tokenResult.error };
  }

  let description: string | undefined;
  let priority: TaskPriority = 'medium';
  let planningEnabled = false;
  let positionalTitle: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--description' && i + 1 < args.length) {
      description = args[++i];
    } else if (arg === '--priority' && i + 1 < args.length) {
      const val = args[++i] as TaskPriority;
      if (!VALID_PRIORITIES.includes(val)) {
        const msg = `--priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
        p.log.error(msg);
        return { exitCode: 2, error: msg };
      }
      priority = val;
    } else if (arg === '--planning') {
      planningEnabled = true;
    } else if (!arg.startsWith('--')) {
      positionalTitle = arg;
    }
    i++;
  }

  if (!positionalTitle && !description) {
    const msg = 'Either a task title or --description is required.\nUsage: openaidy tasks create [title] [--description <desc>]';
    p.log.error(msg);
    return { exitCode: 2, error: msg };
  }

  const body: Record<string, unknown> = {
    description: description ?? positionalTitle!,
  };
  if (positionalTitle) body.title = positionalTitle;
  body.priority = priority;
  body.planningEnabled = planningEnabled;

  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = `Cannot reach server at ${config.httpUrl}.\n${err instanceof Error ? err.message : String(err)}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: { message?: string } };
    const msg = `Server returned ${res.status}: ${errBody.error?.message ?? res.statusText}`;
    p.log.error(msg);
    return { exitCode: 1, error: msg };
  }

  const { data } = (await res.json()) as { data: { id: string; title: string } };
  p.log.success(`Task created: ${data.title} [${data.id}]`);
  return { exitCode: 0 };
}