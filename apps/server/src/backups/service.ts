/**
 * Backup service — builds and applies OpenAidy data backups.
 *
 * A backup is a `.zip` with a `manifest.json` plus one subdirectory per
 * section (db, config, workspaces, skills, addons). Paths are injected so the
 * service is testable against a temp OPENAIDY_HOME. See issue #451.
 *
 * Everything here streams through files on disk — never whole archives or
 * whole entries in memory — so a multi-GB backup works on a 1 GB droplet:
 *  - export walks directories one entry at a time and appends files to the
 *    archive one at a time (the archiver queue never holds more than one);
 *  - the db is snapshotted with SQLite's online backup API, so the archive
 *    gets a consistent copy instead of a live file + WAL caught mid-write;
 *  - import reads the zip from disk with yauzl and pipes each entry straight
 *    to its destination.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_KIND,
  BACKUP_SECTIONS,
  isBackupManifest,
  type BackupSection,
  type BackupManifest,
  type BackupSectionSummary,
  type BackupServiceOptions,
  type ImportedSection,
} from '@openaidy/shared-types';
import { measureDir, walkFiles } from './walk';

export type { BackupServiceOptions };

/** Resolved filesystem locations for each backup section. */
export type BackupPaths = {
  /** SQLite DB file (e.g. $OPENAIDY_HOME/data/openaidy.db). */
  dbPath: string;
  /** App config file (e.g. $OPENAIDY_HOME/openaidy.json). */
  configPath: string;
  /** Workspaces root dir. */
  workspacesDir: string;
  /** Skills root dir. */
  skillsDir: string;
  /** Addons root dir. */
  addonsDir: string;
};

/** Progress callback shared by export and import. */
export type BackupProgress = {
  phase: string;
  processedBytes: number;
  totalBytes: number;
};

export type WriteArchiveOptions = {
  /** Sections to include; empty = all. */
  sections: BackupSection[];
  /** Include node_modules, .git, … inside workspaces. */
  includeHeavyFolders?: boolean | undefined;
  /** Where to write the finished zip. */
  destPath: string;
  /** Scratch dir for the db snapshot (same filesystem as destPath is best). */
  workDir: string;
  signal?: AbortSignal;
  onProgress?: (progress: BackupProgress) => void;
};

/** What `inspectArchive` learns about a zip without extracting it. */
export type ArchiveInfo = {
  manifest: BackupManifest;
  /** Uncompressed bytes per section prefix, as declared by the zip. */
  sectionBytes: Record<BackupSection, number>;
};

export type ApplyArchiveOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: BackupProgress) => void;
};

/** Sections the heavy-folder filter applies to. Addons/skills are small and may need their own deps. */
const HEAVY_FILTER_SECTIONS: ReadonlySet<BackupSection> = new Set([
  'workspaces',
]);

/** Already-compressed formats: deflating them again only burns CPU. */
// prettier-ignore
const STORE_EXTENSIONS = new Set([
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.zst', '.7z', '.rar', '.br',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic',
  '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac',
  '.mp4', '.mov', '.webm', '.mkv', '.avi',
  '.pdf', '.woff', '.woff2', '.docx', '.xlsx', '.pptx', '.jar', '.whl',
]);

/** Max size of manifest.json we're willing to parse. */
const MAX_MANIFEST_BYTES = 1024 * 1024;

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

/** Unix file-type bits in a zip entry's external attributes. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Number of top-level entries in a dir (workspaces/skills/addons "items"). */
async function countTopLevel(dir: string): Promise<number> {
  try {
    return (await fs.promises.readdir(dir)).length;
  } catch {
    return 0;
  }
}

function emptySectionRecord<T>(value: T): Record<BackupSection, T> {
  const out = {} as Record<BackupSection, T>;
  for (const s of BACKUP_SECTIONS) out[s] = value;
  return out;
}

function abortError(): Error {
  const err = new Error('Backup cancelled');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/**
 * Consistent copy of a live SQLite db using the online backup API (async,
 * page-by-page, doesn't block writers). Falls back to `VACUUM INTO` on Node
 * versions without `sqlite.backup` (< 22.16) — synchronous, but still a
 * consistent snapshot.
 */
async function snapshotSqlite(
  srcPath: string,
  destPath: string,
): Promise<void> {
  const sqlite = await import('node:sqlite');
  const db = new sqlite.DatabaseSync(srcPath);
  try {
    if (typeof sqlite.backup === 'function') {
      await sqlite.backup(db, destPath);
    } else {
      db.exec(`VACUUM INTO '${destPath.replaceAll("'", "''")}'`);
    }
  } finally {
    db.close();
  }
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (err, zip) => {
        if (err || !zip) {
          reject(new Error('Not a valid zip archive'));
        } else {
          resolve(zip);
        }
      },
    );
  });
}

/** Iterate a zip's entries one at a time, awaiting `onEntry` before the next. */
function forEachEntry(
  zip: yauzl.ZipFile,
  onEntry: (entry: yauzl.Entry) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      onEntry(entry).then(
        () => zip.readEntry(),
        (err: unknown) => {
          zip.close();
          reject(err);
        },
      );
    });
    zip.once('end', () => resolve());
    zip.once('error', (err: Error) => reject(err));
    zip.readEntry();
  });
}

function openEntryStream(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error('Failed to read entry'));
      else resolve(stream);
    });
  });
}

async function readEntryText(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<string> {
  const stream = await openEntryStream(zip, entry);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

function isSymlinkEntry(entry: yauzl.Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;
}

/** Section an entry belongs to, plus its path inside that section. */
function splitEntryName(
  name: string,
): { section: BackupSection; rel: string } | undefined {
  const slash = name.indexOf('/');
  if (slash === -1) return undefined;
  const section = name.slice(0, slash) as BackupSection;
  if (!BACKUP_SECTIONS.includes(section)) return undefined;
  return { section, rel: name.slice(slash + 1) };
}

async function hasSqliteHeader(file: string): Promise<boolean> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(SQLITE_HEADER.length);
    await handle.read(buf, 0, buf.length, 0);
    return buf.equals(SQLITE_HEADER);
  } finally {
    await handle.close();
  }
}

export class BackupService {
  constructor(
    private readonly paths: BackupPaths,
    private readonly openaidyVersion: string,
    private readonly options: BackupServiceOptions = {},
  ) {}

  private dirFor(section: 'workspaces' | 'skills' | 'addons'): string {
    switch (section) {
      case 'workspaces':
        return this.paths.workspacesDir;
      case 'skills':
        return this.paths.skillsDir;
      case 'addons':
        return this.paths.addonsDir;
    }
  }

  /** The db file plus its WAL sidecar, when present. */
  private dbFiles(): string[] {
    return [this.paths.dbPath, `${this.paths.dbPath}-wal`].filter(fileExists);
  }

  private async sectionSummary(
    section: BackupSection,
  ): Promise<BackupSectionSummary> {
    if (section === 'db') {
      const files = this.dbFiles();
      const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
      return { itemCount: files.length > 0 ? 1 : 0, sizeBytes: bytes };
    }
    if (section === 'config') {
      const present = fileExists(this.paths.configPath);
      return {
        itemCount: present ? 1 : 0,
        sizeBytes: present ? fs.statSync(this.paths.configPath).size : 0,
      };
    }
    const dir = this.dirFor(section);
    const { bytes, heavyBytes } = await measureDir(dir);
    return {
      itemCount: await countTopLevel(dir),
      sizeBytes: bytes,
      ...(HEAVY_FILTER_SECTIONS.has(section) ? { heavyBytes } : {}),
    };
  }

  /** Build a manifest from the live OPENAIDY_HOME. */
  async buildManifest(): Promise<BackupManifest> {
    const sections = emptySectionRecord<BackupSectionSummary>({
      itemCount: 0,
      sizeBytes: 0,
    });
    for (const section of BACKUP_SECTIONS) {
      sections[section] = await this.sectionSummary(section);
    }
    return {
      version: BACKUP_FORMAT_VERSION,
      kind: BACKUP_KIND,
      createdAt: new Date().toISOString(),
      openaidyVersion: this.openaidyVersion,
      sections,
    };
  }

  /**
   * Write a backup zip of the given sections (default: all) to
   * `options.destPath`. Resolves with the zip's size once fully flushed.
   * On failure or abort the partial file is removed.
   */
  async writeArchive(
    options: WriteArchiveOptions,
  ): Promise<{ sizeBytes: number }> {
    const { destPath, workDir, signal, onProgress } = options;
    const includeHeavy = options.includeHeavyFolders === true;
    const selected =
      options.sections.length > 0
        ? BACKUP_SECTIONS.filter((s) => options.sections.includes(s))
        : [...BACKUP_SECTIONS];

    const skipHeavyFor = (s: BackupSection) =>
      !includeHeavy && HEAVY_FILTER_SECTIONS.has(s);

    fs.mkdirSync(workDir, { recursive: true });
    const snapshotPath = path.join(
      workDir,
      `db-snapshot-${randomBytes(6).toString('hex')}.db`,
    );

    try {
      // ── Plan: sizes for the manifest and the progress total ──────────────
      let phase = 'Scanning files';
      let processedBytes = 0;
      let totalBytes = 0;
      const report = () => onProgress?.({ phase, processedBytes, totalBytes });
      report();

      const summaries = emptySectionRecord<BackupSectionSummary>({
        itemCount: 0,
        sizeBytes: 0,
      });
      for (const section of selected) {
        throwIfAborted(signal);
        if (section === 'db' || section === 'config') continue;
        const dir = this.dirFor(section);
        let bytes = 0;
        for await (const f of walkFiles(dir, {
          skipHeavy: skipHeavyFor(section),
        })) {
          bytes += f.size;
        }
        summaries[section] = {
          itemCount: await countTopLevel(dir),
          sizeBytes: bytes,
        };
        totalBytes += bytes;
      }

      const includeDb =
        selected.includes('db') && fileExists(this.paths.dbPath);
      if (includeDb) {
        phase = 'Snapshotting database';
        report();
        await snapshotSqlite(this.paths.dbPath, snapshotPath);
        throwIfAborted(signal);
        const size = fs.statSync(snapshotPath).size;
        summaries.db = { itemCount: 1, sizeBytes: size };
        totalBytes += size;
      }
      const includeConfig =
        selected.includes('config') && fileExists(this.paths.configPath);
      if (includeConfig) {
        const size = fs.statSync(this.paths.configPath).size;
        summaries.config = { itemCount: 1, sizeBytes: size };
        totalBytes += size;
      }

      const manifest: BackupManifest = {
        version: BACKUP_FORMAT_VERSION,
        kind: BACKUP_KIND,
        createdAt: new Date().toISOString(),
        openaidyVersion: this.openaidyVersion,
        sections: summaries,
        includesHeavyFolders: includeHeavy,
      };

      // ── Archive ──────────────────────────────────────────────────────────
      // Level 1: a fraction of level 9's CPU for most of the size win; the
      // export used to take 10+ minutes on a 1-vCPU droplet at level 9.
      const archive = new ZipArchive({ zlib: { level: 1 } });
      const out = fs.createWriteStream(destPath);
      let failure: Error | undefined;
      let failListeners: Array<(err: Error) => void> = [];
      const fail = (err: Error) => {
        if (failure) return;
        failure = err;
        for (const l of failListeners) l(err);
      };
      archive.on('error', fail);
      archive.on('warning', (err: Error & { code?: string }) => {
        if (err.code !== 'ENOENT') fail(err);
      });
      out.on('error', fail);
      archive.pipe(out);

      // Append one source and wait for archiver to consume it, so its queue
      // never holds more than one file (and one open descriptor) at a time.
      const appendAndWait = (
        source: Readable | Buffer,
        name: string,
        store: boolean,
      ) =>
        new Promise<void>((resolve, reject) => {
          if (failure) return reject(failure);
          const onFail = (err: Error) => {
            archive.off('entry', onEntry);
            reject(err);
          };
          const onEntry = () => {
            failListeners = failListeners.filter((l) => l !== onFail);
            resolve();
          };
          failListeners.push(onFail);
          archive.once('entry', onEntry);
          archive.append(source, { name, store });
        });

      const appendFile = async (
        absPath: string,
        name: string,
        size: number,
      ) => {
        // Open first: a file deleted mid-walk is skipped instead of failing
        // the whole export, and once open it can't vanish under the read.
        let handle: fs.promises.FileHandle;
        try {
          handle = await fs.promises.open(absPath, 'r');
        } catch {
          return;
        }
        const store = STORE_EXTENSIONS.has(path.extname(name).toLowerCase());
        await appendAndWait(handle.createReadStream(), name, store);
        processedBytes += size;
        report();
      };

      try {
        await appendAndWait(
          Buffer.from(JSON.stringify(manifest, null, 2)),
          'manifest.json',
          false,
        );

        for (const section of selected) {
          throwIfAborted(signal);
          if (section === 'db') {
            if (!includeDb) continue;
            phase = 'Adding database';
            report();
            await appendFile(
              snapshotPath,
              `db/${path.basename(this.paths.dbPath)}`,
              summaries.db.sizeBytes,
            );
          } else if (section === 'config') {
            if (!includeConfig) continue;
            phase = 'Adding configuration';
            await appendFile(
              this.paths.configPath,
              `config/${path.basename(this.paths.configPath)}`,
              summaries.config.sizeBytes,
            );
          } else {
            phase = `Adding ${section}`;
            report();
            for await (const f of walkFiles(this.dirFor(section), {
              skipHeavy: skipHeavyFor(section),
            })) {
              throwIfAborted(signal);
              await appendFile(f.absPath, `${section}/${f.relPath}`, f.size);
            }
          }
        }

        phase = 'Finalizing';
        report();
        const closed = new Promise<void>((resolve, reject) => {
          out.once('close', () => resolve());
          failListeners.push(reject);
        });
        await archive.finalize();
        await closed;
        if (failure) throw failure;
      } catch (err) {
        archive.abort();
        out.destroy();
        await fs.promises.rm(destPath, { force: true });
        throw err;
      }

      return { sizeBytes: fs.statSync(destPath).size };
    } finally {
      await fs.promises.rm(snapshotPath, { force: true });
    }
  }

  /**
   * Validate a backup zip on disk and read its manifest plus per-section
   * sizes, without extracting anything. Throws on anything that isn't a
   * well-formed OpenAidy backup.
   */
  async inspectArchive(zipPath: string): Promise<ArchiveInfo> {
    const zip = await openZip(zipPath);
    try {
      let manifestText: string | undefined;
      const sectionBytes = emptySectionRecord(0);
      await forEachEntry(zip, async (entry) => {
        if (entry.fileName === 'manifest.json') {
          if (entry.uncompressedSize > MAX_MANIFEST_BYTES) {
            throw new Error('manifest.json is too large');
          }
          manifestText = await readEntryText(zip, entry);
          return;
        }
        const split = splitEntryName(entry.fileName);
        if (split) sectionBytes[split.section] += entry.uncompressedSize;
      });
      if (manifestText === undefined) {
        throw new Error('Backup is missing manifest.json');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(manifestText);
      } catch {
        throw new Error('manifest.json is not valid JSON');
      }
      if (!isBackupManifest(parsed)) {
        throw new Error('manifest.json is not an OpenAidy backup manifest');
      }
      return { manifest: parsed, sectionBytes };
    } finally {
      zip.close();
    }
  }

  /**
   * Apply the selected sections from a backup zip on disk in one streaming
   * pass. Non-destructive for dir sections (files overwritten/added, never
   * deleted); db/config are file replacements, staged to a temp file and
   * renamed into place only once fully extracted. Returns one result per
   * requested section, in the order requested.
   */
  async applyArchive(
    zipPath: string,
    sections: BackupSection[],
    options: ApplyArchiveOptions = {},
  ): Promise<ImportedSection[]> {
    const { signal, onProgress } = options;
    const info = await this.inspectArchive(zipPath);
    const wanted = new Set(sections);

    let processedBytes = 0;
    const totalBytes = sections.reduce((n, s) => n + info.sectionBytes[s], 0);
    let phase = 'Restoring';
    const report = () => onProgress?.({ phase, processedBytes, totalBytes });
    report();

    const errors = new Map<BackupSection, string>();
    const topLevel = new Map<BackupSection, Set<string>>();
    const tag = randomBytes(6).toString('hex');
    const staged: { dbMain?: string; dbWal?: string; config?: string } = {};
    const stagedFiles: string[] = [];

    const stageTo = (target: string) => {
      const tmp = `${target}.import-${tag}`;
      stagedFiles.push(tmp);
      return tmp;
    };

    const zip = await openZip(zipPath);
    try {
      await forEachEntry(zip, async (entry) => {
        throwIfAborted(signal);
        const split = splitEntryName(entry.fileName);
        if (!split || !wanted.has(split.section) || !split.rel) return;
        const { section, rel } = split;
        if (rel.endsWith('/') || isSymlinkEntry(entry)) return;
        if (errors.has(section) && (section === 'db' || section === 'config')) {
          return;
        }

        phase = `Restoring ${section}`;
        let target: string;
        if (section === 'db') {
          if (rel.endsWith('-shm')) return; // derived; never restore
          const dbPath = this.paths.dbPath;
          fs.mkdirSync(path.dirname(dbPath), { recursive: true });
          if (rel.endsWith('-wal')) {
            target = staged.dbWal ??= stageTo(`${dbPath}-wal`);
          } else if (!staged.dbMain) {
            target = staged.dbMain = stageTo(dbPath);
          } else {
            return;
          }
        } else if (section === 'config') {
          if (staged.config) return;
          fs.mkdirSync(path.dirname(this.paths.configPath), {
            recursive: true,
          });
          target = staged.config = stageTo(this.paths.configPath);
        } else {
          const destDir = this.dirFor(section);
          const normalized = path.normalize(path.join(destDir, rel));
          // Guard against zip-slip: reject paths that escape destDir.
          if (!normalized.startsWith(destDir + path.sep)) return;
          target = normalized;
          const first = rel.split('/')[0];
          if (first) {
            if (!topLevel.has(section)) topLevel.set(section, new Set());
            topLevel.get(section)!.add(first);
          }
        }

        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          await pipeline(
            await openEntryStream(zip, entry),
            fs.createWriteStream(target),
          );
        } catch (err) {
          if (!errors.has(section)) {
            errors.set(
              section,
              err instanceof Error ? err.message : 'Failed to write file',
            );
          }
        }
        processedBytes += entry.uncompressedSize;
        report();
      });

      phase = 'Finishing';
      report();
      const results: ImportedSection[] = [];
      for (const section of sections) {
        results.push(
          await this.finishSection(section, staged, errors, topLevel),
        );
      }
      return results;
    } finally {
      zip.close();
      for (const f of stagedFiles) {
        await fs.promises.rm(f, { force: true });
      }
    }
  }

  /** Move staged db/config files into place and build the section result. */
  private async finishSection(
    section: BackupSection,
    staged: { dbMain?: string; dbWal?: string; config?: string },
    errors: Map<BackupSection, string>,
    topLevel: Map<BackupSection, Set<string>>,
  ): Promise<ImportedSection> {
    const error = errors.get(section);

    if (section === 'db') {
      if (!staged.dbMain) {
        return {
          section,
          success: false,
          error: 'Backup contains no db section',
          itemsImported: 0,
        };
      }
      if (error) return { section, success: false, error, itemsImported: 0 };
      if (!(await hasSqliteHeader(staged.dbMain))) {
        return {
          section,
          success: false,
          error: 'Backup db is not a SQLite database',
          itemsImported: 0,
        };
      }

      // The live connection (if any) holds the WAL -shm sidecar
      // memory-mapped; overwriting it out from under that handle fails
      // outright on Windows and leaves a stale in-memory view on POSIX.
      // Close it first — see BackupServiceOptions.closeDatabase.
      await this.options.closeDatabase?.();
      const dbPath = this.paths.dbPath;
      try {
        // Clear existing sidecars so we don't mix an old WAL with a new DB.
        for (const suffix of ['-wal', '-shm']) {
          fs.rmSync(`${dbPath}${suffix}`, { force: true });
        }
        fs.renameSync(staged.dbMain, dbPath);
        if (staged.dbWal) fs.renameSync(staged.dbWal, `${dbPath}-wal`);
      } catch (err) {
        // The live connection is already closed, so the db is in an unknown
        // state either way — always flag restartRequired rather than letting
        // this failure look like a no-op the caller can just retry.
        return {
          section,
          success: false,
          error:
            err instanceof Error ? err.message : 'Failed to write db files',
          itemsImported: 0,
          restartRequired: true,
        };
      }
      return {
        section,
        success: true,
        itemsImported: 1,
        restartRequired: true,
      };
    }

    if (section === 'config') {
      if (!staged.config) {
        return {
          section,
          success: false,
          error: 'Backup contains no config section',
          itemsImported: 0,
        };
      }
      if (error) return { section, success: false, error, itemsImported: 0 };
      fs.renameSync(staged.config, this.paths.configPath);
      return {
        section,
        success: true,
        itemsImported: 1,
        restartRequired: true,
      };
    }

    const itemsImported = topLevel.get(section)?.size ?? 0;
    if (error) return { section, success: false, error, itemsImported };
    fs.mkdirSync(this.dirFor(section), { recursive: true });
    return { section, success: true, itemsImported };
  }
}

export function createBackupService(
  paths: BackupPaths,
  openaidyVersion: string,
  options?: BackupServiceOptions,
): BackupService {
  return new BackupService(paths, openaidyVersion, options);
}
