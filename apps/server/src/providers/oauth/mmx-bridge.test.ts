import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
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
