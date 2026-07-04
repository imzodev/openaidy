import { describe, it, expect } from 'vitest';
import { shQuote, buildPtyCommand, buildSpawnArgs } from './cli-bridge';

/**
 * Unit tests for the shell-quoting used to build the command string
 * handed to `script -qec`. The command is re-parsed by a shell, so
 * tokens that contain spaces or metacharacters must survive intact —
 * this is what lets us invoke an absolute node path plus a bundled
 * script path (see mmx-bridge's resolveMmxInvocation).
 */

describe('shQuote', () => {
  it('wraps a plain token in single quotes', () => {
    expect(shQuote('mmx')).toBe(`'mmx'`);
  });

  it('preserves spaces so a path is passed as one argument', () => {
    expect(shQuote('/opt/Program Files/node')).toBe(
      `'/opt/Program Files/node'`,
    );
  });

  it('neutralizes shell metacharacters', () => {
    // Without quoting these would be interpreted by the shell.
    expect(shQuote('a;rm -rf b')).toBe(`'a;rm -rf b'`);
    expect(shQuote('$(whoami)')).toBe(`'$(whoami)'`);
    expect(shQuote('a b && c')).toBe(`'a b && c'`);
  });

  it("escapes an embedded single quote as '\\''", () => {
    // POSIX has no way to escape ' inside '...'; you close, emit an
    // escaped ', and reopen: it's -> 'it'\''s'
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('buildPtyCommand', () => {
  it('quotes every token including the binary', () => {
    expect(buildPtyCommand('mmx', ['auth', 'login', '--recommend'])).toBe(
      `'mmx' 'auth' 'login' '--recommend'`,
    );
  });

  it('keeps a spaced node path and script path as two separate args', () => {
    const cmd = buildPtyCommand('/usr/bin/node', [
      '/opt/my apps/mmx-cli/dist/mmx.mjs',
      'auth',
      'login',
    ]);
    expect(cmd).toBe(
      `'/usr/bin/node' '/opt/my apps/mmx-cli/dist/mmx.mjs' 'auth' 'login'`,
    );
  });

  it('handles an empty argv (just the binary)', () => {
    expect(buildPtyCommand('mmx', [])).toBe(`'mmx'`);
  });
});

describe('buildSpawnArgs', () => {
  const argv = [
    '/opt/mmx-cli/dist/mmx.mjs',
    'auth',
    'login',
    '--region=global',
  ];

  it('wraps the CLI in a `script` PTY on Linux', () => {
    const { file, args } = buildSpawnArgs('/usr/bin/node', argv, 'linux');
    expect(file).toBe('script');
    expect(args[0]).toBe('-qec');
    expect(args[2]).toBe('/dev/null');
    // The command is the shell-quoted single string.
    expect(args[1]).toBe(buildPtyCommand('/usr/bin/node', argv));
  });

  it('wraps the CLI in a BSD `script` PTY on macOS (command as argv, not `-qec`)', () => {
    const { file, args } = buildSpawnArgs('/usr/bin/node', argv, 'darwin');
    expect(file).toBe('script');
    // BSD `script` (macOS) has no -c/-e: the command is trailing argv
    // after the typescript file, run directly with no shell re-parse.
    expect(args).toEqual(['-q', '/dev/null', '/usr/bin/node', ...argv]);
    // Regression guard: the util-linux `-qec` string form errors out on
    // macOS with "illegal option" before the CLI ever runs.
    expect(args).not.toContain('-qec');
    expect(args).not.toContain(buildPtyCommand('/usr/bin/node', argv));
  });

  it('spawns the CLI directly on Windows (no `script`, no /dev/null)', () => {
    const { file, args } = buildSpawnArgs('C:\\node\\node.exe', argv, 'win32');
    // Regression guard: Windows has no script(1) — spawning it would
    // ENOENT and turn a clean flow into a confusing error.
    expect(file).toBe('C:\\node\\node.exe');
    expect(file).not.toBe('script');
    // argv is passed straight through (spawn quotes natively on Windows).
    expect(args).toEqual(argv);
    expect(args).not.toContain('/dev/null');
  });

  it('does not shell-quote on Windows, preserving spaced paths as one arg', () => {
    const { args } = buildSpawnArgs(
      'C:\\Program Files\\node\\node.exe',
      ['C:\\my apps\\mmx.mjs', 'auth'],
      'win32',
    );
    expect(args).toEqual(['C:\\my apps\\mmx.mjs', 'auth']);
  });
});
