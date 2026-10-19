import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import type { BackupSection } from '@openaidy/shared-types';
import { BackupService, type BackupPaths } from './service';

let home: string;
let paths: BackupPaths;
let service: BackupService;
let work: string;

function write(p: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function homePaths(root: string): BackupPaths {
  return {
    dbPath: path.join(root, 'data', 'openaidy.db'),
    configPath: path.join(root, 'openaidy.json'),
    workspacesDir: path.join(root, 'workspaces'),
    skillsDir: path.join(root, 'skills'),
    addonsDir: path.join(root, 'addons'),
  };
}

/** A real WAL-mode db whose latest rows still live only in the -wal file. */
function makeWalDb(dbPath: string, values: number[]): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA wal_autocheckpoint = 0');
  db.exec('CREATE TABLE t (v INTEGER)');
  for (const v of values) db.exec(`INSERT INTO t (v) VALUES (${v})`);
  return db;
}

function readValues(dbPath: string): number[] {
  const db = new DatabaseSync(dbPath);
  try {
    return (
      db.prepare('SELECT v FROM t ORDER BY v').all() as { v: number }[]
    ).map((r) => r.v);
  } finally {
    db.close();
  }
}

async function archive(
  svc: BackupService,
  sections: BackupSection[] = [],
  includeHeavyFolders = false,
): Promise<string> {
  const destPath = path.join(
    work,
    `out-${Math.random().toString(36).slice(2)}.zip`,
  );
  await svc.writeArchive({
    sections,
    includeHeavyFolders,
    destPath,
    workDir: work,
  });
  return destPath;
}

/** Entry names in a zip on disk. */
function entryNames(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const names: string[] = [];
      zip.on('entry', (e: yauzl.Entry) => {
        names.push(e.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/** Hand-craft a zip from name → content (for malformed/legacy archives). */
async function craftZip(
  entries: Record<string, string | Buffer>,
): Promise<string> {
  const zipPath = path.join(
    work,
    `craft-${Math.random().toString(36).slice(2)}.zip`,
  );
  const zip = new ZipArchive();
  const out = fs.createWriteStream(zipPath);
  const done = new Promise<void>((r) => out.on('close', () => r()));
  zip.pipe(out);
  for (const [name, content] of Object.entries(entries)) {
    zip.append(content, { name });
  }
  await zip.finalize();
  await done;
  return zipPath;
}

const MANIFEST = JSON.stringify({
  version: 1,
  kind: 'openaidy-backup',
  createdAt: '2026-01-01T00:00:00.000Z',
  openaidyVersion: '0.3.8',
  sections: {},
});

let liveDb: DatabaseSync;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-backup-'));
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-backup-work-'));
  paths = homePaths(home);
  liveDb = makeWalDb(paths.dbPath, [1, 2, 3]);
  write(paths.configPath, '{"providers":[]}');
  write(path.join(paths.workspacesDir, 'default', 'AGENT.md'), '# agent');
  write(path.join(paths.workspacesDir, 'default', 'MISSION.md'), '# mission');
  write(
    path.join(paths.workspacesDir, 'code', 'node_modules', 'dep', 'index.js'),
    'x'.repeat(1000),
  );
  write(path.join(paths.workspacesDir, 'code', '.git', 'HEAD'), 'ref: main');
  write(path.join(paths.workspacesDir, 'code', 'src', 'app.ts'), 'code');
  write(path.join(paths.skillsDir, 'my-skill', 'SKILL.md'), '# skill');
  write(
    path.join(paths.addonsDir, 'my-addon', 'addon.json'),
    '{"id":"my-addon"}',
  );
  service = new BackupService(paths, '0.3.8');
});

afterEach(() => {
  liveDb.close();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

describe('BackupService.buildManifest', () => {
  it('returns a valid manifest with per-section counts and sizes', async () => {
    const m = await service.buildManifest();
    expect(m.kind).toBe('openaidy-backup');
    expect(m.version).toBe(1);
    expect(m.openaidyVersion).toBe('0.3.8');
    expect(m.sections.workspaces.itemCount).toBe(2);
    expect(m.sections.skills.itemCount).toBe(1);
    expect(m.sections.addons.itemCount).toBe(1);
    expect(m.sections.config.itemCount).toBe(1);
    expect(m.sections.db.itemCount).toBe(1);
  });

  it('reports heavy-folder bytes for workspaces only', async () => {
    const m = await service.buildManifest();
    // node_modules (1000 B) + .git/HEAD (9 B)
    expect(m.sections.workspaces.heavyBytes).toBe(1009);
    expect(m.sections.workspaces.sizeBytes).toBeGreaterThan(1009);
    expect(m.sections.skills.heavyBytes).toBeUndefined();
  });

  it('reports zero for missing sections', async () => {
    fs.rmSync(paths.addonsDir, { recursive: true, force: true });
    const m = await service.buildManifest();
    expect(m.sections.addons).toEqual({ itemCount: 0, sizeBytes: 0 });
  });
});

describe('BackupService.writeArchive', () => {
  it('produces a zip with manifest.json and all sections when none specified', async () => {
    const names = await entryNames(await archive(service));
    expect(names).toContain('manifest.json');
    expect(names).toContain('db/openaidy.db');
    expect(names).toContain('config/openaidy.json');
    expect(names).toContain('workspaces/default/AGENT.md');
    expect(names).toContain('skills/my-skill/SKILL.md');
    expect(names).toContain('addons/my-addon/addon.json');
  });

  it('includes only the selected sections', async () => {
    const names = await entryNames(await archive(service, ['config']));
    expect(names).toContain('config/openaidy.json');
    expect(names.some((n) => n.startsWith('skills/'))).toBe(false);
    expect(names.some((n) => n.startsWith('db/'))).toBe(false);
  });

  it('skips heavy workspace folders by default', async () => {
    const zip = await archive(service);
    const names = await entryNames(zip);
    expect(names).toContain('workspaces/code/src/app.ts');
    expect(names.some((n) => n.includes('/node_modules/'))).toBe(false);
    expect(names.some((n) => n.includes('/.git/'))).toBe(false);
    const { manifest } = await service.inspectArchive(zip);
    expect(manifest.includesHeavyFolders).toBe(false);
  });

  it('includes heavy folders when asked', async () => {
    const zip = await archive(service, [], true);
    const names = await entryNames(zip);
    expect(names).toContain('workspaces/code/node_modules/dep/index.js');
    expect(names).toContain('workspaces/code/.git/HEAD');
    const { manifest } = await service.inspectArchive(zip);
    expect(manifest.includesHeavyFolders).toBe(true);
  });

  it('snapshots the db consistently, including rows only in the WAL', async () => {
    // Rows 1-3 were never checkpointed: a plain copy of openaidy.db alone
    // would miss them.
    const zip = await archive(service, ['db']);
    const restoreHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-snap-'));
    try {
      const dest = new BackupService(homePaths(restoreHome), '0.3.8');
      const [r] = await dest.applyArchive(zip, ['db']);
      expect(r?.success).toBe(true);
      expect(readValues(homePaths(restoreHome).dbPath)).toEqual([1, 2, 3]);
    } finally {
      fs.rmSync(restoreHome, { recursive: true, force: true });
    }
  });

  it('never archives symlinks', async () => {
    fs.symlinkSync('/etc', path.join(paths.workspacesDir, 'default', 'etc'));
    const names = await entryNames(await archive(service, ['workspaces']));
    expect(names.some((n) => n.includes('/etc'))).toBe(false);
  });

  it('reports progress up to the full total', async () => {
    const seen: { processedBytes: number; totalBytes: number }[] = [];
    await service.writeArchive({
      sections: [],
      destPath: path.join(work, 'p.zip'),
      workDir: work,
      onProgress: (p) => seen.push({ ...p }),
    });
    const last = seen.at(-1)!;
    expect(last.totalBytes).toBeGreaterThan(0);
    expect(last.processedBytes).toBe(last.totalBytes);
  });

  it('removes the partial file and its db snapshot when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const destPath = path.join(work, 'aborted.zip');
    await expect(
      service.writeArchive({
        sections: [],
        destPath,
        workDir: work,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(fs.existsSync(destPath)).toBe(false);
    expect(fs.readdirSync(work)).toEqual([]);
  });
});

describe('BackupService.inspectArchive', () => {
  it('reads the manifest and per-section sizes from a valid backup', async () => {
    const info = await service.inspectArchive(await archive(service));
    expect(info.manifest.kind).toBe('openaidy-backup');
    expect(info.sectionBytes.config).toBe('{"providers":[]}'.length);
    expect(info.sectionBytes.db).toBeGreaterThan(0);
  });

  it('throws on a non-zip file', async () => {
    const p = path.join(work, 'not.zip');
    fs.writeFileSync(p, 'not a zip');
    await expect(service.inspectArchive(p)).rejects.toThrow(
      'Not a valid zip archive',
    );
  });

  it('throws on a zip missing manifest.json', async () => {
    const p = await craftZip({ 'random.txt': 'hi' });
    await expect(service.inspectArchive(p)).rejects.toThrow(/manifest/);
  });

  it('rejects entries that escape their section (zip-slip)', async () => {
    const p = await craftZip({
      'manifest.json': MANIFEST,
      'workspaces/../../evil.txt': 'pwned',
    });
    await expect(service.inspectArchive(p)).rejects.toThrow();
  });
});

describe('BackupService.applyArchive', () => {
  let dest: BackupService;
  let destPaths: BackupPaths;
  let destHome: string;
  let sourceZip: string;

  beforeEach(async () => {
    sourceZip = await archive(service);
    destHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-restore-'));
    destPaths = homePaths(destHome);
    dest = new BackupService(destPaths, '0.3.8');
  });

  afterEach(() => {
    fs.rmSync(destHome, { recursive: true, force: true });
  });

  it('replaces the db file and flags restart required', async () => {
    const [r] = await dest.applyArchive(sourceZip, ['db']);
    expect(r).toMatchObject({
      section: 'db',
      success: true,
      restartRequired: true,
    });
    expect(readValues(destPaths.dbPath)).toEqual([1, 2, 3]);
  });

  it('overwrites the config file', async () => {
    write(destPaths.configPath, '{"stale":true}');
    const [r] = await dest.applyArchive(sourceZip, ['config']);
    expect(r?.success).toBe(true);
    expect(fs.readFileSync(destPaths.configPath, 'utf-8')).toBe(
      '{"providers":[]}',
    );
  });

  it('merges workspaces: existing overwritten, new added, none deleted', async () => {
    write(path.join(destPaths.workspacesDir, 'default', 'AGENT.md'), 'OLD');
    write(path.join(destPaths.workspacesDir, 'default', 'KEEP.md'), 'keep me');

    const [r] = await dest.applyArchive(sourceZip, ['workspaces']);
    expect(r).toMatchObject({ success: true, itemsImported: 2 });
    const ws = (...p: string[]) => path.join(destPaths.workspacesDir, ...p);
    expect(fs.readFileSync(ws('default', 'AGENT.md'), 'utf-8')).toBe('# agent');
    expect(fs.existsSync(ws('default', 'MISSION.md'))).toBe(true);
    expect(fs.readFileSync(ws('default', 'KEEP.md'), 'utf-8')).toBe('keep me');
  });

  it('only touches the requested sections and returns results in request order', async () => {
    const results = await dest.applyArchive(sourceZip, ['skills', 'addons']);
    expect(results.map((r) => r.section)).toEqual(['skills', 'addons']);
    expect(fs.existsSync(destPaths.configPath)).toBe(false);
    expect(fs.existsSync(destPaths.dbPath)).toBe(false);
    expect(
      fs.existsSync(path.join(destPaths.addonsDir, 'my-addon', 'addon.json')),
    ).toBe(true);
  });

  it('is idempotent — re-applying yields the same bytes', async () => {
    const skill = path.join(destPaths.skillsDir, 'my-skill', 'SKILL.md');
    await dest.applyArchive(sourceZip, ['skills']);
    const first = fs.readFileSync(skill, 'utf-8');
    await dest.applyArchive(sourceZip, ['skills']);
    expect(fs.readFileSync(skill, 'utf-8')).toBe(first);
  });

  it('reports a missing single-file section as a failure', async () => {
    const zip = await archive(service, ['skills']);
    const [db, config] = await dest.applyArchive(zip, ['db', 'config']);
    expect(db).toMatchObject({
      success: false,
      error: expect.stringMatching(/no db/),
    });
    expect(config).toMatchObject({ success: false });
  });

  it('refuses a db entry that is not a SQLite file, leaving the live db alone', async () => {
    let closed = false;
    const zip = await craftZip({
      'manifest.json': MANIFEST,
      'db/openaidy.db': 'not sqlite',
    });
    const guarded = new BackupService(destPaths, '0.3.8', {
      closeDatabase: async () => {
        closed = true;
      },
    });
    const [r] = await guarded.applyArchive(zip, ['db']);
    expect(r).toMatchObject({
      success: false,
      error: expect.stringMatching(/SQLite/),
    });
    expect(closed).toBe(false);
  });

  it('restores legacy backups that carry the db plus -wal/-shm sidecars', async () => {
    // Pre-snapshot exports zipped the live files: db + wal (+ shm).
    const legacySrc = makeWalDb(
      path.join(work, 'legacy', 'openaidy.db'),
      [7, 8],
    );
    const legacyDir = path.join(work, 'legacy');
    const zip = await craftZip({
      'manifest.json': MANIFEST,
      'db/openaidy.db': fs.readFileSync(path.join(legacyDir, 'openaidy.db')),
      'db/openaidy.db-wal': fs.readFileSync(
        path.join(legacyDir, 'openaidy.db-wal'),
      ),
      'db/openaidy.db-shm': fs.readFileSync(
        path.join(legacyDir, 'openaidy.db-shm'),
      ),
    });
    legacySrc.close();
    const [r] = await dest.applyArchive(zip, ['db']);
    expect(r?.success).toBe(true);
    expect(readValues(destPaths.dbPath)).toEqual([7, 8]);
  });

  it('closes the live db connection before swapping the db in', async () => {
    const order: string[] = [];
    const destWithClose = new BackupService(destPaths, '0.3.8', {
      closeDatabase: async () => {
        order.push('closed');
      },
    });
    const [r] = await destWithClose.applyArchive(sourceZip, ['db']);
    expect(r?.success).toBe(true);
    expect(order).toEqual(['closed']);
  });

  it('flags restartRequired even when the swap fails after the connection is already closed', async () => {
    let closed = false;
    // A non-empty directory at the db path makes the final rename fail.
    write(path.join(destPaths.dbPath, 'blocker'), 'x');
    const destWithClose = new BackupService(destPaths, '0.3.8', {
      closeDatabase: async () => {
        closed = true;
      },
    });
    const [r] = await destWithClose.applyArchive(sourceZip, ['db']);
    expect(closed).toBe(true);
    expect(r?.success).toBe(false);
    expect(r?.restartRequired).toBe(true);
  });

  it('overwrites a real WAL-mode db + its live -shm/-wal sidecars without throwing', async () => {
    // Regression test for the Windows-only crash: overwriting db-shm/db-wal
    // while a node:sqlite connection still holds them open/mmap'd fails on
    // Windows. closeDatabase is what lets the overwrite succeed.
    const live = makeWalDb(destPaths.dbPath, [99]);
    expect(fs.existsSync(`${destPaths.dbPath}-shm`)).toBe(true);
    const destWithClose = new BackupService(destPaths, '0.3.8', {
      closeDatabase: async () => live.close(),
    });
    const [r] = await destWithClose.applyArchive(sourceZip, ['db']);
    expect(r?.success).toBe(true);
    expect(readValues(destPaths.dbPath)).toEqual([1, 2, 3]);
  });

  it('leaves no staged temp files behind', async () => {
    await dest.applyArchive(sourceZip, ['db', 'config']);
    const leftovers = [
      ...fs.readdirSync(path.dirname(destPaths.dbPath)),
      ...fs.readdirSync(destHome),
    ].filter((n) => n.includes('.import-'));
    expect(leftovers).toEqual([]);
  });
});
