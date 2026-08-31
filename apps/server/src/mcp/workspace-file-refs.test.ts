import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WORKSPACE_URI_PREFIX,
  WorkspaceFileRefError,
  containsWorkspaceFileRef,
  containsWorkspaceRelativeRef,
  resolveWorkspaceFileRefs,
  tryResolveWorkspaceRelativeRefs,
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

describe('containsWorkspaceRelativeRef', () => {
  it('matches a bare workspace-relative path in a top-level field', () => {
    expect(
      containsWorkspaceRelativeRef({ image_source: 'tickets/a.jpg' }),
    ).toBe(true);
  });

  it('matches nested in an object and an array', () => {
    expect(
      containsWorkspaceRelativeRef({
        opts: { file: 'screenshots/foo.png' },
        files: ['tmp/x.txt'],
      }),
    ).toBe(true);
  });

  it('ignores explicit workspace:// references (those go through the strict path)', () => {
    expect(
      containsWorkspaceRelativeRef({
        image_source: 'workspace://tickets/a.jpg',
      }),
    ).toBe(false);
  });

  it('ignores URLs (any scheme)', () => {
    expect(
      containsWorkspaceRelativeRef({
        url: 'https://example.com/a.jpg',
      }),
    ).toBe(false);
  });

  it('ignores absolute paths', () => {
    expect(
      containsWorkspaceRelativeRef({
        path: '/etc/passwd',
        win: 'C:\\Windows\\System32',
      }),
    ).toBe(false);
  });

  it('ignores strings with whitespace (those are phrases, not paths)', () => {
    expect(
      containsWorkspaceRelativeRef({
        prompt: 'see tickets/a.jpg for context',
      }),
    ).toBe(false);
  });

  it('ignores single tokens without a path separator', () => {
    expect(containsWorkspaceRelativeRef({ choice: 'yes', toggle: 'on' })).toBe(
      false,
    );
  });

  it('ignores empty / oversized strings', () => {
    expect(containsWorkspaceRelativeRef({ path: '' })).toBe(false);
    expect(containsWorkspaceRelativeRef({ path: 'a'.repeat(1025) })).toBe(
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

describe('tryResolveWorkspaceRelativeRefs', () => {
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

  it('resolves a bare workspace-relative path to a data: URI and reports it as rescued', async () => {
    // The canonical failure mode this defends against: the model skips the
    // `workspace://` prefix in a tool arg (e.g.
    // `image_source: "screenshots/outbid-leaderboard-2026-08-30T18-18-22.png"`),
    // and the MCP tool — running in its own process with no knowledge of the
    // workspace root — can't open the file. We rescue it.
    const args = { image_source: 'tickets/receipt.png' };
    const { args: resolved, rescued } = await tryResolveWorkspaceRelativeRefs(
      args,
      workspace,
      agentId,
    );
    expect(resolved['image_source']).toBe(
      `data:image/png;base64,${PNG_1PX_BASE64}`,
    );
    expect(rescued).toEqual(['tickets/receipt.png']);
  });

  it('leaves non-existent paths alone so the MCP tool sees what the model wrote', async () => {
    const args = { image_source: 'tickets/missing.png' };
    const { args: resolved, rescued } = await tryResolveWorkspaceRelativeRefs(
      args,
      workspace,
      agentId,
    );
    expect(resolved).toEqual(args);
    expect(rescued).toEqual([]);
  });

  it('leaves directory paths alone (NOT_A_FILE)', async () => {
    const args = { image_source: 'tickets' };
    const { args: resolved, rescued } = await tryResolveWorkspaceRelativeRefs(
      args,
      workspace,
      agentId,
    );
    expect(resolved).toEqual(args);
    expect(rescued).toEqual([]);
  });

  it('does not mutate the original arguments object', async () => {
    const args = { image_source: 'tickets/receipt.png' };
    await tryResolveWorkspaceRelativeRefs(args, workspace, agentId);
    expect(args['image_source']).toBe('tickets/receipt.png');
  });

  it('leaves phrases with whitespace alone (heuristic gates on no-whitespace)', async () => {
    const args = { prompt: 'see tickets/receipt.png for context' };
    const { args: resolved, rescued } = await tryResolveWorkspaceRelativeRefs(
      args,
      workspace,
      agentId,
    );
    expect(resolved).toEqual(args);
    expect(rescued).toEqual([]);
  });

  it('propagates path-traversal errors (security signal, not a guess)', async () => {
    const args = { image_source: '../../etc/passwd' };
    await expect(
      tryResolveWorkspaceRelativeRefs(args, workspace, agentId),
    ).rejects.toThrow();
  });

  it('propagates oversized-file errors (size semantics are not a guess)', async () => {
    writeFileSync(
      join(baseDir, agentId, 'tickets', 'big.bin'),
      Buffer.alloc(101 * 1024 * 1024),
    );
    const args = { image_source: 'tickets/big.bin' };
    await expect(
      tryResolveWorkspaceRelativeRefs(args, workspace, agentId),
    ).rejects.toThrow();
  });

  it('handles a mix of resolvable, non-resolvable, and non-path strings', async () => {
    const args = {
      image_source: 'tickets/receipt.png',
      fallback: 'tickets/missing.png',
      prompt: 'describe what you see',
      url: 'https://example.com/a.jpg',
    };
    const { args: resolved, rescued } = await tryResolveWorkspaceRelativeRefs(
      args,
      workspace,
      agentId,
    );
    expect(resolved['image_source']).toContain('data:image/png;base64,');
    expect(resolved['fallback']).toBe('tickets/missing.png');
    expect(resolved['prompt']).toBe('describe what you see');
    expect(resolved['url']).toBe('https://example.com/a.jpg');
    expect(rescued).toEqual(['tickets/receipt.png']);
  });
});
