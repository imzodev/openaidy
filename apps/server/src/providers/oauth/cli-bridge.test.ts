import { describe, it, expect } from 'vitest';
import { shQuote, buildPtyCommand } from './cli-bridge';

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
