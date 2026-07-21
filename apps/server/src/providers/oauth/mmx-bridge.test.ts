import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { resolveMmxInvocation, isMmxInstalled } from './mmx-bridge';
import { buildPtyCommand } from './cli-bridge';

/**
 * Tests for the plug-and-play mmx resolution.
 *
 * `mmx-cli` is a declared dependency of `apps/server`, so `pnpm install`
 * ships it into node_modules. These tests assert we invoke that bundled
 * copy directly rather than a bare `mmx` on PATH (which pnpm never
 * installs there — the regression this guards against).
 *
 * NOTE: unlike minimax.test.ts, this file does NOT mock mmx-bridge — it
 * exercises the real resolution against the installed dependency.
 */

describe('resolveMmxInvocation', () => {
  it('resolves the bundled mmx-cli instead of a bare PATH binary', () => {
    const inv = resolveMmxInvocation();

    // The whole point: not a bare `mmx` that relies on a global install.
    expect(inv.binary).not.toBe('mmx');
    // We run the bundled script with the current node executable.
    expect(inv.binary).toBe(process.execPath);
  });

  it('points at an mmx.mjs script that actually exists on disk', () => {
    const inv = resolveMmxInvocation();

    expect(inv.prefixArgs).toHaveLength(1);
    const scriptPath = inv.prefixArgs[0]!;
    expect(scriptPath.endsWith('mmx.mjs')).toBe(true);
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('derives the entry from the package `bin` field, not a hardcoded path', () => {
    // Guards against reverting to a hardcoded `dist/mmx.mjs`: the resolved
    // script must match whatever mmx-cli declares in its own `bin`, so a
    // future entry relocation is followed instead of silently missed.
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('mmx-cli/package.json');
    const pkg = require(pkgJsonPath) as {
      bin?: string | Record<string, string>;
    };
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['mmx'];
    expect(binRel).toBeTruthy();
    const expected = join(dirname(pkgJsonPath), binRel!);

    const inv = resolveMmxInvocation();
    expect(inv.prefixArgs[0]).toBe(expected);
  });

  it('produces a shell command referencing node and the bundled script', () => {
    const inv = resolveMmxInvocation();
    const cmd = buildPtyCommand(inv.binary, [
      ...inv.prefixArgs,
      'auth',
      'login',
      '--recommend',
    ]);

    // Both paths are single-quoted (space-safe) and the mmx entry is present.
    expect(cmd).toContain(`'${process.execPath}'`);
    expect(cmd).toContain(`mmx.mjs'`);
    expect(cmd).toContain(`'auth' 'login' '--recommend'`);
  });
});

describe('isMmxInstalled', () => {
  it('reports true when the bundled copy is present (no PATH probe needed)', async () => {
    // The bundled dependency is present in this workspace, so this must
    // resolve true without depending on a global `mmx` being installed.
    await expect(isMmxInstalled()).resolves.toBe(true);
  });
});
