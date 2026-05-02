/**
 * Templates Command - List available addon templates
 */

import * as p from '@clack/prompts';
import type { CommandResult } from '../../types.js';

export async function addonTemplatesHandler(
  _args: string[],
): Promise<CommandResult> {
  const { listTemplates } = await import('../../utils/template-generator.js');

  const templates = listTemplates();
  const body = templates
    .map(
      (t: { name: string; description: string }) =>
        `${t.name.padEnd(12)} ${t.description}`,
    )
    .join('\n');
  p.note(body, 'Available Templates');
  return { exitCode: 0 };
}
