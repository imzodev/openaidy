/**
 * Memory harness for backups: builds a synthetic OPENAIDY_HOME, exports it,
 * imports the result into a second home, and prints peak RSS as JSON.
 *
 * Run under a small heap so a regression to whole-archive buffering fails
 * loudly instead of quietly using more RAM:
 *
 *   node --max-old-space-size=64 --import tsx src/backups/memory-harness.ts
 *
 * Sizes are tunable for manual runs: BACKUP_HARNESS_BIG_MB (one
 * incompressible file), BACKUP_HARNESS_FILES (small files inside a
 * node_modules tree), BACKUP_HARNESS_DB_MB (sqlite db).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { BackupService, type BackupPaths } from './service';

const bigMb = Number(process.env.BACKUP_HARNESS_BIG_MB ?? 64);
const smallFiles = Number(process.env.BACKUP_HARNESS_FILES ?? 5000);
const dbMb = Number(process.env.BACKUP_HARNESS_DB_MB ?? 16);

function homePaths(root: string): BackupPaths {
  return {
    dbPath: path.join(root, 'data', 'openaidy.db'),
    configPath: path.join(root, 'openaidy.json'),
    workspacesDir: path.join(root, 'workspaces'),
    skillsDir: path.join(root, 'skills'),
    addonsDir: path.join(root, 'addons'),
  };
}

const phase = (name: string) => {
  if (process.env.BACKUP_HARNESS_VERBOSE) {
    const m = process.memoryUsage();
    console.error(
      `[${name}] rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB`,
    );
  }
};

let peakRss = 0;
const sample = () => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
};
const sampler = setInterval(sample, 20);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-mem-'));
try {
  const src = homePaths(path.join(root, 'src'));
  const dst = homePaths(path.join(root, 'dst'));

  // Incompressible big file, written in 1 MB chunks.
  const big = path.join(src.workspacesDir, 'media', 'big.bin');
  fs.mkdirSync(path.dirname(big), { recursive: true });
  const fd = fs.openSync(big, 'w');
  for (let i = 0; i < bigMb; i++) fs.writeSync(fd, randomBytes(1024 * 1024));
  fs.closeSync(fd);

  // Lots of small files, the shape of a node_modules tree.
  for (let i = 0; i < smallFiles; i++) {
    const f = path.join(
      src.workspacesDir,
      'code',
      'node_modules',
      `pkg${i % 200}`,
      `file${i}.js`,
    );
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `module.exports = ${i};\n`.repeat(20));
  }

  // WAL-mode sqlite db.
  fs.mkdirSync(path.dirname(src.dbPath), { recursive: true });
  const db = new DatabaseSync(src.dbPath);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (b BLOB);');
  const insert = db.prepare('INSERT INTO t (b) VALUES (?)');
  for (let i = 0; i < dbMb * 16; i++) insert.run(randomBytes(64 * 1024));
  db.close();
  fs.writeFileSync(src.configPath, '{"providers":[]}');

  phase('fixtures ready');
  const started = Date.now();
  const service = new BackupService(src, 'harness');
  let lastPhase = '';
  const zipPath = path.join(root, 'backup.zip');
  await service.writeArchive({
    sections: [],
    includeHeavyFolders: true,
    destPath: zipPath,
    workDir: path.join(root, 'work'),
    onProgress: (p) => {
      if (p.phase !== lastPhase) phase((lastPhase = p.phase));
    },
  });
  phase('export done');
  const exportMs = Date.now() - started;

  const restored = new BackupService(dst, 'harness');
  const results = await restored.applyArchive(zipPath, [
    'db',
    'config',
    'workspaces',
  ]);
  sample();

  const ok =
    results.every((r) => r.success) &&
    fs.statSync(path.join(dst.workspacesDir, 'media', 'big.bin')).size ===
      bigMb * 1024 * 1024;

  console.log(
    JSON.stringify({
      ok,
      peakRssMb: Math.round(peakRss / (1024 * 1024)),
      zipMb: Math.round(fs.statSync(zipPath).size / (1024 * 1024)),
      exportMs,
      importMs: Date.now() - started - exportMs,
      results,
    }),
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  clearInterval(sampler);
  fs.rmSync(root, { recursive: true, force: true });
}
