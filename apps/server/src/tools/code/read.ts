import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';
import { codeReadMeta } from '../catalog.js';

/**
 * code_read
 *
 * Reads a file with `cat -n` style line numbers ("<n>\t<content>") so the
 * agent can reference specific lines in subsequent `code_edit` calls.
 *
 * Token efficiency wins over `workspace_read`:
 *   - `start_line`/`end_line` let the agent read a slice instead of the
 *     whole file (e.g. just the function it needs).
 *   - `max_lines` (default 500) caps output so a 5000-line file doesn't
 *     burn the context window — the response carries a truncation
 *     notice so the agent knows to re-read with a narrower range.
 */
export function createCodeReadTool(workspace: WorkspaceService): BuiltinTool {
  return {
    name: codeReadMeta.name,
    description: codeReadMeta.description,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file within the workspace',
        },
        start_line: {
          type: 'number',
          description:
            'First line to include (1-indexed, inclusive). Defaults to 1.',
        },
        end_line: {
          type: 'number',
          description:
            'Last line to include (1-indexed, inclusive). Defaults to the last line of the file.',
        },
        max_lines: {
          type: 'number',
          description:
            'Hard cap on the number of lines returned. Defaults to 500. Excess content is truncated with a notice.',
        },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      const filePath = args['path'];
      const startLine =
        typeof args['start_line'] === 'number' && args['start_line'] >= 1
          ? Math.floor(args['start_line'])
          : 1;
      const endLineArg = args['end_line'];
      const maxLines =
        typeof args['max_lines'] === 'number' && args['max_lines'] >= 1
          ? Math.floor(args['max_lines'])
          : 500;

      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'path is required and must be a string' };
      }

      let content: string;
      try {
        content = await workspace.readFile(ctx.agentId, filePath);
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const allLines = content.split('\n');
      // Drop the trailing empty element that split() leaves when the file
      // ends with a newline — it's not a real line.
      if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
        allLines.pop();
      }
      const totalLines = allLines.length;

      const endLine =
        typeof endLineArg === 'number' && endLineArg >= 1
          ? Math.min(Math.floor(endLineArg), totalLines)
          : totalLines;

      const rangeStart = Math.max(1, Math.min(startLine, totalLines));
      const rangeEnd = Math.max(rangeStart, endLine);
      const requested = rangeEnd - rangeStart + 1;
      const slice = allLines.slice(rangeStart - 1, rangeEnd);

      // Apply max_lines cap on top of the requested range so a wide range
      // still can't blow the context window.
      const truncated = slice.length > maxLines;
      const visible = truncated ? slice.slice(0, maxLines) : slice;

      const numbered = visible.map(
        (line, idx) => `${rangeStart + idx}\t${line}`,
      );
      const out: string[] = [];
      if (requested > visible.length) {
        out.push(
          `[truncated: showing lines ${rangeStart}-${rangeStart + visible.length - 1} of ${totalLines}]`,
        );
      }
      out.push(...numbered);
      return { ok: true, content: out.join('\n') };
    },
  };
}
