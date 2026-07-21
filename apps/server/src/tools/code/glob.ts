import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { runRipgrep, RipgrepNotFoundError } from './ripgrep.js';
import { codeGlobMeta } from '../catalog.js';

const DEFAULT_MAX_RESULTS = 1_000;

const DEFAULT_EXCLUDES = [
  '!node_modules',
  '!.git',
  '!dist',
  '!build',
  '!.next',
];

/**
 * code_glob
 *
 * Find files in the workspace using `rg --files`, the canonical fast
 * file listing. ripgrep is significantly faster than recursive readdir
 * + JS glob matching on large trees because it reads directories with
 * `getdents` and respects VCS ignore files out of the box.
 *
 * The `pattern` is forwarded as an rg `-g` glob. ripgrep glob syntax is
 * a superset of common shells: `*`, `**` (any path segments), `?`, and
 * brace expansion all work. For instance, the pattern `*.test.ts`
 * (with `**` prepended via include-style globbing) matches every test
 * file under any directory, and a `src/` prefix combined with the
 * double-star wildcard matches every index file under src.
 */
export function createCodeGlobTool(workspace: WorkspaceService): BuiltinTool {
  return {
    name: codeGlobMeta.name,
    description: codeGlobMeta.description,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'ripgrep glob pattern. Examples: "**/*.ts", "src/**/index.*", "*.json"',
        },
        path: {
          type: 'string',
          description:
            'Directory to search in, relative to workspace root. Defaults to "." (whole workspace).',
        },
        max_results: {
          type: 'number',
          description:
            'Cap on the number of matches returned. Defaults to 1000.',
        },
      },
      required: ['pattern'],
    },
    async execute(args, ctx) {
      const pattern = args['pattern'];
      const pathArg = typeof args['path'] === 'string' ? args['path'] : '.';
      const maxResults =
        typeof args['max_results'] === 'number' && args['max_results'] >= 1
          ? Math.floor(args['max_results'])
          : DEFAULT_MAX_RESULTS;

      if (typeof pattern !== 'string' || !pattern) {
        return {
          ok: false,
          error: 'pattern is required and must be a non-empty string',
        };
      }

      const workspaceRoot = workspace.getWorkspacePath(ctx.agentId);

      const rgArgs: string[] = [
        '--files',
        '--no-config',
        '--no-messages',
        ...DEFAULT_EXCLUDES.flatMap((g) => ['-g', g]),
        '-g',
        pattern,
        '--',
        pathArg,
      ];

      let result;
      try {
        result = await runRipgrep(rgArgs, { cwd: workspaceRoot });
      } catch (err) {
        if (err instanceof RipgrepNotFoundError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `ripgrep failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // rg --files exits 0 if files matched, 1 if none, 2 on real error.
      if (result.exitCode === 2) {
        return {
          ok: false,
          error: `ripgrep error: ${result.stderr.trim() || 'unknown error'}`,
        };
      }
      if (result.noMatches) {
        return {
          ok: true,
          content: `No files match pattern "${pattern}"`,
        };
      }

      const all = result.stdout.split('\n').filter((line) => line.length > 0);
      const matches = all.slice(0, maxResults);
      const truncated = all.length > maxResults;

      let out = matches.join('\n');
      if (truncated) {
        out += `\n[truncated at ${maxResults} of ${all.length} matches]`;
      }
      return { ok: true, content: out };
    },
  };
}
