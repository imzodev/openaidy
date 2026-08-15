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

/** Per-section item count and size info for display. */
export type BackupSectionSummary = {
  itemCount: number;
  sizeBytes: number;
};

/** The manifest written into every backup zip. */
export type BackupManifest = {
  version: typeof BACKUP_FORMAT_VERSION;
  kind: typeof BACKUP_KIND;
  /** ISO 8601 */
  createdAt: string;
  openaidyVersion: string;
  sections: Record<BackupSection, BackupSectionSummary>;
};

/** Response body of `GET /api/backups/manifest` (live snapshot of OPENAIDY_HOME). */
export type BackupManifestResponse = {
  manifest: BackupManifest;
};

/** Response body of `POST /api/backups/preview`. */
export type BackupPreview = {
  manifest: BackupManifest;
  zipSizeBytes: number;
};

/** Request body of `POST /api/backups/export` (omit `sections` for all). */
export type ExportRequest = {
  sections?: BackupSection[];
};

/** Request body of `POST /api/backups/import`. */
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

/** Response body of `POST /api/backups/import`. */
export type ImportResponse = {
  results: ImportedSection[];
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
