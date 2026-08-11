import { describe, it, expect, vi } from 'vitest';
import {
  createPypiReleaseDateLookup,
  createUvxEnvironmentRepairer,
  exclusiveUpperBound,
  looksLikeBrokenEnvironment,
  parseUvxPackage,
  type CommandRunner,
} from './uvx-repair';

const IMPORT_FAILURE = [
  'Traceback (most recent call last):',
  '  File "minimax_mcp/server.py", line 17, in <module>',
  '    from mcp.server.fastmcp import FastMCP',
  "ModuleNotFoundError: No module named 'mcp.server.fastmcp'",
].join('\n');

describe('parseUvxPackage', () => {
  it('reads the package from a documented uvx invocation', () => {
    expect(parseUvxPackage('uvx', ['minimax-coding-plan-mcp', '-y'])).toBe(
      'minimax-coding-plan-mcp',
    );
  });

  it('accepts uvx under a path or a Windows extension', () => {
    expect(parseUvxPackage('/usr/local/bin/uvx', ['pkg'])).toBe('pkg');
    expect(parseUvxPackage('C:\\tools\\uvx.exe', ['pkg'])).toBe('pkg');
  });

  it('strips a version or extra specifier', () => {
    expect(parseUvxPackage('uvx', ['pkg==1.2.3'])).toBe('pkg');
    expect(parseUvxPackage('uvx', ['pkg@latest'])).toBe('pkg');
    expect(parseUvxPackage('uvx', ['pkg[extra]'])).toBe('pkg');
  });

  it('returns null for a non-uvx command', () => {
    expect(parseUvxPackage('npx', ['-y', 'some-mcp'])).toBeNull();
    expect(parseUvxPackage('uv', ['tool', 'run', 'pkg'])).toBeNull();
  });

  it('declines to guess when a flag precedes the package', () => {
    // The value of an unknown flag is indistinguishable from a package name.
    expect(parseUvxPackage('uvx', ['--python', '3.12', 'pkg'])).toBeNull();
    expect(parseUvxPackage('uvx', [])).toBeNull();
  });
});

describe('looksLikeBrokenEnvironment', () => {
  it('recognises Python import failures', () => {
    expect(looksLikeBrokenEnvironment(IMPORT_FAILURE)).toBe(true);
    expect(looksLikeBrokenEnvironment('ImportError: bad magic')).toBe(true);
    expect(
      looksLikeBrokenEnvironment('cannot import name FastMCP from mcp.server'),
    ).toBe(true);
  });

  it('does not treat a configuration error as a broken environment', () => {
    expect(
      looksLikeBrokenEnvironment(
        'ValueError: MINIMAX_API_HOST environment variable is required',
      ),
    ).toBe(false);
    expect(looksLikeBrokenEnvironment('')).toBe(false);
  });
});

describe('exclusiveUpperBound', () => {
  it('returns the day after publication so the release stays available', () => {
    expect(exclusiveUpperBound('2026-02-10T18:04:11.123456Z')).toBe(
      '2026-02-11',
    );
  });

  it('rolls over month and year boundaries', () => {
    expect(exclusiveUpperBound('2025-12-31T23:59:00Z')).toBe('2026-01-01');
  });

  it('returns null for an unparseable date', () => {
    expect(exclusiveUpperBound('not-a-date')).toBeNull();
  });
});

describe('createPypiReleaseDateLookup', () => {
  it('reads the upload time of the latest release', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        urls: [{ upload_time_iso_8601: '2026-02-10T18:04:11.123456Z' }],
      }),
    );
    const lookup = createPypiReleaseDateLookup(fetchImpl as never);

    expect(await lookup('minimax-coding-plan-mcp')).toBe(
      '2026-02-10T18:04:11.123456Z',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pypi.org/pypi/minimax-coding-plan-mcp/json',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('returns null when the index is unreachable or the package is unknown', async () => {
    const failing = createPypiReleaseDateLookup((async () => {
      throw new Error('ENOTFOUND');
    }) as never);
    expect(await failing('pkg')).toBeNull();

    const notFound = createPypiReleaseDateLookup(
      (async () => new Response('', { status: 404 })) as never,
    );
    expect(await notFound('pkg')).toBeNull();
  });

  it('returns null when the release carries no upload time', async () => {
    const lookup = createPypiReleaseDateLookup((async () =>
      Response.json({ urls: [] })) as never);
    expect(await lookup('pkg')).toBeNull();
  });
});

describe('createUvxEnvironmentRepairer', () => {
  const okRunner = (): { run: CommandRunner; calls: string[][] } => {
    const calls: string[][] = [];
    const run: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      return { ok: true, stderr: '' };
    };
    return { run, calls };
  };

  it('rebuilds the environment as of the release date and reports success', async () => {
    const { run, calls } = okRunner();
    const repair = createUvxEnvironmentRepairer({
      run,
      lookupReleaseDate: async () => '2026-02-10T18:04:11Z',
    });

    const repaired = await repair({
      serverId: 'MiniMax',
      command: 'uvx',
      args: ['minimax-coding-plan-mcp', '-y'],
      stderr: IMPORT_FAILURE,
    });

    expect(repaired).toBe('2026-02-11');
    expect(calls).toEqual([
      [
        'uv',
        'tool',
        'install',
        '--force',
        '--exclude-newer',
        '2026-02-11',
        'minimax-coding-plan-mcp',
      ],
    ]);
  });

  it('does nothing for a non-uvx server', async () => {
    const { run, calls } = okRunner();
    const repair = createUvxEnvironmentRepairer({
      run,
      lookupReleaseDate: async () => '2026-02-10T18:04:11Z',
    });

    expect(
      await repair({
        serverId: 'playwright',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
        stderr: IMPORT_FAILURE,
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it('does nothing when the failure is a configuration error', async () => {
    const { run, calls } = okRunner();
    const repair = createUvxEnvironmentRepairer({
      run,
      lookupReleaseDate: async () => '2026-02-10T18:04:11Z',
    });

    expect(
      await repair({
        serverId: 'MiniMax',
        command: 'uvx',
        args: ['minimax-coding-plan-mcp', '-y'],
        stderr: 'ValueError: MINIMAX_API_KEY environment variable is required',
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reports failure without running uv when the release date is unknown', async () => {
    const { run, calls } = okRunner();
    const repair = createUvxEnvironmentRepairer({
      run,
      lookupReleaseDate: async () => null,
    });

    expect(
      await repair({
        serverId: 'MiniMax',
        command: 'uvx',
        args: ['pkg'],
        stderr: IMPORT_FAILURE,
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it('reports failure when the reinstall itself fails', async () => {
    const repair = createUvxEnvironmentRepairer({
      run: async () => ({ ok: false, stderr: 'no solution found' }),
      lookupReleaseDate: async () => '2026-02-10T18:04:11Z',
    });

    expect(
      await repair({
        serverId: 'MiniMax',
        command: 'uvx',
        args: ['pkg'],
        stderr: IMPORT_FAILURE,
      }),
    ).toBeNull();
  });
});
