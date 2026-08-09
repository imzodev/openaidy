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
import type { WorkspaceService } from '../workspace/service';

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
