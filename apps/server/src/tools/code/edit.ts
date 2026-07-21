import type { BuiltinTool } from '@openaidy/runtime';
import type { WorkspaceService } from '../../workspace/service';
import { WorkspaceError } from '../../workspace/service';
import { codeEditMeta } from '../catalog.js';

interface EditOperation {
  old_text: string;
  new_text: string;
  global_replace?: boolean;
}

interface AppliedEdit {
  index: number;
  replacements: number;
  /** 1-indexed line number of the first match in the (post-prior-edits) file. */
  firstLine: number;
  oldLines: string[];
  newLines: string[];
}

const CONTEXT_LINES = 2;

/**
 * code_edit
 *
 * Apply one or more surgical edits to a single file in a single
 * read/write cycle. Each edit replaces an exact `old_text` substring
 * with `new_text`. By default an edit fails when `old_text` matches
 * more than once — the agent should narrow the context. Set
 * `global_replace: true` on a specific edit to opt into mass-rewriting
 * that occurrence.
 *
 * The response shows what actually changed for each edit (the old
 * block and the new block with line markers), so the agent can verify
 * the result without re-reading the file.
 *
 * Token economics: an N-edit refactor that used to take N round-trips
 * of `code_read` + `workspace_write` (each resending the whole file)
 * becomes a single call sending N patches — typically a 5–10x token
 * reduction on multi-edit tasks.
 */
export function createCodeEditTool(workspace: WorkspaceService): BuiltinTool {
  return {
    name: codeEditMeta.name,
    description: codeEditMeta.description,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file within the workspace',
        },
        edits: {
          type: 'array',
          description:
            'Edits to apply in order. Each edit operates on the file as modified by the previous edit, so later edits can target text introduced by earlier ones.',
          items: {
            type: 'object',
            properties: {
              old_text: {
                type: 'string',
                description:
                  'Exact substring to replace. Must match the file content verbatim, including whitespace and line endings.',
              },
              new_text: {
                type: 'string',
                description: 'Replacement text',
              },
              global_replace: {
                type: 'boolean',
                description:
                  'If true, replace every occurrence of old_text. Default false — the call fails when old_text is ambiguous so the agent can disambiguate.',
              },
            },
            required: ['old_text', 'new_text'],
          },
        },
      },
      required: ['path', 'edits'],
    },
    async execute(args, ctx) {
      const filePath = args['path'];
      const rawEdits = args['edits'];

      if (typeof filePath !== 'string' || !filePath) {
        return { ok: false, error: 'path is required and must be a string' };
      }
      if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
        return {
          ok: false,
          error:
            'edits must be a non-empty array of {old_text, new_text} pairs',
        };
      }

      // Validate and normalize edits up front so we fail fast on shape errors
      // before touching the filesystem.
      const edits: EditOperation[] = [];
      for (let i = 0; i < rawEdits.length; i++) {
        const raw = rawEdits[i] as Record<string, unknown> | undefined;
        if (!raw || typeof raw !== 'object') {
          return { ok: false, error: `edits[${i}] must be an object` };
        }
        const oldText = raw['old_text'];
        const newText = raw['new_text'];
        if (typeof oldText !== 'string') {
          return {
            ok: false,
            error: `edits[${i}].old_text is required and must be a string`,
          };
        }
        if (typeof newText !== 'string') {
          return {
            ok: false,
            error: `edits[${i}].new_text is required and must be a string`,
          };
        }
        if (oldText === '') {
          return {
            ok: false,
            error: `edits[${i}].old_text must not be empty (would match everywhere)`,
          };
        }
        edits.push({
          old_text: oldText,
          new_text: newText,
          global_replace: raw['global_replace'] === true,
        });
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

      // Apply each edit in order, validating before mutating. If any
      // edit fails the file is left untouched on disk (we only write
      // after the loop succeeds).
      const applied: AppliedEdit[] = [];
      let working = content;

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i]!;
        const indices = findAll(working, edit.old_text);
        if (indices.length === 0) {
          return {
            ok: false,
            error: `edits[${i}]: old_text not found in ${filePath}. Verify whitespace and line endings match exactly.`,
          };
        }
        if (indices.length > 1 && !edit.global_replace) {
          return {
            ok: false,
            error:
              `edits[${i}]: old_text matches ${indices.length} locations in ${filePath}.\n` +
              formatAmbiguityContext(working, indices, edit.old_text),
          };
        }

        const firstIdx = indices[0]!;
        const replaced = edit.global_replace
          ? working.split(edit.old_text).join(edit.new_text)
          : working.slice(0, firstIdx) +
            edit.new_text +
            working.slice(firstIdx + edit.old_text.length);

        applied.push({
          index: i,
          replacements: indices.length,
          firstLine: lineOf(working, firstIdx),
          oldLines: edit.old_text.split('\n'),
          newLines: edit.new_text.split('\n'),
        });
        working = replaced;
      }

      try {
        await workspace.writeFile(ctx.agentId, filePath, working);
      } catch (err) {
        if (err instanceof WorkspaceError) {
          return { ok: false, error: err.message };
        }
        return {
          ok: false,
          error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      return {
        ok: true,
        content: formatSummary(filePath, applied),
      };
    },
  };
}

function findAll(content: string, needle: string): number[] {
  const indices: number[] = [];
  let from = 0;
  while (from < content.length) {
    const idx = content.indexOf(needle, from);
    if (idx === -1) break;
    indices.push(idx);
    from = idx + needle.length;
  }
  return indices;
}

function lineOf(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Build a "Line 42 (context): ... - line - match - line - line" block for
 * each ambiguous match so the agent can see WHY old_text is not unique
 * and pick more context to disambiguate.
 */
function formatAmbiguityContext(
  content: string,
  indices: number[],
  needle: string,
): string {
  const lines = content.split('\n');
  const parts: string[] = [];
  for (const idx of indices) {
    const matchLine = lineOf(content, idx);
    const fromLine = Math.max(0, matchLine - 1 - CONTEXT_LINES);
    const toLine = Math.min(lines.length - 1, matchLine - 1 + CONTEXT_LINES);
    const block: string[] = [`  Line ${matchLine}:`];
    for (let i = fromLine; i <= toLine; i++) {
      const marker = i === matchLine - 1 ? '→' : ' ';
      block.push(
        `    ${marker} ${(i + 1).toString().padStart(4)}: ${lines[i]}`,
      );
    }
    parts.push(block.join('\n'));
  }
  parts.push(
    `Pass more surrounding context in old_text to make it unique, or set global_replace: true on this edit.`,
  );
  // Also include a short fingerprint of the match itself so the agent can
  // see the exact bytes ripgrep (or whatever) is matching against.
  const sample = needle.length > 60 ? needle.slice(0, 57) + '...' : needle;
  parts.push(`Match fingerprint: ${JSON.stringify(sample)}`);
  return parts.join('\n');
}

/**
 * Format the success response: a header plus one diff block per edit.
 * Each block uses `-` / `+` markers (like a unified diff but minimal) so
 * the agent can see exactly what bytes changed at each location.
 */
function formatSummary(filePath: string, applied: AppliedEdit[]): string {
  const total = applied.reduce((n, a) => n + a.replacements, 0);
  const header = `Edited ${filePath}: ${total} replacement${
    total === 1 ? '' : 's'
  } across ${applied.length} edit${applied.length === 1 ? '' : 's'}`;
  const blocks = applied.map((a) => formatEditBlock(a));
  return `${header}\n\n${blocks.join('\n\n')}`;
}

function formatEditBlock(a: AppliedEdit): string {
  const loc =
    a.replacements === 1
      ? `at line ${a.firstLine}`
      : `${a.replacements}× starting at line ${a.firstLine}`;
  const removed = a.oldLines.length;
  const added = a.newLines.length;
  const oldBlock = a.oldLines.map((l) => `- ${l}`).join('\n');
  const newBlock = a.newLines.map((l) => `+ ${l}`).join('\n');
  return `Edit ${a.index + 1} (${loc}, ${removed} → ${added} lines):\n${oldBlock}\n${newBlock}`;
}
