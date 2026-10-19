/**
 * Background backup jobs.
 *
 * Exports and imports run outside the HTTP request that started them, so a
 * dropped connection, a proxy timeout or a closed tab no longer throws away
 * minutes of work. The client polls job state; a finished export is a file on
 * disk the browser downloads natively (resumable via Range requests).
 *
 * Only one job runs at a time (they are disk/CPU heavy), and only one
 * finished export and one staged upload are kept around, so a small droplet
 * doesn't fill its disk with stale backups.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  BackupJob,
  BackupSection,
  BackupUpload,
} from '@openaidy/shared-types';
import type { BackupService } from './service';

/** Raised when a job can't start because another one is running. */
export class BackupBusyError extends Error {
  constructor() {
    super('Another backup or restore is already running');
    this.name = 'BackupBusyError';
  }
}

/** Raised when the disk can't hold what's about to be written. */
export class InsufficientSpaceError extends Error {
  constructor(neededBytes: number, freeBytes: number) {
    super(
      `Not enough free disk space: needs about ${formatMb(neededBytes)}, ` +
        `${formatMb(freeBytes)} available`,
    );
    this.name = 'InsufficientSpaceError';
  }
}

/** Raised for an upload that isn't a usable backup archive. */
export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

export type BackupJobManagerOptions = {
  service: BackupService;
  /** Scratch dir for export zips, db snapshots and staged uploads. */
  tmpDir: string;
  /** Builds the download URL handed to the client for a finished export. */
  downloadUrlFor: (jobId: string, key: string) => string;
  /** How long a finished export stays downloadable. Default 1 hour. */
  exportTtlMs?: number;
  /** How long a staged upload waits for its import. Default 1 hour. */
  uploadTtlMs?: number;
  /** Free space always left untouched on the disk. Default 256 MB. */
  reserveBytes?: number;
  /** Free-space probe; injectable for tests. */
  freeBytes?: (dir: string) => Promise<number>;
};

type JobRecord = {
  job: BackupJob;
  abort: AbortController;
  /** export: the finished zip. */
  filePath?: string | undefined;
  /** export: secret that authorizes the download URL. */
  key?: string;
  timer?: NodeJS.Timeout;
};

type UploadRecord = {
  upload: BackupUpload;
  filePath: string;
  sectionBytes: Record<BackupSection, number>;
  timer?: NodeJS.Timeout;
  importing: boolean;
};

const HOUR_MS = 60 * 60 * 1000;

function formatMb(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

/** Nearest existing ancestor of `p` (statfs needs a real path). */
function existingAncestor(p: string): string {
  let current = path.resolve(p);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const stats = await fs.promises.statfs(existingAncestor(dir));
  return stats.bavail * stats.bsize;
}

function friendlyError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOSPC') return 'Ran out of disk space';
  return err instanceof Error ? err.message : String(err);
}

export class BackupJobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly uploads = new Map<string, UploadRecord>();
  private readonly exportTtlMs: number;
  private readonly uploadTtlMs: number;
  private readonly reserveBytes: number;
  private readonly freeBytes: (dir: string) => Promise<number>;

  constructor(private readonly opts: BackupJobManagerOptions) {
    this.exportTtlMs = opts.exportTtlMs ?? HOUR_MS;
    this.uploadTtlMs = opts.uploadTtlMs ?? HOUR_MS;
    this.reserveBytes = opts.reserveBytes ?? 256 * 1024 * 1024;
    this.freeBytes = opts.freeBytes ?? defaultFreeBytes;
  }

  /** Remove leftovers from a previous process (crash, restart mid-job). */
  async init(): Promise<void> {
    await fs.promises.rm(this.opts.tmpDir, { recursive: true, force: true });
    await fs.promises.mkdir(this.opts.tmpDir, { recursive: true });
  }

  /** Cancel running work and delete every temp file. */
  async dispose(): Promise<void> {
    for (const rec of this.jobs.values()) {
      rec.abort.abort();
      if (rec.timer) clearTimeout(rec.timer);
    }
    for (const rec of this.uploads.values()) {
      if (rec.timer) clearTimeout(rec.timer);
    }
    this.jobs.clear();
    this.uploads.clear();
    await fs.promises.rm(this.opts.tmpDir, { recursive: true, force: true });
  }

  getJob(id: string): BackupJob | undefined {
    const rec = this.jobs.get(id);
    return rec ? this.view(rec) : undefined;
  }

  private view(rec: JobRecord): BackupJob {
    const job = { ...rec.job };
    if (job.kind === 'export' && job.status === 'succeeded' && rec.key) {
      job.downloadUrl = this.opts.downloadUrlFor(job.id, rec.key);
    }
    return job;
  }

  private assertIdle(): void {
    for (const rec of this.jobs.values()) {
      if (rec.job.status === 'running') throw new BackupBusyError();
    }
  }

  private newJob(kind: BackupJob['kind'], phase: string): JobRecord {
    const rec: JobRecord = {
      job: {
        id: randomUUID(),
        kind,
        status: 'running',
        phase,
        processedBytes: 0,
        totalBytes: 0,
        startedAt: new Date().toISOString(),
      },
      abort: new AbortController(),
    };
    this.jobs.set(rec.job.id, rec);
    return rec;
  }

  /** Drop a job record and its file. */
  private async forget(id: string): Promise<void> {
    const rec = this.jobs.get(id);
    if (!rec) return;
    this.jobs.delete(id);
    if (rec.timer) clearTimeout(rec.timer);
    if (rec.filePath) await fs.promises.rm(rec.filePath, { force: true });
  }

  private finish(
    rec: JobRecord,
    status: BackupJob['status'],
    extra: Partial<BackupJob> = {},
  ): void {
    Object.assign(rec.job, extra, {
      status,
      finishedAt: new Date().toISOString(),
    });
    // Keep finished job state around long enough for the client to read it
    // (and, for an export, to download the file), then clean up.
    const ttl = rec.job.kind === 'export' ? this.exportTtlMs : this.uploadTtlMs;
    rec.timer = setTimeout(() => void this.forget(rec.job.id), ttl);
    rec.timer.unref();
  }

  // ── Export ──────────────────────────────────────────────────────────────

  async startExport(request: {
    sections: BackupSection[];
    includeHeavyFolders?: boolean;
  }): Promise<BackupJob> {
    this.assertIdle();
    // One finished export on disk at a time.
    for (const rec of [...this.jobs.values()]) {
      if (rec.job.kind === 'export') await this.forget(rec.job.id);
    }

    const free = await this.freeBytes(this.opts.tmpDir);
    if (free < this.reserveBytes) {
      throw new InsufficientSpaceError(this.reserveBytes, free);
    }

    const rec = this.newJob('export', 'Starting');
    const filePath = path.join(this.opts.tmpDir, `export-${rec.job.id}.zip`);
    rec.filePath = filePath;

    void this.opts.service
      .writeArchive({
        sections: request.sections,
        includeHeavyFolders: request.includeHeavyFolders,
        destPath: filePath,
        workDir: this.opts.tmpDir,
        signal: rec.abort.signal,
        onProgress: (p) => Object.assign(rec.job, p),
      })
      .then(
        ({ sizeBytes }) => {
          rec.key = randomBytes(24).toString('base64url');
          this.finish(rec, 'succeeded', {
            phase: 'Ready to download',
            fileSizeBytes: sizeBytes,
            expiresAt: new Date(Date.now() + this.exportTtlMs).toISOString(),
          });
        },
        (err: unknown) => {
          rec.filePath = undefined;
          if (rec.abort.signal.aborted) {
            this.finish(rec, 'cancelled', { phase: 'Cancelled' });
          } else {
            this.finish(rec, 'failed', {
              phase: 'Failed',
              error: friendlyError(err),
            });
          }
        },
      );

    return this.view(rec);
  }

  /** The finished export a download URL refers to, if the key matches. */
  getExportFile(
    id: string,
    key: string,
  ): { filePath: string; sizeBytes: number; createdAt: string } | undefined {
    const rec = this.jobs.get(id);
    if (
      !rec ||
      rec.job.kind !== 'export' ||
      rec.job.status !== 'succeeded' ||
      !rec.filePath ||
      !rec.key ||
      !safeEqual(rec.key, key)
    ) {
      return undefined;
    }
    return {
      filePath: rec.filePath,
      sizeBytes: rec.job.fileSizeBytes ?? 0,
      createdAt: rec.job.startedAt,
    };
  }

  /**
   * Cancel a running job, or discard a finished one (deleting its file).
   * Returns false if the job doesn't exist.
   */
  async cancelJob(id: string): Promise<boolean> {
    const rec = this.jobs.get(id);
    if (!rec) return false;
    if (rec.job.status === 'running') {
      // Imports can't be safely stopped halfway; only exports abort.
      if (rec.job.kind === 'export') rec.abort.abort();
      return true;
    }
    await this.forget(id);
    return true;
  }

  // ── Import ──────────────────────────────────────────────────────────────

  /**
   * Stream an uploaded backup to disk and validate it. The upload never sits
   * in memory; it's refused as soon as it would eat into the disk reserve.
   */
  async stageUpload(
    source: Readable,
    declaredBytes?: number,
  ): Promise<BackupUpload> {
    this.assertIdle();
    // One staged upload at a time.
    for (const [id, rec] of [...this.uploads]) {
      if (!rec.importing) await this.discardUpload(id);
    }

    const free = await this.freeBytes(this.opts.tmpDir);
    const budget = free - this.reserveBytes;
    if (declaredBytes !== undefined && declaredBytes > budget) {
      throw new InsufficientSpaceError(declaredBytes, Math.max(0, budget));
    }

    const id = randomUUID();
    const filePath = path.join(this.opts.tmpDir, `upload-${id}.zip`);
    let written = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > budget) {
          cb(new InsufficientSpaceError(written, Math.max(0, budget)));
        } else {
          cb(null, chunk);
        }
      },
    });

    try {
      await pipeline(source, meter, fs.createWriteStream(filePath));
    } catch (err) {
      await fs.promises.rm(filePath, { force: true });
      throw err;
    }

    let info;
    try {
      info = await this.opts.service.inspectArchive(filePath);
    } catch (err) {
      await fs.promises.rm(filePath, { force: true });
      throw new InvalidBackupError(
        err instanceof Error ? err.message : 'Invalid backup file',
      );
    }

    const upload: BackupUpload = {
      id,
      manifest: info.manifest,
      zipSizeBytes: written,
      expiresAt: new Date(Date.now() + this.uploadTtlMs).toISOString(),
    };
    const rec: UploadRecord = {
      upload,
      filePath,
      sectionBytes: info.sectionBytes,
      importing: false,
    };
    rec.timer = setTimeout(() => {
      if (!rec.importing) void this.discardUpload(id);
    }, this.uploadTtlMs);
    rec.timer.unref();
    this.uploads.set(id, rec);
    return upload;
  }

  getUpload(id: string): BackupUpload | undefined {
    return this.uploads.get(id)?.upload;
  }

  async discardUpload(id: string): Promise<boolean> {
    const rec = this.uploads.get(id);
    if (!rec) return false;
    this.uploads.delete(id);
    if (rec.timer) clearTimeout(rec.timer);
    await fs.promises.rm(rec.filePath, { force: true });
    return true;
  }

  /** Start applying sections from a staged upload. */
  async startImport(
    uploadId: string,
    sections: BackupSection[],
    destDir: string,
  ): Promise<BackupJob | undefined> {
    const upload = this.uploads.get(uploadId);
    if (!upload) return undefined;
    this.assertIdle();

    const needed = sections.reduce((n, s) => n + upload.sectionBytes[s], 0);
    const free = await this.freeBytes(destDir);
    if (needed + this.reserveBytes > free) {
      throw new InsufficientSpaceError(
        needed,
        Math.max(0, free - this.reserveBytes),
      );
    }

    upload.importing = true;
    const rec = this.newJob('import', 'Starting');
    rec.job.totalBytes = needed;

    void this.opts.service
      .applyArchive(upload.filePath, sections, {
        signal: rec.abort.signal,
        onProgress: (p) => Object.assign(rec.job, p),
      })
      .then(
        (results) => {
          const ok = results.every((r) => r.success);
          this.finish(rec, ok ? 'succeeded' : 'failed', {
            phase: ok ? 'Restore complete' : 'Restore finished with errors',
            results,
            ...(ok ? {} : { error: 'Some sections failed to restore' }),
          });
        },
        (err: unknown) => {
          this.finish(rec, 'failed', {
            phase: 'Failed',
            error: friendlyError(err),
          });
        },
      )
      .finally(() => void this.discardUpload(uploadId));

    return this.view(rec);
  }
}

/** Constant-time string compare for download keys. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
