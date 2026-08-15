/**
 * Backup routes — export/import of OpenAidy data (issue #451).
 *
 *   GET  /backups/manifest  — live snapshot of what a full backup would contain
 *   POST /backups/export    — stream a .zip of the selected sections
 *   POST /backups/preview   — read an uploaded zip's manifest (no changes)
 *   POST /backups/import    — apply selected sections from an uploaded zip
 *
 * All endpoints are admin-scoped: a backup exposes provider API keys and an
 * import can replace the whole database.
 */

import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import AdmZip from 'adm-zip';
import type { AuthMiddleware } from '../websocket/middleware/auth';
import { requireAuth } from '../middleware/require-auth';
import {
  BACKUP_SECTIONS,
  type BackupSection,
  type BackupManifestResponse,
  type BackupPreview,
  type ImportResponse,
  type ImportedSection,
} from '@openaidy/shared-types';
import type { BackupService } from './service';

const ADMIN_SCOPE = '*';

/** Hard ceiling on an uploaded backup (compressed) — guards memory/DoS. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB
/** Hard ceiling on total uncompressed size — guards against zip bombs. */
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export type BackupRoutesOptions = {
  backupService: BackupService;
  authMiddleware: AuthMiddleware;
};

function isBackupSection(v: unknown): v is BackupSection {
  return (
    typeof v === 'string' && (BACKUP_SECTIONS as readonly string[]).includes(v)
  );
}

/** Parse + validate the `sections` list from a request (array of section names). */
function parseSections(raw: unknown): BackupSection[] | null {
  if (raw === undefined || raw === null) return [];
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const out: BackupSection[] = [];
  for (const s of arr) {
    if (!isBackupSection(s)) return null;
    out.push(s);
  }
  return out;
}

/** Open a zip buffer and reject obvious zip bombs before we decompress entries. */
function openZipGuarded(buffer: Buffer): AdmZip {
  const zip = new AdmZip(buffer);
  let total = 0;
  for (const entry of zip.getEntries()) {
    total += entry.header.size;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('Backup exceeds the maximum uncompressed size');
    }
  }
  return zip;
}

export const backupRoutes: FastifyPluginAsync<BackupRoutesOptions> = async (
  app,
  options,
) => {
  const { backupService, authMiddleware } = options;

  // Scoped to this plugin: only backup upload endpoints parse multipart.
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  app.addHook(
    'preHandler',
    requireAuth({ authMiddleware, requiredScope: ADMIN_SCOPE }),
  );

  // GET /backups/manifest — live snapshot for the Export tab.
  app.get('/backups/manifest', async () => {
    const manifest = backupService.buildManifest();
    return { manifest } satisfies BackupManifestResponse;
  });

  // POST /backups/export — stream a zip of the selected sections (all if omitted).
  app.post<{ Body: { sections?: BackupSection[] } | undefined }>(
    '/backups/export',
    async (request, reply) => {
      const sections = parseSections(request.body?.sections);
      if (sections === null) {
        return reply.code(400).send({
          error: 'Invalid sections; expected an array of section names',
        });
      }

      const date = new Date().toISOString().slice(0, 10);
      const filename = `openaidy-backup-${date}.zip`;

      reply.raw.setHeader('Content-Type', 'application/zip');
      reply.raw.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      // We write directly to the raw stream; take over the response lifecycle.
      reply.hijack();
      try {
        await backupService.buildZip(sections, reply.raw);
      } catch (err) {
        request.log.error({ err }, 'Backup export failed');
        // Headers are already sent; just tear the connection down.
        reply.raw.destroy();
      }
    },
  );

  // POST /backups/preview — read an uploaded zip's manifest without applying it.
  app.post('/backups/preview', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply
        .code(400)
        .send({ error: 'Expected multipart/form-data with a file field' });
    }
    const filePart = await request.file();
    if (!filePart) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }
    const buffer = await filePart.toBuffer();
    try {
      openZipGuarded(buffer);
      const manifest = backupService.readManifest(buffer);
      return {
        manifest,
        zipSizeBytes: buffer.length,
      } satisfies BackupPreview;
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Invalid backup file',
      });
    }
  });

  // POST /backups/import — apply selected sections from an uploaded zip.
  app.post('/backups/import', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply
        .code(400)
        .send({ error: 'Expected multipart/form-data with file + sections' });
    }

    let buffer: Buffer | undefined;
    let sectionsRaw: string | undefined;
    // Iterate parts to capture both the file and the `sections` field.
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        buffer = await part.toBuffer();
      } else if (part.fieldname === 'sections') {
        sectionsRaw = String(part.value);
      }
    }

    if (!buffer) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }
    const sections = parseSections(sectionsRaw);
    if (sections === null) {
      return reply.code(400).send({ error: 'Invalid sections field' });
    }
    if (sections.length === 0) {
      return reply.code(400).send({ error: 'No sections selected to import' });
    }

    let zip: AdmZip;
    try {
      zip = openZipGuarded(buffer);
      // Validate it's a real backup before touching the filesystem.
      backupService.readManifest(buffer);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Invalid backup file',
      });
    }

    const results: ImportedSection[] = [];
    for (const section of sections) {
      try {
        results.push(await backupService.applySection(section, zip));
      } catch (err) {
        results.push({
          section,
          success: false,
          error: err instanceof Error ? err.message : 'Import failed',
          itemsImported: 0,
        });
      }
    }

    return { results } satisfies ImportResponse;
  });
};
