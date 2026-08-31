/**
 * Workspace file references → resolved bytes for outbound MCP tool calls
 *
 * Third-party MCP tools (e.g. a vision-analysis tool) run as separate
 * processes with no knowledge of an agent's workspace directory — they can
 * only accept an http(s) URL, a base64 `data:` URI, or a path resolvable on
 * their OWN filesystem/cwd. OpenAidy's workspace tools deliberately never
 * expose the real absolute path to the agent (sandbox boundary), so an agent
 * has no path it could hand such a tool that would ever resolve.
 *
 * This module bridges that gap in the opposite direction from
 * `screenshot-capture.ts` (which persists an MCP tool's *output* bytes into
 * the workspace): before an external MCP tool call is forwarded, any string
 * argument value of the form `workspace://<relative-path>` is resolved
 * server-side — through the same `validatePath` guard every other workspace
 * operation uses (via `WorkspaceService.readRawFile`) — and replaced with a
 * `data:<mime>;base64,<bytes>` URI.
 *
 * The substitution happens only on the copy of the arguments actually sent to
 * the tool. The original tool-call record (and therefore conversation
 * history) keeps the short `workspace://...` reference, never the encoded
 * bytes — so this never bloats context regardless of file size, unlike
 * having the model itself relay base64 through its own generated text.
 */

import { MAX_TOOL_OUTPUT_BYTES } from '../attachments/service';
import { WorkspaceError, type WorkspaceService } from '../workspace/service';

/** Prefix identifying a workspace-relative file reference in a tool argument. */
export const WORKSPACE_URI_PREFIX = 'workspace://';

/**
 * Thrown when a `workspace://` reference can't be resolved (missing file,
 * path traversal, oversized). Callers should convert this into a normal
 * tool-call error result rather than letting it propagate as a crash.
 */
export class WorkspaceFileRefError extends Error {
  constructor(
    message: string,
    public readonly ref: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'WorkspaceFileRefError';
  }
}

function isWorkspaceRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(WORKSPACE_URI_PREFIX);
}

/**
 * Cheap recursive scan for any `workspace://` reference in a tool-call
 * arguments value, so the (async, filesystem-touching) resolution pass can be
 * skipped entirely for the common case of no reference.
 */
export function containsWorkspaceFileRef(value: unknown): boolean {
  if (isWorkspaceRef(value)) return true;
  if (Array.isArray(value)) return value.some(containsWorkspaceFileRef);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(
      containsWorkspaceFileRef,
    );
  }
  return false;
}

/**
 * Heuristic: does this string look like a bare workspace-relative path the
 * model might have intended to pass as a `workspace://...` reference?
 *
 * Conservative on purpose — false positives fall through to the MCP tool
 * unchanged because the resolution attempt fails with `FILE_NOT_FOUND`.
 * True positives rescue the call when the model forgets the `workspace://`
 * prefix (a documented prompt instruction that is easy to skip under tool
 * pressure). Real session evidence of this failure:
 * `-iR-szP6VPtcGlTkb4GSw`, where the agent passed
 * `image_source: "screenshots/outbid-leaderboard-2026-08-30T18-18-22.png"`
 * to a vision MCP tool and got a confusing "file does not exist".
 *
 * Requirements (all of):
 *  - non-empty, ≤ 1024 chars
 *  - no whitespace / control characters (file paths don't have them;
 *    phrases like "see tickets/x.png" intentionally don't match)
 *  - no URL scheme (`://` anywhere)
 *  - not absolute (no leading `/` or `\`, no Windows drive letter)
 *  - contains at least one path separator (`/` or `\`)
 */
function isBareWorkspaceRelativeRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 1024) return false;
  if (/[\s\r\n\t\0]/.test(value)) return false;
  if (value.includes('://')) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (!value.includes('/') && !value.includes('\\')) return false;
  return true;
}

/**
 * Cheap recursive scan for any string that matches the
 * {@link isBareWorkspaceRelativeRef} heuristic — a separate detector from
 * {@link containsWorkspaceFileRef} so callers can choose strict-only or
 * loose-aware behaviour.
 */
export function containsWorkspaceRelativeRef(value: unknown): boolean {
  if (isBareWorkspaceRelativeRef(value)) return true;
  if (Array.isArray(value)) return value.some(containsWorkspaceRelativeRef);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(
      containsWorkspaceRelativeRef,
    );
  }
  return false;
}

/** Recursively resolve `workspace://` strings within an arbitrary JSON value. */
async function resolveValue(
  value: unknown,
  workspace: WorkspaceService,
  agentId: string,
): Promise<unknown> {
  if (isWorkspaceRef(value)) {
    const relPath = value.slice(WORKSPACE_URI_PREFIX.length);
    try {
      const { buffer, mimeType } = await workspace.readRawFile(
        agentId,
        relPath,
        { maxBytes: MAX_TOOL_OUTPUT_BYTES },
      );
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (err) {
      throw new WorkspaceFileRefError(
        `Failed to resolve ${value}: ${err instanceof Error ? err.message : String(err)}`,
        value,
        err instanceof Error ? err : undefined,
      );
    }
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => resolveValue(v, workspace, agentId)));
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([k, v]) =>
          [k, await resolveValue(v, workspace, agentId)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Best-effort resolver for bare workspace-relative paths. Mirrors
 * {@link resolveWorkspaceFileRefs} but, for any string matching the
 * {@link isBareWorkspaceRelativeRef} heuristic, attempts a `readRawFile`
 * and substitutes a `data:` URI on success — leaving the original string
 * alone on `FILE_NOT_FOUND` or `NOT_A_FILE` so the MCP tool still sees the
 * argument the model wrote (in case the bare path was intentional, e.g.
 * a URL that happens to look path-shaped). `PATH_TRAVERSAL_BLOCKED` and
 * `FILE_TOO_LARGE` propagate — those are real signals, not guesses.
 *
 * Returns the resolved args plus the list of bare paths that were
 * successfully substituted, so callers can log a warning. The set is
 * intentionally observable: a populated `rescued` array means a model
 * skipped the `workspace://` prefix the system prompt asks for.
 */
export async function tryResolveWorkspaceRelativeRefs(
  args: Record<string, unknown>,
  workspace: WorkspaceService,
  agentId: string,
): Promise<{ args: Record<string, unknown>; rescued: string[] }> {
  const rescued: string[] = [];

  const walk = async (value: unknown): Promise<unknown> => {
    if (isBareWorkspaceRelativeRef(value)) {
      try {
        const { buffer, mimeType } = await workspace.readRawFile(
          agentId,
          value,
          { maxBytes: MAX_TOOL_OUTPUT_BYTES },
        );
        rescued.push(value);
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
      } catch (err) {
        if (
          err instanceof WorkspaceError &&
          (err.code === 'FILE_NOT_FOUND' || err.code === 'NOT_A_FILE')
        ) {
          return value;
        }
        throw err;
      }
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map(walk));
    }
    if (value && typeof value === 'object') {
      const entries = await Promise.all(
        Object.entries(value as Record<string, unknown>).map(
          async ([k, v]) => [k, await walk(v)] as const,
        ),
      );
      return Object.fromEntries(entries);
    }
    return value;
  };

  const resolved = (await walk(args)) as Record<string, unknown>;
  return { args: resolved, rescued };
}

/**
 * Deep-clones `args`, replacing every `workspace://<path>` string with a
 * `data:<mime>;base64,<bytes>` URI read from the agent's workspace. The input
 * object is never mutated — callers must keep using the original for
 * anything that gets persisted (e.g. the tool-call record).
 *
 * Throws {@link WorkspaceFileRefError} on the first unresolvable reference
 * (missing file, path traversal, oversized).
 */
export async function resolveWorkspaceFileRefs(
  args: Record<string, unknown>,
  workspace: WorkspaceService,
  agentId: string,
): Promise<Record<string, unknown>> {
  return resolveValue(args, workspace, agentId) as Promise<
    Record<string, unknown>
  >;
}
