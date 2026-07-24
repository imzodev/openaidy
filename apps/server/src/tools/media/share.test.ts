import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceService } from '../../workspace/service';
import { createMediaShareTool, createMediaTools } from './index';
import { MAX_TOOL_OUTPUT_BYTES } from '../../attachments/service';

const CTX = { agentId: 'test-agent', sessionId: 'test-session' };

describe('media tools', () => {
  let testBaseDir: string;
  let workspace: ReturnType<typeof createWorkspaceService>;

  beforeEach(async () => {
    testBaseDir = join(
      tmpdir(),
      `media-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testBaseDir, { recursive: true });
    workspace = createWorkspaceService({ baseDir: testBaseDir });
    await workspace.ensureWorkspace(CTX.agentId);
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  const writeFixture = (relPath: string, contents = 'x') =>
    workspace.writeFile(CTX.agentId, relPath, contents);

  describe('createMediaTools', () => {
    it('returns the media_share tool', () => {
      const tools = createMediaTools(workspace);
      expect(tools.map((t) => t.name)).toEqual(['media_share']);
    });
  });

  describe('media_share', () => {
    it('shares a video file and returns the media payload', async () => {
      await writeFixture('media/clip.mp4');
      const tool = createMediaShareTool(workspace);

      const result = await tool.execute({ path: 'media/clip.mp4' }, CTX);

      expect(result.ok).toBe(true);
      const ok = result as {
        ok: true;
        content: string;
        media: { absolutePath: string; mimeType: string; name: string };
      };
      expect(ok.content).toContain('clip.mp4');
      expect(ok.media.mimeType).toBe('video/mp4');
      expect(ok.media.name).toBe('clip.mp4');
      expect(ok.media.absolutePath).toBe(
        join(testBaseDir, CTX.agentId, 'media', 'clip.mp4'),
      );
    });

    it('detects image and audio kinds from the extension', async () => {
      await writeFixture('chart.png');
      await writeFixture('voice-note.mp3');
      const tool = createMediaShareTool(workspace);

      const image = (await tool.execute({ path: 'chart.png' }, CTX)) as {
        ok: true;
        content: string;
        media: { mimeType: string };
      };
      const audio = (await tool.execute({ path: 'voice-note.mp3' }, CTX)) as {
        ok: true;
        content: string;
        media: { mimeType: string };
      };

      expect(image.ok).toBe(true);
      expect(image.media.mimeType).toBe('image/png');
      expect(image.content).toContain('image');
      expect(audio.ok).toBe(true);
      expect(audio.media.mimeType).toBe('audio/mpeg');
      expect(audio.content).toContain('audio');
    });

    it('honors a custom display name', async () => {
      await writeFixture('media/clip.webm');
      const tool = createMediaShareTool(workspace);

      const result = (await tool.execute(
        { path: 'media/clip.webm', name: 'Demo reel' },
        CTX,
      )) as { ok: true; content: string; media: { name: string } };

      expect(result.ok).toBe(true);
      expect(result.media.name).toBe('Demo reel');
    });

    it('rejects a missing file', async () => {
      const tool = createMediaShareTool(workspace);

      const result = await tool.execute({ path: 'nope.mp4' }, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain(
        'File not found',
      );
    });

    it('rejects a directory path', async () => {
      await writeFixture('media/placeholder.txt'); // creates media/
      const tool = createMediaShareTool(workspace);

      const result = await tool.execute({ path: 'media' }, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain(
        'is not a file',
      );
    });

    it('rejects unsupported file types', async () => {
      await writeFixture('notes.txt');
      const tool = createMediaShareTool(workspace);

      const result = await tool.execute({ path: 'notes.txt' }, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain(
        'not a supported media file',
      );
    });

    it('rejects paths escaping the workspace', async () => {
      const tool = createMediaShareTool(workspace);

      const result = await tool.execute({ path: '../outside.mp4' }, CTX);

      expect(result.ok).toBe(false);
    });

    it('rejects files over the size cap', async () => {
      // Sparse file: reports the capped size without writing real bytes.
      const bigPath = join(testBaseDir, CTX.agentId, 'huge.mp4');
      const handle = await open(bigPath, 'w');
      await handle.truncate(MAX_TOOL_OUTPUT_BYTES + 1);
      await handle.close();
      const tool = createMediaShareTool(workspace);

      const result = await tool.execute({ path: 'huge.mp4' }, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain(
        'over the 100MB limit',
      );
    });

    it('requires a path argument', async () => {
      const tool = createMediaShareTool(workspace);

      const result = await tool.execute({}, CTX);

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain(
        'path is required',
      );
    });
  });
});
