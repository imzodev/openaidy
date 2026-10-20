/**
 * Streaming directory walk for backups.
 *
 * Yields one file at a time via `opendir`, so memory stays O(depth) no matter
 * how many files a workspace holds (a single `node_modules` can be hundreds of
 * thousands). Symlinks are skipped: following them could escape the section
 * root, and restoring them would let an archive plant links on import.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_HEAVY_FOLDER_NAMES } from '@openaidy/shared-types';

const HEAVY = new Set(BACKUP_HEAVY_FOLDER_NAMES);

export type WalkedFile = {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to the walk root, always `/`-separated. */
  relPath: string;
  size: number;
  /** True when the file sits inside a heavy folder (node_modules, .git, …). */
  heavy: boolean;
};

export type WalkOptions = {
  /** Skip heavy folders entirely instead of yielding their files. */
  skipHeavy?: boolean;
};

export async function* walkFiles(
  root: string,
  options: WalkOptions = {},
): AsyncGenerator<WalkedFile> {
  yield* walkDir(root, '', false, options);
}

async function* walkDir(
  absDir: string,
  relDir: string,
  inHeavy: boolean,
  options: WalkOptions,
): AsyncGenerator<WalkedFile> {
  let dir: fs.Dir;
  try {
    dir = await fs.promises.opendir(absDir);
  } catch {
    // Missing or unreadable — nothing to back up here.
    return;
  }
  for await (const entry of dir) {
    const absPath = path.join(absDir, entry.name);
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const heavy = inHeavy || HEAVY.has(entry.name);
      if (heavy && options.skipHeavy) continue;
      yield* walkDir(absPath, relPath, heavy, options);
    } else if (entry.isFile()) {
      let size: number;
      try {
        size = (await fs.promises.stat(absPath)).size;
      } catch {
        // Deleted between readdir and stat — skip.
        continue;
      }
      yield { absPath, relPath, size, heavy: inHeavy };
    }
  }
}

/** Total files/bytes under `root`, plus how many of those bytes are heavy. */
export async function measureDir(
  root: string,
): Promise<{ files: number; bytes: number; heavyBytes: number }> {
  let files = 0;
  let bytes = 0;
  let heavyBytes = 0;
  for await (const file of walkFiles(root)) {
    files += 1;
    bytes += file.size;
    if (file.heavy) heavyBytes += file.size;
  }
  return { files, bytes, heavyBytes };
}
