/**
 * Backup routes — export/import of OpenAidy data (issue #451).
 *
 *   GET    /backups/manifest              — live snapshot of what a full backup would contain
 *   POST   /backups/exports               — start building a backup zip (background job)
 *   GET    /backups/exports/:id/download  — download a finished export (Range-capable)
 *   POST   /backups/uploads               — stage an uploaded zip on disk + read its manifest
 *   DELETE /backups/uploads/:id           — discard a staged upload
 *   POST   /backups/uploads/:id/import    — apply selected sections (background job)
 *   GET    /backups/jobs/:id              — poll a job's progress / result
 *   DELETE /backups/jobs/:id              — cancel a running export, or discard a finished job
 *
 * Everything except the download is admin-scoped: a backup exposes provider
 * API keys and an import can replace the whole database. The download is
 * fetched natively by the browser (so it streams to disk and can resume),
 * which can't attach an Authorization header — it's authorized instead by an
 * unguessable per-export key that only an admin ever receives.
 */

import fs from 'node:fs';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import {
  BACKUP_SECTIONS,
  type BackupSection,
  type BackupManifestResponse,
  type BackupJobResponse,
  type BackupUpload,
} from '@openaidy/shared-types';
import type { BackupService } from './service';
import {
  BackupBusyError,
  InsufficientSpaceError,
  InvalidBackupError,
  type BackupJobManager,
} from './jobs';

const ADMIN_SCOPE = '*';

/**
 * Sanity ceiling on an uploaded backup. The real limit is free disk space,
 * enforced while the upload streams to disk.
 */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024 * 1024; // 200 GB

export type BackupRoutesOptions = {
  backupService: BackupService;
  jobs: BackupJobManager;
  authMiddleware: AuthMiddleware;
  /** Directory imports write into — used for the free-space check. */
  restoreRoot: string;
};

function isBackupSection(v: unknown): v is BackupSection {
  return (
    typeof v === 'string' && (BACKUP_SECTIONS as readonly string[]).includes(v)
  );
}

/** Parse + validate the `sections` list from a request (array of section names). */
function parseSections(raw: unknown): BackupSection[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: BackupSection[] = [];
  for (const s of raw) {
    if (!isBackupSection(s)) return null;
    out.push(s);
  }
  return out;
}

/** Map job-manager errors onto HTTP responses; rethrow anything else. */
function sendJobError(reply: FastifyReply, err: unknown) {
  if (err instanceof BackupBusyError) {
    return reply.code(409).send({ error: err.message });
  }
  if (err instanceof InsufficientSpaceError) {
    return reply.code(507).send({ error: err.message });
  }
  if (err instanceof InvalidBackupError) {
    return reply.code(400).send({ error: err.message });
  }
  throw err;
}

/** Parse a single-range `Range: bytes=…` header against a file size. */
function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined; // multi-range or junk: serve the whole file
  const [, a, b] = m;
  let start: number;
  let end: number;
  if (a === '') {
    if (b === '') return undefined;
    start = Math.max(0, size - Number(b));
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

export const backupRoutes: FastifyPluginAsync<BackupRoutesOptions> = async (
  app,
  options,
) => {
  const { backupService, jobs, authMiddleware, restoreRoot } = options;

  // GET /backups/exports/:id/download — key-authorized, outside the admin hook.
  app.get<{ Params: { id: string }; Querystring: { key?: string } }>(
    '/backups/exports/:id/download',
    async (request, reply) => {
      const file = jobs.getExportFile(
        request.params.id,
        request.query.key ?? '',
      );
      if (!file) {
        return reply
          .code(404)
          .send({ error: 'Backup not found or download link expired' });
      }

      const size = file.sizeBytes;
      const etag = `"${request.params.id}-${size}"`;
      const filename = `openaidy-backup-${file.createdAt.slice(0, 10)}.zip`;
      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Accept-Ranges', 'bytes')
        .header('ETag', etag)
        .header('Last-Modified', new Date(file.createdAt).toUTCString())
        .header('Cache-Control', 'private, no-store');

      const rangeHeader = request.headers.range;
      const ifRange = request.headers['if-range'];
      const range =
        rangeHeader && (!ifRange || ifRange === etag)
          ? parseRange(rangeHeader, size)
          : undefined;

      if (range === 'unsatisfiable') {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${size}`)
          .send();
      }
      if (range) {
        return reply
          .code(206)
          .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
          .header('Content-Length', range.end - range.start + 1)
          .send(
            fs.createReadStream(file.filePath, {
              start: range.start,
              end: range.end,
            }),
          );
      }
      return reply
        .header('Content-Length', size)
        .send(fs.createReadStream(file.filePath));
    },
  );

  await app.register(async (admin) => {
    // Scoped to this plugin: only backup upload endpoints parse multipart.
    await admin.register(multipart, {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });

    admin.addHook(
      'preHandler',
      requireAuth({ authMiddleware, requiredScope: ADMIN_SCOPE }),
    );

    // GET /backups/manifest — live snapshot for the Export tab.
    admin.get('/backups/manifest', async () => {
      const manifest = await backupService.buildManifest();
      return { manifest } satisfies BackupManifestResponse;
    });

    // POST /backups/exports — start building a zip of the selected sections.
    admin.post<{
      Body: { sections?: unknown; includeHeavyFolders?: unknown } | undefined;
    }>('/backups/exports', async (request, reply) => {
      const sections = parseSections(request.body?.sections);
      if (sections === null) {
        return reply.code(400).send({
          error: 'Invalid sections; expected an array of section names',
        });
      }
      try {
        const job = await jobs.startExport({
          sections,
          includeHeavyFolders: request.body?.includeHeavyFolders === true,
        });
        return reply.code(202).send({ job } satisfies BackupJobResponse);
      } catch (err) {
        return sendJobError(reply, err);
      }
    });

    // GET /backups/jobs/:id — progress / result.
    admin.get<{ Params: { id: string } }>(
      '/backups/jobs/:id',
      async (request, reply) => {
        const job = jobs.getJob(request.params.id);
        if (!job) return reply.code(404).send({ error: 'Job not found' });
        return { job } satisfies BackupJobResponse;
      },
    );

    // DELETE /backups/jobs/:id — cancel (export) or discard.
    admin.delete<{ Params: { id: string } }>(
      '/backups/jobs/:id',
      async (request, reply) => {
        const found = await jobs.cancelJob(request.params.id);
        if (!found) return reply.code(404).send({ error: 'Job not found' });
        return reply.code(204).send();
      },
    );

    // POST /backups/uploads — stream the zip to disk and read its manifest.
    admin.post('/backups/uploads', async (request, reply) => {
      if (!request.isMultipart()) {
        return reply
          .code(400)
          .send({ error: 'Expected multipart/form-data with a file field' });
      }
      const filePart = await request.file();
      if (!filePart) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }
      const declared = Number(request.headers['content-length']);
      try {
        const upload = await jobs.stageUpload(
          filePart.file,
          Number.isFinite(declared) && declared > 0 ? declared : undefined,
        );
        if (filePart.file.truncated) {
          await jobs.discardUpload(upload.id);
          return reply.code(413).send({ error: 'Backup file is too large' });
        }
        return reply.code(201).send(upload satisfies BackupUpload);
      } catch (err) {
        // Drain whatever the client is still sending so it sees the error
        // response instead of a reset connection.
        filePart.file.resume();
        return sendJobError(reply, err);
      }
    });

    // DELETE /backups/uploads/:id — discard a staged upload.
    admin.delete<{ Params: { id: string } }>(
      '/backups/uploads/:id',
      async (request, reply) => {
        const found = await jobs.discardUpload(request.params.id);
        if (!found) return reply.code(404).send({ error: 'Upload not found' });
        return reply.code(204).send();
      },
    );

    // POST /backups/uploads/:id/import — apply sections in the background.
    admin.post<{ Params: { id: string }; Body: { sections?: unknown } }>(
      '/backups/uploads/:id/import',
      async (request, reply) => {
        const sections = parseSections(request.body?.sections);
        if (sections === null) {
          return reply.code(400).send({ error: 'Invalid sections field' });
        }
        if (sections.length === 0) {
          return reply
            .code(400)
            .send({ error: 'No sections selected to import' });
        }
        try {
          const job = await jobs.startImport(
            request.params.id,
            sections,
            restoreRoot,
          );
          if (!job) {
            return reply
              .code(404)
              .send({ error: 'Upload not found or expired; upload it again' });
          }
          return reply.code(202).send({ job } satisfies BackupJobResponse);
        } catch (err) {
          return sendJobError(reply, err);
        }
      },
    );
  });
};
