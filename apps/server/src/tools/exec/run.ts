import type { BuiltinTool } from '@openaidy/runtime';
import type { ExecService } from '../../exec/service';

/**
 * exec_run
 *
 * Runs a shell command and returns stdout, stderr, and exit code.
 * The command is executed via /bin/sh -c, so pipes and redirects work.
 *
 * ⚠️  Only enable this tool for agents that you fully trust.
 */
export function createExecRunTool(exec: ExecService): BuiltinTool {
  return {
    name: 'exec_run',
    description:
      'Run a shell command and return its stdout, stderr, and exit code. ' +
      'Supports pipes and redirects (executed via /bin/sh -c). ' +
      'Times out after 30 seconds by default.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description:
            'Optional working directory for the command (absolute path)',
        },
      },
      required: ['command'],
    },
    async execute(args) {
      const command = args['command'];
      const cwd = args['cwd'];

      if (typeof command !== 'string' || !command.trim()) {
        return {
          ok: false,
          error: 'command is required and must be a non-empty string',
        };
      }

      if (cwd !== undefined && typeof cwd !== 'string') {
        return { ok: false, error: 'cwd must be a string' };
      }

      const result = await exec.run(command, cwd as string | undefined);

      const lines: string[] = [];
      if (result.timedOut) {
        lines.push('⚠️  Command timed out and was killed.');
      }
      if (result.stdout) {
        lines.push('stdout:', result.stdout.trimEnd());
      }
      if (result.stderr) {
        lines.push('stderr:', result.stderr.trimEnd());
      }
      lines.push(`exit code: ${result.exitCode}`);

      return { ok: true, content: lines.join('\n') };
    },
  };
}
