/**
 * Backup service — builds and applies OpenAidy data backups.
 *
 * A backup is a `.zip` with a `manifest.json` plus one subdirectory per
 * section (db, config, workspaces, skills, addons). Paths are injected so the
 * service is testable against a temp OPENAIDY_HOME. See issue #451.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import AdmZip from 'adm-zip';
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

/** A section backed by a single file vs. a recursive directory. */
type SectionSource =
  | { kind: 'file'; path: string }
  | { kind: 'dir'; path: string };

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Recursive [count-of-files, total-bytes] for a directory (0/0 if missing). */
function measureDir(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  if (!dirExists(dir)) return { files, bytes };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = measureDir(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      try {
        bytes += fs.statSync(full).size;
      } catch {
        // unreadable — skip
      }
    }
  }
  return { files, bytes };
}

/** Number of top-level entries in a dir (workspaces/skills/addons "items"). */
function countTopLevel(dir: string): number {
  if (!dirExists(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).length;
}

export class BackupService {
  constructor(
    private readonly paths: BackupPaths,
    private readonly openaidyVersion: string,
    private readonly options: BackupServiceOptions = {},
  ) {}

  private sectionSource(section: BackupSection): SectionSource {
    switch (section) {
      case 'db':
        return { kind: 'file', path: this.paths.dbPath };
      case 'config':
        return { kind: 'file', path: this.paths.configPath };
      case 'workspaces':
        return { kind: 'dir', path: this.paths.workspacesDir };
      case 'skills':
        return { kind: 'dir', path: this.paths.skillsDir };
      case 'addons':
        return { kind: 'dir', path: this.paths.addonsDir };
    }
  }

  /** The db file plus its WAL/SHM sidecars, when present. */
  private dbFiles(): string[] {
    return [
      this.paths.dbPath,
      `${this.paths.dbPath}-wal`,
      `${this.paths.dbPath}-shm`,
    ].filter(fileExists);
  }

  private sectionSummary(section: BackupSection): BackupSectionSummary {
    const src = this.sectionSource(section);
    if (src.kind === 'file') {
      if (section === 'db') {
        const files = this.dbFiles();
        const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
        return { itemCount: files.length > 0 ? 1 : 0, sizeBytes: bytes };
      }
      const present = fileExists(src.path);
      return {
        itemCount: present ? 1 : 0,
        sizeBytes: present ? fs.statSync(src.path).size : 0,
      };
    }
    return {
      itemCount: countTopLevel(src.path),
      sizeBytes: measureDir(src.path).bytes,
    };
  }

  /** Build a manifest from the live OPENAIDY_HOME. */
  buildManifest(): BackupManifest {
    const sections = {} as Record<BackupSection, BackupSectionSummary>;
    for (const section of BACKUP_SECTIONS) {
      sections[section] = this.sectionSummary(section);
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
   * Stream a backup zip of the given sections (default: all) to a writable.
   * Resolves once the archive is fully flushed. Rejects on archive error.
   */
  buildZip(
    sections: BackupSection[],
    out: NodeJS.WritableStream,
  ): Promise<void> {
    const selected =
      sections.length > 0
        ? BACKUP_SECTIONS.filter((s) => sections.includes(s))
        : [...BACKUP_SECTIONS];

    // Manifest reflects only the sections included in THIS archive.
    const manifest: BackupManifest = {
      version: BACKUP_FORMAT_VERSION,
      kind: BACKUP_KIND,
      createdAt: new Date().toISOString(),
      openaidyVersion: this.openaidyVersion,
      sections: {} as Record<BackupSection, BackupSectionSummary>,
    };
    for (const section of BACKUP_SECTIONS) {
      manifest.sections[section] = selected.includes(section)
        ? this.sectionSummary(section)
        : { itemCount: 0, sizeBytes: 0 };
    }

    return new Promise<void>((resolve, reject) => {
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on('error', reject);
      archive.on('warning', (err) => {
        if (err.code !== 'ENOENT') reject(err);
      });
      out.on('close', () => resolve());
      out.on('error', reject);
      archive.pipe(out);

      archive.append(JSON.stringify(manifest, null, 2), {
        name: 'manifest.json',
      });

      for (const section of selected) {
        const src = this.sectionSource(section);
        if (section === 'db') {
          for (const f of this.dbFiles()) {
            archive.file(f, { name: `db/${path.basename(f)}` });
          }
        } else if (src.kind === 'file') {
          if (fileExists(src.path)) {
            archive.file(src.path, {
              name: `${section}/${path.basename(src.path)}`,
            });
          }
        } else if (dirExists(src.path)) {
          archive.directory(src.path, section);
        }
      }

      void archive.finalize();
    });
  }

  /** Parse and validate the manifest from a backup zip buffer. Throws on invalid. */
  readManifest(zipBuffer: Buffer): BackupManifest {
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      throw new Error('Not a valid zip archive');
    }
    const entry = zip.getEntry('manifest.json');
    if (!entry) {
      throw new Error('Backup is missing manifest.json');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.getData().toString('utf-8'));
    } catch {
      throw new Error('manifest.json is not valid JSON');
    }
    if (!isBackupManifest(parsed)) {
      throw new Error('manifest.json is not an OpenAidy backup manifest');
    }
    return parsed;
  }

  /**
   * Apply one section from a backup zip. Non-destructive for dir sections
   * (files overwritten/added, never deleted); db/config are file replacements.
   * Returns a per-section result; throws are caught by the caller.
   */
  async applySection(
    section: BackupSection,
    zip: AdmZip,
  ): Promise<ImportedSection> {
    switch (section) {
      case 'db':
        return this.applyFilesReplace(
          'db',
          this.paths.dbPath,
          zip,
          /* restartRequired */ true,
        );
      case 'config':
        return this.applyFilesReplace(
          'config',
          this.paths.configPath,
          zip,
          /* restartRequired */ true,
        );
      case 'workspaces':
        return this.applyDirMerge('workspaces', this.paths.workspacesDir, zip);
      case 'skills':
        return this.applyDirMerge('skills', this.paths.skillsDir, zip);
      case 'addons':
        return this.applyDirMerge('addons', this.paths.addonsDir, zip);
    }
  }

  /**
   * Replace a single-file section (db, config). For db this also restores the
   * WAL/SHM sidecars and removes stale ones so the imported DB is consistent.
   */
  private async applyFilesReplace(
    section: 'db' | 'config',
    destPath: string,
    zip: AdmZip,
    restartRequired: boolean,
  ): Promise<ImportedSection> {
    const prefix = `${section}/`;
    const entries = zip
      .getEntries()
      .filter((e) => !e.isDirectory && e.entryName.startsWith(prefix));
    if (entries.length === 0) {
      return {
        section,
        success: false,
        error: `Backup contains no ${section} section`,
        itemsImported: 0,
      };
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    if (section === 'db') {
      // The live connection (if any) holds the WAL -shm sidecar
      // memory-mapped; overwriting it out from under that handle fails
      // outright on Windows and leaves a stale in-memory view on POSIX.
      // Close it first — see BackupServiceOptions.closeDatabase.
      await this.options.closeDatabase?.();

      try {
        // Clear existing sidecars so we don't mix an old WAL with a new DB.
        for (const suffix of ['-wal', '-shm']) {
          try {
            fs.rmSync(`${destPath}${suffix}`, { force: true });
          } catch {
            // ignore
          }
        }
        for (const entry of entries) {
          const base = path.basename(entry.entryName);
          // Map the archived basename back onto the live db path family.
          const target =
            base === path.basename(destPath)
              ? destPath
              : path.join(path.dirname(destPath), base);
          fs.writeFileSync(target, entry.getData());
        }
      } catch (err) {
        // The live connection was already closed above (if one existed)
        // before we got here, so regardless of whether this write itself
        // failed partway through (corrupted entry, disk full, a lock on
        // the destination), the db is left in an unknown state either
        // way — always flag restartRequired rather than letting this
        // failure look like a no-op the caller can just retry.
        return {
          section,
          success: false,
          error:
            err instanceof Error ? err.message : 'Failed to write db files',
          itemsImported: 0,
          restartRequired: true,
        };
      }
      return { section, success: true, itemsImported: 1, restartRequired };
    }

    // config: single file overwrite in place.
    fs.writeFileSync(destPath, entries[0]!.getData());
    return { section, success: true, itemsImported: 1, restartRequired };
  }

  /**
   * Merge a directory section: write every archived file under the section
   * prefix into destDir (creating dirs, overwriting existing files, never
   * deleting). Idempotent — re-applying the same backup yields the same bytes.
   * itemsImported counts the top-level entries touched.
   */
  private applyDirMerge(
    section: BackupSection,
    destDir: string,
    zip: AdmZip,
  ): ImportedSection {
    const prefix = `${section}/`;
    const entries = zip
      .getEntries()
      .filter((e) => !e.isDirectory && e.entryName.startsWith(prefix));

    fs.mkdirSync(destDir, { recursive: true });
    const topLevel = new Set<string>();

    for (const entry of entries) {
      const rel = entry.entryName.slice(prefix.length);
      if (!rel) continue;
      // Guard against zip-slip: reject paths that escape destDir.
      const target = path.join(destDir, rel);
      const normalized = path.normalize(target);
      if (
        normalized !== destDir &&
        !normalized.startsWith(destDir + path.sep)
      ) {
        continue;
      }
      fs.mkdirSync(path.dirname(normalized), { recursive: true });
      fs.writeFileSync(normalized, entry.getData());
      const first = rel.split('/')[0];
      if (first) topLevel.add(first);
    }

    return { section, success: true, itemsImported: topLevel.size };
  }
}

export function createBackupService(
  paths: BackupPaths,
  openaidyVersion: string,
  options?: BackupServiceOptions,
): BackupService {
  return new BackupService(paths, openaidyVersion, options);
}
