import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WORKSPACE_URI_PREFIX,
  WorkspaceFileRefError,
  containsWorkspaceFileRef,
  resolveWorkspaceFileRefs,
} from './workspace-file-refs';
import { createWorkspaceService, type WorkspaceService } from '../workspace';

const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYEuJ8C4AAAAAElFTkSuQmCC';

describe('containsWorkspaceFileRef', () => {
  it('finds a top-level reference', () => {
    expect(
      containsWorkspaceFileRef({ image_source: 'workspace://a.jpg' }),
    ).toBe(true);
  });

  it('finds a reference nested in an object', () => {
    expect(
      containsWorkspaceFileRef({ opts: { file: 'workspace://a.jpg' } }),
    ).toBe(true);
  });

  it('finds a reference nested in an array', () => {
    expect(containsWorkspaceFileRef({ files: ['workspace://a.jpg'] })).toBe(
      true,
    );
  });

  it('returns false when nothing matches', () => {
    expect(
      containsWorkspaceFileRef({
        prompt: 'describe this',
        url: 'https://example.com/a.jpg',
      }),
    ).toBe(false);
  });

  it('does not match a bare path without the prefix', () => {
    expect(containsWorkspaceFileRef({ image_source: 'tickets/a.jpg' })).toBe(
      false,
    );
  });
});

describe('resolveWorkspaceFileRefs', () => {
  let baseDir: string;
  let workspace: WorkspaceService;
  const agentId = 'agent-1';

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'workspace-file-refs-test-'));
    workspace = createWorkspaceService({ baseDir });
    mkdirSync(join(baseDir, agentId, 'tickets'), { recursive: true });
    writeFileSync(
      join(baseDir, agentId, 'tickets', 'receipt.png'),
      Buffer.from(PNG_1PX_BASE64, 'base64'),
    );
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('replaces a workspace:// reference with a data: URI', async () => {
    const args = { image_source: `${WORKSPACE_URI_PREFIX}tickets/receipt.png` };
    const resolved = await resolveWorkspaceFileRefs(args, workspace, agentId);
    expect(resolved['image_source']).toBe(
      `data:image/png;base64,${PNG_1PX_BASE64}`,
    );
  });

  it('does not mutate the original arguments object', async () => {
    const args = { image_source: `${WORKSPACE_URI_PREFIX}tickets/receipt.png` };
    await resolveWorkspaceFileRefs(args, workspace, agentId);
    expect(args.image_source).toBe(
      `${WORKSPACE_URI_PREFIX}tickets/receipt.png`,
    );
  });

  it('resolves a reference nested in an object and an array', async () => {
    const args = {
      opts: { image_source: `${WORKSPACE_URI_PREFIX}tickets/receipt.png` },
      files: [`${WORKSPACE_URI_PREFIX}tickets/receipt.png`],
      prompt: 'describe this',
    };
    const resolved = (await resolveWorkspaceFileRefs(
      args,
      workspace,
      agentId,
    )) as typeof args;
    expect(resolved.opts.image_source).toContain('data:image/png;base64,');
    expect(resolved.files[0]).toContain('data:image/png;base64,');
    expect(resolved.prompt).toBe('describe this');
  });

  it('leaves non-workspace strings untouched', async () => {
    const args = {
      prompt: 'describe this',
      url: 'https://example.com/a.jpg',
    };
    const resolved = await resolveWorkspaceFileRefs(args, workspace, agentId);
    expect(resolved).toEqual(args);
  });

  it('throws WorkspaceFileRefError for a missing file', async () => {
    const args = { image_source: `${WORKSPACE_URI_PREFIX}tickets/missing.png` };
    await expect(
      resolveWorkspaceFileRefs(args, workspace, agentId),
    ).rejects.toThrow(WorkspaceFileRefError);
  });

  it('throws WorkspaceFileRefError for a path-traversal attempt', async () => {
    const args = { image_source: `${WORKSPACE_URI_PREFIX}../../etc/passwd` };
    await expect(
      resolveWorkspaceFileRefs(args, workspace, agentId),
    ).rejects.toThrow(WorkspaceFileRefError);
  });

  it('throws WorkspaceFileRefError for an oversized file', async () => {
    writeFileSync(
      join(baseDir, agentId, 'tickets', 'big.bin'),
      Buffer.alloc(101 * 1024 * 1024),
    );
    const args = { image_source: `${WORKSPACE_URI_PREFIX}tickets/big.bin` };
    await expect(
      resolveWorkspaceFileRefs(args, workspace, agentId),
    ).rejects.toThrow(WorkspaceFileRefError);
  });
});
