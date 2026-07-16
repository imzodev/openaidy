/**
 * Screenshot capture → workspace persistence
 *
 * MCP browser servers (e.g. `@playwright/mcp`) take screenshots but decide
 * *where* to save them at server-launch time — the tool call itself has no
 * lever to pick a directory, and the `filename` parameter is a basename only.
 * A single shared server therefore cannot know which agent's workspace a
 * screenshot belongs in.
 *
 * This module bridges that gap. It intercepts screenshot-style tool calls and
 * persists the returned image bytes into the calling agent's workspace under a
 * dedicated `screenshots/` folder, so screenshots always land somewhere the
 * agent can read them back.
 *
 * Why inline bytes rather than the on-disk file: Playwright returns the image
 * inline (`{ type: 'image', data: <base64> }`) only when no `filename` is
 * supplied. So {@link stripScreenshotFilename} removes `filename` from the
 * forwarded args to guarantee inline bytes, and we save under the requested
 * name ourselves. This is version-independent and never depends on the
 * server's (upstream-buggy) `--output-dir` flag or on reaching across
 * processes for a temp file. Trade-off: Playwright downscales inline images
 * above ~1568px / ~1.15 MP, so very large screenshots are stored at reduced
 * resolution.
 */

import type { WorkspaceService } from '../workspace/service';
import type { McpToolResult, McpTextContent } from './client';

/** Workspace-relative folder screenshots are saved into. */
export const SCREENSHOT_WORKSPACE_DIR = 'screenshots';

/**
 * Workspace-relative folder for inline images returned by non-screenshot
 * MCP tools (e.g. image generation) — persisted by the same mechanism.
 */
export const MEDIA_WORKSPACE_DIR = 'media';

/**
 * Extract inline image content items from an MCP tool result. Returns an
 * empty array when the result carries none — used to decide whether the
 * persistence step should run at all.
 */
export function extractInlineImages(
  result: McpToolResult | undefined,
): Array<{ type: 'image'; data: string; mimeType?: string }> {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content.filter(
    (c): c is { type: 'image'; data: string; mimeType?: string } =>
      c?.type === 'image' && typeof (c as { data?: unknown }).data === 'string',
  );
}

/** Minimal logger shape — matches the subset of FastifyBaseLogger we use. */
type Logger = { warn: (obj: unknown, msg?: string) => void };

/**
 * Whether a tool name looks like a screenshot capture tool. Matches
 * `@playwright/mcp`'s `browser_take_screenshot` and, generically, any tool
 * whose (un-prefixed) name contains "screenshot" — e.g. a Puppeteer MCP's
 * `puppeteer_screenshot`. The `serverId::` prefix, if present, is ignored.
 */
export function isScreenshotTool(toolName: string): boolean {
  const bare = toolName.includes('::')
    ? toolName.slice(toolName.indexOf('::') + 2)
    : toolName;
  return /screenshot/i.test(bare);
}

/**
 * Remove `filename` from screenshot tool args so the server returns the image
 * inline (Playwright omits inline image bytes when a filename is given).
 * Returns a shallow clone — the original args object (persisted as part of the
 * tool-call record) is left untouched — plus the requested filename so the
 * caller can reuse it when naming the workspace file.
 */
export function stripScreenshotFilename(args: Record<string, unknown>): {
  forwardedArgs: Record<string, unknown>;
  requestedFilename: string | undefined;
} {
  const requested =
    typeof args['filename'] === 'string'
      ? (args['filename'] as string)
      : undefined;
  if (requested === undefined) {
    return { forwardedArgs: args, requestedFilename: undefined };
  }
  const forwardedArgs = { ...args };
  delete forwardedArgs['filename'];
  return { forwardedArgs, requestedFilename: requested };
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const KNOWN_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/**
 * Derive a safe workspace filename for a saved screenshot.
 *
 * The stem comes from the model's requested name when given (basename only —
 * any directory component is stripped and unsafe characters replaced),
 * otherwise a timestamped default. The extension always reflects the actual
 * image bytes (from `mimeType`), so a `.jpg` image is never written into a
 * `.png` file even if the model asked for one. When a single request yields
 * multiple images, indexes past the first get a `-N` suffix to avoid
 * collisions.
 */
export function buildScreenshotFilename(options: {
  requestedFilename: string | undefined;
  mimeType: string | undefined;
  index: number;
  now: number;
}): string {
  const ext = (options.mimeType && EXT_BY_MIME[options.mimeType]) || 'png';

  let stem: string;
  if (options.requestedFilename) {
    // Basename only — strip any path components the model may have included.
    const raw = options.requestedFilename.split(/[\\/]/).pop() ?? '';
    const sanitized =
      raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'screenshot';
    // Drop a trailing known image extension so we can substitute the real one.
    const dot = sanitized.lastIndexOf('.');
    const providedExt = dot > 0 ? sanitized.slice(dot + 1).toLowerCase() : '';
    stem =
      dot > 0 && KNOWN_IMAGE_EXTS.has(providedExt)
        ? sanitized.slice(0, dot)
        : sanitized;
  } else {
    stem = `screenshot-${options.now}`;
  }

  const suffix = options.index > 0 ? `-${options.index}` : '';
  return `${stem}${suffix}.${ext}`;
}

export type PersistedImage = {
  /** Workspace-relative path (e.g. `screenshots/x.png`). */
  relativePath: string;
  /** Absolute on-disk path of the written file. */
  absolutePath: string;
  /** Mime type of the image bytes (defaults to image/png when unreported). */
  mimeType: string;
};

export type PersistScreenshotResult = {
  /** The tool result, augmented with a text note of where images were saved. */
  result: McpToolResult;
  /** Workspace-relative paths of saved screenshots (e.g. `screenshots/x.png`). */
  savedPaths: string[];
  /** Full details of each saved image, for attachment registration. */
  saved: PersistedImage[];
  /** Absolute path of the first saved screenshot, for tool-result metadata. */
  absolutePath?: string;
};

/**
 * Persist any inline image content in an MCP tool result into the agent's
 * workspace `screenshots/` folder, and append a text note reporting the saved
 * path(s) so the model learns where the file went.
 *
 * A no-op (returns the result unchanged) when the result carries no inline
 * image content — e.g. the server was configured with `imageResponses: omit`.
 */
export async function persistScreenshotImages(params: {
  result: McpToolResult;
  workspace: WorkspaceService;
  agentId: string;
  requestedFilename?: string | undefined;
  logger?: Logger | undefined;
  /**
   * Workspace-relative folder to save into. Defaults to the screenshots
   * folder; non-screenshot tool media goes to {@link MEDIA_WORKSPACE_DIR}.
   */
  targetDir?: string;
  /** Injectable clock for deterministic tests. Defaults to `Date.now()`. */
  now?: () => number;
}): Promise<PersistScreenshotResult> {
  const { result, workspace, agentId, requestedFilename, logger } = params;
  const targetDir = params.targetDir ?? SCREENSHOT_WORKSPACE_DIR;
  const nowMs = (params.now ?? (() => Date.now()))();

  const images = extractInlineImages(result);

  if (images.length === 0) {
    logger?.warn(
      { agentId },
      'Screenshot tool returned no inline image content to persist',
    );
    return { result, savedPaths: [], saved: [] };
  }

  const savedPaths: string[] = [];
  const saved: PersistedImage[] = [];
  let firstAbsolutePath: string | undefined;

  for (let i = 0; i < images.length; i++) {
    const image = images[i]!;
    const filename = buildScreenshotFilename({
      requestedFilename,
      mimeType: image.mimeType,
      index: i,
      now: nowMs,
    });
    const relativePath = `${targetDir}/${filename}`;
    const buffer = Buffer.from(image.data, 'base64');
    const absolutePath = await workspace.writeBinaryFile(
      agentId,
      relativePath,
      buffer,
    );
    savedPaths.push(relativePath);
    saved.push({
      relativePath,
      absolutePath,
      mimeType: image.mimeType ?? 'image/png',
    });
    if (i === 0) firstAbsolutePath = absolutePath;
  }

  const note: McpTextContent = {
    type: 'text',
    text: `${targetDir === SCREENSHOT_WORKSPACE_DIR ? 'Screenshot' : 'Image'} saved to workspace: ${savedPaths.join(', ')}`,
  };

  const augmented: McpToolResult = {
    ...result,
    content: [...(Array.isArray(result.content) ? result.content : []), note],
    ...(firstAbsolutePath ? { absolutePath: firstAbsolutePath } : {}),
  } as McpToolResult & { absolutePath?: string };

  return {
    result: augmented,
    savedPaths,
    saved,
    ...(firstAbsolutePath ? { absolutePath: firstAbsolutePath } : {}),
  };
}
