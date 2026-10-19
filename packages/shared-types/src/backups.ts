/**
 * Backup export/import types.
 *
 * A backup is a `.zip` archive with a versioned `manifest.json` plus one
 * subdirectory per data section. Import is selective: the user chooses which
 * sections to restore, and restores are non-destructive (add/overwrite, never
 * delete — except `db`, which is a full file replacement).
 */

/** Backup archive manifest format version. */
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_KIND = 'openaidy-backup';

/** Sections available in a backup. */
export type BackupSection =
  | 'db'
  | 'config'
  | 'workspaces'
  | 'skills'
  | 'addons';

/** All sections, in a stable display order. */
export const BACKUP_SECTIONS: readonly BackupSection[] = [
  'db',
  'config',
  'workspaces',
  'skills',
  'addons',
];

/**
 * Folder names treated as "heavy" inside workspaces: dependency installs,
 * VCS metadata and tool caches. They are large, rebuildable, and skipped by
 * default on export (opt back in with `includeHeavyFolders`).
 */
export const BACKUP_HEAVY_FOLDER_NAMES: readonly string[] = [
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.gradle',
];

/** Per-section item count and size info for display. */
export type BackupSectionSummary = {
  itemCount: number;
  /** Total bytes, heavy folders included. */
  sizeBytes: number;
  /**
   * Bytes that live inside heavy folders (see BACKUP_HEAVY_FOLDER_NAMES).
   * Only reported for sections the heavy-folder filter applies to.
   */
  heavyBytes?: number;
};

/** The manifest written into every backup zip. */
export type BackupManifest = {
  version: typeof BACKUP_FORMAT_VERSION;
  kind: typeof BACKUP_KIND;
  /** ISO 8601 */
  createdAt: string;
  openaidyVersion: string;
  sections: Record<BackupSection, BackupSectionSummary>;
  /** Whether heavy workspace folders were included (absent on older backups). */
  includesHeavyFolders?: boolean;
};

/** Response body of `GET /api/backups/manifest` (live snapshot of OPENAIDY_HOME). */
export type BackupManifestResponse = {
  manifest: BackupManifest;
};

/** Request body of `POST /api/backups/exports` (omit `sections` for all). */
export type ExportRequest = {
  sections?: BackupSection[];
  /** Include node_modules, .git, … inside workspaces. Default false. */
  includeHeavyFolders?: boolean;
};

/**
 * An uploaded backup staged on disk, ready to import. Response body of
 * `POST /api/backups/uploads`.
 */
export type BackupUpload = {
  id: string;
  manifest: BackupManifest;
  zipSizeBytes: number;
  /** ISO 8601 — the staged file is deleted after this unless an import is running. */
  expiresAt: string;
};

/** Request body of `POST /api/backups/uploads/:id/import`. */
export type ImportRequest = {
  sections: BackupSection[];
};

/** Result of importing one section. */
export type ImportedSection = {
  section: BackupSection;
  success: boolean;
  error?: string;
  itemsImported: number;
  /** True when the imported section only takes effect after a server restart. */
  restartRequired?: boolean;
};

export type BackupJobKind = 'export' | 'import';

export type BackupJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * A background export or import. Exports are written to a temp file on the
 * server and downloaded once `status === 'succeeded'`; imports apply sections
 * from a staged upload. Poll `GET /api/backups/jobs/:id` for progress.
 */
export type BackupJob = {
  id: string;
  kind: BackupJobKind;
  status: BackupJobStatus;
  /** Human-readable current step, e.g. "Snapshotting database". */
  phase: string;
  processedBytes: number;
  totalBytes: number;
  /** ISO 8601 */
  startedAt: string;
  /** ISO 8601 */
  finishedAt?: string;
  error?: string;
  /** export: size of the finished zip. */
  fileSizeBytes?: number;
  /**
   * export: relative URL that downloads the finished zip. Carries a
   * job-scoped key so the browser can fetch it natively (no auth header),
   * which lets it stream to disk and resume an interrupted download.
   */
  downloadUrl?: string;
  /** export: ISO 8601 — the finished zip is deleted after this. */
  expiresAt?: string;
  /** import: per-section results once finished. */
  results?: ImportedSection[];
};

/** Response body of the job endpoints. */
export type BackupJobResponse = {
  job: BackupJob;
};

/** Options passed to the backup service that don't come from the archive itself. */
export type BackupServiceOptions = {
  /**
   * Closes the server's live sqlite connection. Called right before the
   * `db` section's file/sidecar writes during import.
   *
   * The running `node:sqlite` connection keeps the WAL `-shm` sidecar
   * memory-mapped for as long as it's open. On POSIX, overwriting an
   * open/mapped file is silently allowed (if incoherent — the live
   * connection's view goes stale, which is exactly why a `db` import
   * always sets `restartRequired`). On Windows it isn't allowed at all:
   * the write fails with an unmapped libuv error
   * (`UNKNOWN: unknown error, open '...db-shm'`). Closing first makes the
   * write succeed on both, and is a no-op improvement on POSIX since a
   * restart was already required regardless.
   *
   * The caller is responsible for only providing this when the live
   * connection is actually sqlite-backed — invoking it against a
   * postgres deployment's connection pool would tear down every other
   * DB-backed route for an import that never touches that pool.
   */
  closeDatabase?: () => Promise<void>;
};

/** Type guard for a parsed manifest. */
export function isBackupManifest(value: unknown): value is BackupManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    m.kind === BACKUP_KIND &&
    m.version === BACKUP_FORMAT_VERSION &&
    typeof m.createdAt === 'string' &&
    typeof m.sections === 'object' &&
    m.sections !== null
  );
}
