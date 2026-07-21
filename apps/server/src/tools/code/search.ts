import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { runRipgrep, RipgrepNotFoundError } from './ripgrep.js';
import { codeSearchMeta } from '../catalog.js';

const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_CONTEXT_LINES = 0;

// Always exclude these regardless of caller intent — searching node_modules
// is almost never useful and burns time.
const DEFAULT_EXCLUDES = [
  '!node_modules',
  '!.git',
  '!dist',
  '!build',
  '!.next',
];

interface RgMatchEvent {
  type: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: Array<{ match: { text: string } }>;
  };
}

/**
 * code_search
 *
 * Recursive regex search backed by ripgrep (`rg --json`). Structured
 * JSON output means we get exact line numbers and matched ranges without
 * parsing rg's text format with regexes.
 *
 * The name intentionally avoids "grep" — ripgrep IS the search engine
 * here, and "grep" carries legacy Unix connotations that don't match
 * what the tool actually does.
 *
 * Output mirrors `rg -n` line by line: "<path>:<line>:<content>" for
 * matches, "<path>-<line>:<content>" for context lines. The `:` vs `-`
 * separator matches rg's convention so the agent can grep the output
 * with the same tool that produced it.
 */
export function createCodeSearchTool(workspace: WorkspaceService): BuiltinTool {
  return {
    name: codeSearchMeta.name,
    description: codeSearchMeta.description,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description:
            'Regular expression (ripgrep / Rust regex syntax). Use (?i) prefix for case-insensitive.',
        },
        path: {
          type: 'string',
          description:
            'Directory to search in, relative to workspace root. Defaults to "." (whole workspace).',
        },
        include: {
          type: 'string',
          description:
            'Optional ripgrep glob limiting which files are searched (e.g. "*.ts", "**/*.test.ts").',
        },
        exclude: {
          type: 'string',
          description:
            'Optional ripgrep glob excluding files from the search (e.g. "*.test.ts", "dist/**").',
        },
        context_lines: {
          type: 'number',
          description:
            'Number of lines to include before and after each match. Defaults to 0.',
        },
        max_results: {
          type: 'number',
          description:
            'Stop after this many matches across all files. Defaults to 100.',
        },
      },
      required: ['pattern'],
    },
    async execute(args, ctx) {
      const pattern = args['pattern'];
      const pathArg = typeof args['path'] === 'string' ? args['path'] : '.';
      const include =
        typeof args['include'] === 'string' ? args['include'] : undefined;
      const exclude =
        typeof args['exclude'] === 'string' ? args['exclude'] : undefined;
      const contextLines =
        typeof args['context_lines'] === 'number' && args['context_lines'] >= 0
          ? Math.floor(args['context_lines'])
          : DEFAULT_CONTEXT_LINES;
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
        '--json',
        '--no-config',
        '--no-messages',
        '--smart-case',
        ...DEFAULT_EXCLUDES.flatMap((g) => ['-g', g]),
      ];
      if (contextLines > 0) rgArgs.push('-C', String(contextLines));
      if (include) rgArgs.push('-g', include);
      if (exclude) rgArgs.push('-g', exclude);
      rgArgs.push('--', pattern, pathArg);

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

      // Exit 2 = real error. Exit 0 = matches found. Exit 1 = no matches.
      if (result.exitCode === 2) {
        return {
          ok: false,
          error: `ripgrep error: ${result.stderr.trim() || 'unknown error'}`,
        };
      }
      if (result.noMatches) {
        return {
          ok: true,
          content: `No matches for pattern "${pattern}"`,
        };
      }

      const matchedFiles = new Set<string>();
      const out: string[] = [];
      let hitCount = 0;

      for (const rawLine of result.stdout.split('\n')) {
        if (!rawLine) continue;
        let event: RgMatchEvent;
        try {
          event = JSON.parse(rawLine);
        } catch {
          continue;
        }
        if (event.type !== 'match' || !event.data) continue;

        const pathObj = event.data.path;
        const linesObj = event.data.lines;
        const lineNumber = event.data.line_number;
        if (!pathObj?.text || !linesObj?.text || lineNumber === undefined)
          continue;

        const relPath = pathObj.text;
        const lineText = linesObj.text.endsWith('\n')
          ? linesObj.text.slice(0, -1)
          : linesObj.text;
        matchedFiles.add(relPath);
        out.push(`${relPath}:${lineNumber}:${lineText}`);
        hitCount++;
        if (hitCount >= maxResults) break;
      }

      if (hitCount >= maxResults) {
        out.push(`[truncated at ${maxResults} matches — narrow the search]`);
      }

      const header = `${hitCount} match${hitCount === 1 ? '' : 'es'} across ${matchedFiles.size} file${matchedFiles.size === 1 ? '' : 's'}`;
      return { ok: true, content: `${header}\n${out.join('\n')}` };
    },
  };
}
