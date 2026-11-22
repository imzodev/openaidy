import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAidyVersion } from './version';

function makeTree(files: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), 'aidy-version-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    if (content === null) {
      mkdirSync(fullPath, { recursive: true });
      continue;
    }
    mkdirSync(resolve(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }
  return root;
}

describe('resolveAidyVersion', () => {
  let root: string;

  afterEach(() => {
    if (root) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('returns the version from the nearest package.json walking up', () => {
    root = makeTree({
      'package.json': JSON.stringify({ name: 'aidy', version: '1.2.3' }),
      'apps/server/src/deep.txt': 'leaf',
    });
    const start = join(root, 'apps/server/src');
    expect(resolveAidyVersion(start)).toBe('1.2.3');
  });

  it('skips package.json files without a version field', () => {
    root = makeTree({
      'package.json': JSON.stringify({ name: 'aidy', version: '9.9.9' }),
      'apps/server/package.json': JSON.stringify({ name: '@aidyagent/server' }),
      'apps/server/src/server.ts': '// server',
    });
    const start = join(root, 'apps/server/src');
    expect(resolveAidyVersion(start)).toBe('9.9.9');
  });

  it('stops at the first package.json with a version (does not skip)', () => {
    root = makeTree({
      'package.json': JSON.stringify({ name: 'aidy', version: '2.0.0' }),
      'inner/package.json': JSON.stringify({ name: 'inner', version: '1.0.0' }),
    });
    const start = join(root, 'inner');
    expect(resolveAidyVersion(start)).toBe('1.0.0');
  });

  it('tolerates malformed package.json files and keeps walking', () => {
    root = makeTree({
      'package.json': JSON.stringify({ name: 'aidy', version: '4.5.6' }),
      'bad/package.json': '{not valid json',
      'bad/leaf.txt': 'x',
    });
    const start = join(root, 'bad');
    expect(resolveAidyVersion(start)).toBe('4.5.6');
  });

  it('falls back to "0.0.0" when no package.json with a version is found', () => {
    root = makeTree({
      'package.json': JSON.stringify({ name: 'no-version' }),
      'src/leaf.txt': 'x',
    });
    const start = join(root, 'src');
    expect(resolveAidyVersion(start)).toBe('0.0.0');
  });

  it('falls back to "0.0.0" when no package.json files exist at all', () => {
    root = makeTree({
      'a/b/c/leaf.txt': 'x',
    });
    const start = join(root, 'a/b/c');
    expect(resolveAidyVersion(start)).toBe('0.0.0');
  });
});
