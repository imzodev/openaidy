import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Export + import a home with a 256 MB incompressible file under a 64 MB
 * heap, and require peak RSS to stay well under "baseline + that file". Any
 * regression to buffering an archive or an entry in memory (the old
 * adm-zip/toBuffer path) blows through the bound or the heap cap.
 */
describe('backup memory use', () => {
  it('stays flat regardless of backup size', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=64',
        '--import',
        'tsx',
        path.join(import.meta.dirname, 'memory-harness.ts'),
      ],
      {
        cwd: path.join(import.meta.dirname, '../..'),
        encoding: 'utf-8',
        env: {
          ...process.env,
          BACKUP_HARNESS_BIG_MB: '256',
          BACKUP_HARNESS_FILES: '5000',
          BACKUP_HARNESS_DB_MB: '32',
        },
      },
    );
    const line = run.stdout.split('\n').find((l) => l.startsWith('{'));
    expect(line, run.stderr).toBeTruthy();
    const result = JSON.parse(line!) as { ok: boolean; peakRssMb: number };
    expect(result.ok).toBe(true);
    // Measured ~200 MB (mostly tsx + fixture generation) for both a 80 MB
    // and an 800 MB backup.
    expect(result.peakRssMb).toBeLessThan(300);
  }, 180_000);
});
