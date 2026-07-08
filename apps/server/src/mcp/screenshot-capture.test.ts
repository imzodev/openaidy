import { describe, it, expect, vi } from 'vitest';
import {
  isScreenshotTool,
  stripScreenshotFilename,
  buildScreenshotFilename,
  persistScreenshotImages,
  SCREENSHOT_WORKSPACE_DIR,
} from './screenshot-capture';
import type { WorkspaceService } from '../workspace/service';
import type { McpToolResult } from './client';

/** A minimal WorkspaceService stub that records binary writes. */
function fakeWorkspace() {
  const writes: Array<{ agentId: string; path: string; bytes: number }> = [];
  const workspace = {
    writeBinaryFile: vi.fn(
      async (agentId: string, path: string, data: Buffer) => {
        writes.push({ agentId, path, bytes: data.length });
        return `/abs/${agentId}/${path}`;
      },
    ),
  } as unknown as WorkspaceService;
  return { workspace, writes };
}

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYEuJ8C4AAAAAElFTkSuQmCC';

describe('isScreenshotTool', () => {
  it('matches playwright and puppeteer screenshot tools', () => {
    expect(isScreenshotTool('browser_take_screenshot')).toBe(true);
    expect(isScreenshotTool('puppeteer_screenshot')).toBe(true);
    expect(isScreenshotTool('Take_Screenshot')).toBe(true);
  });

  it('ignores the serverId:: prefix', () => {
    expect(isScreenshotTool('playwright::browser_take_screenshot')).toBe(true);
  });

  it('does not match unrelated tools', () => {
    expect(isScreenshotTool('browser_navigate')).toBe(false);
    expect(isScreenshotTool('playwright::browser_click')).toBe(false);
  });
});

describe('stripScreenshotFilename', () => {
  it('removes filename and returns it, without mutating the original', () => {
    const args = { filename: 'shot.png', fullPage: true };
    const { forwardedArgs, requestedFilename } = stripScreenshotFilename(args);
    expect(requestedFilename).toBe('shot.png');
    expect(forwardedArgs).toEqual({ fullPage: true });
    // Original left intact (it is persisted as part of the tool-call record).
    expect(args).toEqual({ filename: 'shot.png', fullPage: true });
  });

  it('is a no-op when no filename is present', () => {
    const args = { fullPage: true };
    const { forwardedArgs, requestedFilename } = stripScreenshotFilename(args);
    expect(requestedFilename).toBeUndefined();
    expect(forwardedArgs).toBe(args);
  });
});

describe('buildScreenshotFilename', () => {
  it('uses a timestamped default when no name is requested', () => {
    expect(
      buildScreenshotFilename({
        requestedFilename: undefined,
        mimeType: 'image/png',
        index: 0,
        now: 1234,
      }),
    ).toBe('screenshot-1234.png');
  });

  it('derives extension from the mime type', () => {
    expect(
      buildScreenshotFilename({
        requestedFilename: undefined,
        mimeType: 'image/jpeg',
        index: 0,
        now: 1,
      }),
    ).toBe('screenshot-1.jpg');
  });

  it('keeps a requested name with a known extension', () => {
    expect(
      buildScreenshotFilename({
        requestedFilename: 'homepage.png',
        mimeType: 'image/png',
        index: 0,
        now: 1,
      }),
    ).toBe('homepage.png');
  });

  it('appends an extension when the requested name lacks one', () => {
    expect(
      buildScreenshotFilename({
        requestedFilename: 'homepage',
        mimeType: 'image/png',
        index: 0,
        now: 1,
      }),
    ).toBe('homepage.png');
  });

  it('strips path components and unsafe characters (traversal-safe)', () => {
    expect(
      buildScreenshotFilename({
        requestedFilename: '../../etc/pa ss.png',
        mimeType: 'image/png',
        index: 0,
        now: 1,
      }),
    ).toBe('pa_ss.png');
  });

  it('suffixes indexes past the first before the extension', () => {
    expect(
      buildScreenshotFilename({
        requestedFilename: 'shot.png',
        mimeType: 'image/png',
        index: 2,
        now: 1,
      }),
    ).toBe('shot-2.png');
  });
});

describe('persistScreenshotImages', () => {
  const baseResult: McpToolResult = {
    content: [
      { type: 'text', text: '### Result\n- [Screenshot](page-1.png)' },
      { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
    ],
  };

  it('writes the image into the workspace screenshots folder', async () => {
    const { workspace, writes } = fakeWorkspace();
    const { savedPaths, absolutePath, result } = await persistScreenshotImages({
      result: baseResult,
      workspace,
      agentId: 'agent-1',
      requestedFilename: 'homepage.png',
      now: () => 999,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe(`${SCREENSHOT_WORKSPACE_DIR}/homepage.png`);
    expect(writes[0]!.agentId).toBe('agent-1');
    expect(writes[0]!.bytes).toBeGreaterThan(0);
    expect(savedPaths).toEqual([`${SCREENSHOT_WORKSPACE_DIR}/homepage.png`]);
    expect(absolutePath).toBe('/abs/agent-1/screenshots/homepage.png');

    // Result is augmented with a note so the model learns the saved path.
    const note = (result.content as Array<{ type: string; text?: string }>).at(
      -1,
    );
    expect(note?.type).toBe('text');
    expect(note?.text).toContain('screenshots/homepage.png');
  });

  it('generates a timestamped name when none is requested', async () => {
    const { workspace, writes } = fakeWorkspace();
    await persistScreenshotImages({
      result: baseResult,
      workspace,
      agentId: 'a',
      now: () => 42,
    });
    expect(writes[0]!.path).toBe(
      `${SCREENSHOT_WORKSPACE_DIR}/screenshot-42.png`,
    );
  });

  it('handles multiple images with suffixed names', async () => {
    const { workspace, writes } = fakeWorkspace();
    const multi: McpToolResult = {
      content: [
        { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
        { type: 'image', data: PNG_1PX, mimeType: 'image/jpeg' },
      ],
    };
    const { savedPaths } = await persistScreenshotImages({
      result: multi,
      workspace,
      agentId: 'a',
      requestedFilename: 'shot.png',
      now: () => 1,
    });
    expect(savedPaths).toEqual([
      `${SCREENSHOT_WORKSPACE_DIR}/shot.png`,
      `${SCREENSHOT_WORKSPACE_DIR}/shot-1.jpg`,
    ]);
    expect(writes).toHaveLength(2);
  });

  it('is a no-op when the result has no image content', async () => {
    const { workspace, writes } = fakeWorkspace();
    const textOnly: McpToolResult = {
      content: [{ type: 'text', text: 'no image here' }],
    };
    const out = await persistScreenshotImages({
      result: textOnly,
      workspace,
      agentId: 'a',
      now: () => 1,
    });
    expect(writes).toHaveLength(0);
    expect(out.savedPaths).toEqual([]);
    expect(out.result).toBe(textOnly);
  });
});
