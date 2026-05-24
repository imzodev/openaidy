import { resolve, relative } from 'node:path';
import type { BuiltinTool } from '@openaidy/runtime';
import type { ExecService } from '../../exec/service';
import type { WorkspaceService } from '../../workspace/service';
import { execRunMeta } from '../catalog.js';

/**
 * exec_run
 *
 * Runs a shell command and returns stdout, stderr, and exit code.
 * The command is executed via /bin/sh -c, so pipes and redirects work.
 *
 * Safety measures:
 *  - Commands matching a dangerous-pattern blocklist are rejected before spawn.
 *  - The working directory is always inside the agent's workspace.
 *    If `cwd` is supplied it must be a relative path within the workspace;
 *    absolute paths that escape the workspace are rejected.
 *
 * ⚠️  Only enable this tool for agents that you fully trust.
 */
export function createExecRunTool(
  exec: ExecService,
  workspace: WorkspaceService,
): BuiltinTool {
  return {
    name: execRunMeta.name,
    description: execRunMeta.description,
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
            'Optional subdirectory within the agent workspace to run the command in (relative path, e.g. "src")',
        },
      },
      required: ['command'],
    },
    async execute(args, ctx) {
      const command = args['command'];
      const cwdArg = args['cwd'];

      if (typeof command !== 'string' || !command.trim()) {
        return {
          ok: false,
          error: 'command is required and must be a non-empty string',
        };
      }

      if (cwdArg !== undefined && typeof cwdArg !== 'string') {
        return { ok: false, error: 'cwd must be a string' };
      }

      // Blocklist check — surface as a proper error rather than letting it through
      const blocked = exec.checkCommand(command);
      if (blocked) {
        return { ok: false, error: `Command blocked: ${blocked}` };
      }

      // Resolve and sandbox the working directory
      const workspaceRoot = workspace.getWorkspacePath(ctx.agentId);
      await workspace.ensureWorkspace(ctx.agentId);

      let resolvedCwd: string;
      if (cwdArg) {
        resolvedCwd = resolve(workspaceRoot, cwdArg);
        const rel = relative(workspaceRoot, resolvedCwd);
        if (rel.startsWith('..') || rel.startsWith('/')) {
          return {
            ok: false,
            error: `cwd must be within the agent workspace (got: ${cwdArg})`,
          };
        }
      } else {
        resolvedCwd = workspaceRoot;
      }

      const result = await exec.run(command, resolvedCwd);

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
