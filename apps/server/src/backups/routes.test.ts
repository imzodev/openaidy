import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { BackupJob } from '@openaidy/shared-types';
import { backupRoutes } from './routes';
import { BackupService, type BackupPaths } from './service';
import { BackupJobManager } from './jobs';
import { AuthMiddleware } from '../websocket/middleware/auth';

const mockAuthMiddleware = {
  validateToken: async (token: string) =>
    token === 'test-token'
      ? {
          sub: 'test',
          scopes: ['*'],
          type: 'access' as const,
          iat: 0,
          exp: 9999999999,
        }
      : null,
  extractFromHeader: (h: string) => h.replace(/^Bearer /, ''),
  extractFromQuery: () => null,
  hasCapability: () => true,
} as unknown as AuthMiddleware;

const AUTH = { authorization: 'Bearer test-token' };

/** Build a multipart/form-data body from a file part + string fields. */
function multipart(
  file: { field: string; filename: string; content: Buffer } | null,
  fields: Record<string, string> = {},
): { body: Buffer; contentType: string } {
  const boundary = '----oaidytest' + Math.random().toString(36).slice(2);
  const chunks: Buffer[] = [];
  const CRLF = '\r\n';
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`,
      ),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"${CRLF}Content-Type: application/zip${CRLF}${CRLF}`,
      ),
    );
    chunks.push(file.content);
    chunks.push(Buffer.from(CRLF));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

let home: string;
let paths: BackupPaths;
let service: BackupService;
let jobs: BackupJobManager;
let app: FastifyInstance;
let freeBytes: number;

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

async function waitForJob(id: string): Promise<BackupJob> {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/backups/jobs/${id}`,
      headers: AUTH,
    });
    const { job } = res.json() as { job: BackupJob };
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job never finished');
}

async function finishedExport(payload: object = {}): Promise<BackupJob> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/backups/exports',
    headers: AUTH,
    payload,
  });
  expect(res.statusCode).toBe(202);
  return waitForJob(res.json().job.id);
}

async function exportedZip(payload: object = {}): Promise<Buffer> {
  const job = await finishedExport(payload);
  const res = await app.inject({ method: 'GET', url: job.downloadUrl! });
  expect(res.statusCode).toBe(200);
  return res.rawPayload;
}

async function upload(content: Buffer) {
  const { body, contentType } = multipart({
    field: 'file',
    filename: 'b.zip',
    content,
  });
  return app.inject({
    method: 'POST',
    url: '/api/backups/uploads',
    headers: { ...AUTH, 'content-type': contentType },
    payload: body,
  });
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-broutes-'));
  paths = {
    dbPath: path.join(home, 'data', 'openaidy.db'),
    configPath: path.join(home, 'openaidy.json'),
    workspacesDir: path.join(home, 'workspaces'),
    skillsDir: path.join(home, 'skills'),
    addonsDir: path.join(home, 'addons'),
  };
  fs.mkdirSync(path.dirname(paths.dbPath), { recursive: true });
  const db = new DatabaseSync(paths.dbPath);
  db.exec('CREATE TABLE t (v INTEGER); INSERT INTO t VALUES (1);');
  db.close();
  write(paths.configPath, '{"providers":[]}');
  write(path.join(paths.skillsDir, 's1', 'SKILL.md'), '# s');
  service = new BackupService(paths, '0.3.8');
  freeBytes = Number.MAX_SAFE_INTEGER;
  jobs = new BackupJobManager({
    service,
    tmpDir: path.join(home, 'tmp', 'backups'),
    downloadUrlFor: (id, key) =>
      `/api/backups/exports/${id}/download?key=${key}`,
    freeBytes: async () => freeBytes,
  });
  await jobs.init();

  app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(
    async (api) => {
      await api.register(backupRoutes, {
        backupService: service,
        jobs,
        authMiddleware: mockAuthMiddleware,
        restoreRoot: home,
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await jobs.dispose();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('GET /api/backups/manifest', () => {
  it('returns the live manifest', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/backups/manifest',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.manifest.kind).toBe('openaidy-backup');
    expect(body.manifest.sections.config.itemCount).toBe(1);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/backups/manifest',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('exports', () => {
  it('builds a zip in the background and serves it via the download URL', async () => {
    const job = await finishedExport();
    expect(job).toMatchObject({ kind: 'export', status: 'succeeded' });
    expect(job.fileSizeBytes).toBeGreaterThan(0);

    const res = await app.inject({ method: 'GET', url: job.downloadUrl! });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-disposition']).toMatch(
      /openaidy-backup-.*\.zip/,
    );
    expect(res.rawPayload.length).toBe(job.fileSizeBytes);
    // PK zip magic bytes.
    expect(res.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('serves byte ranges so interrupted downloads can resume', async () => {
    const job = await finishedExport();
    const full = (await app.inject({ method: 'GET', url: job.downloadUrl! }))
      .rawPayload;

    const res = await app.inject({
      method: 'GET',
      url: job.downloadUrl!,
      headers: { range: 'bytes=10-' },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe(
      `bytes 10-${full.length - 1}/${full.length}`,
    );
    expect(res.rawPayload.equals(full.subarray(10))).toBe(true);

    const bad = await app.inject({
      method: 'GET',
      url: job.downloadUrl!,
      headers: { range: `bytes=${full.length + 5}-` },
    });
    expect(bad.statusCode).toBe(416);
  });

  it('rejects a download with the wrong key', async () => {
    const job = await finishedExport();
    const res = await app.inject({
      method: 'GET',
      url: `/api/backups/exports/${job.id}/download?key=nope`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('honors the section filter and heavy-folder flag', async () => {
    write(path.join(paths.workspacesDir, 'w', 'node_modules', 'x.js'), 'x');
    const lean = await exportedZip({ sections: ['workspaces'] });
    expect(lean.includes('node_modules/x.js')).toBe(false);
    const full = await exportedZip({
      sections: ['workspaces'],
      includeHeavyFolders: true,
    });
    expect(full.includes('node_modules/x.js')).toBe(true);
    expect(full.includes('skills/s1')).toBe(false);
  });

  it('rejects an invalid sections value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/exports',
      headers: AUTH,
      payload: { sections: ['nope'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a second job while one is running', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/backups/exports',
      headers: AUTH,
      payload: {},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/backups/exports',
      headers: AUTH,
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    await waitForJob(first.json().job.id);
  });

  it('refuses to start when the disk is nearly full', async () => {
    freeBytes = 1024;
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/exports',
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(507);
  });

  it('discards a finished export, invalidating its download URL', async () => {
    const job = await finishedExport();
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/backups/jobs/${job.id}`,
      headers: AUTH,
    });
    expect(del.statusCode).toBe(204);
    const res = await app.inject({ method: 'GET', url: job.downloadUrl! });
    expect(res.statusCode).toBe(404);
  });
});

describe('uploads + import', () => {
  it('stages a valid backup and returns its manifest', async () => {
    const res = await upload(await exportedZip());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.manifest.kind).toBe('openaidy-backup');
    expect(body.zipSizeBytes).toBeGreaterThan(0);
  });

  it('rejects a non-zip file with 400', async () => {
    const res = await upload(Buffer.from('not a zip at all'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/zip/i);
  });

  it('rejects an upload larger than the free disk space with 507', async () => {
    const zip = await exportedZip();
    freeBytes = 256 * 1024 * 1024 + 10; // reserve + a few bytes
    const res = await upload(zip);
    expect(res.statusCode).toBe(507);
  });

  it('applies the requested sections as a job and reports per-section results', async () => {
    const zip = await exportedZip();
    write(paths.configPath, '{"changed":true}');
    fs.rmSync(paths.skillsDir, { recursive: true, force: true });

    const staged = (await upload(zip)).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/uploads/${staged.id}/import`,
      headers: AUTH,
      payload: { sections: ['config', 'skills'] },
    });
    expect(res.statusCode).toBe(202);
    const job = await waitForJob(res.json().job.id);

    expect(job.status).toBe('succeeded');
    expect(job.results).toEqual([
      expect.objectContaining({ section: 'config', success: true }),
      expect.objectContaining({ section: 'skills', success: true }),
    ]);
    expect(fs.readFileSync(paths.configPath, 'utf-8')).toBe('{"providers":[]}');
    expect(fs.existsSync(path.join(paths.skillsDir, 's1', 'SKILL.md'))).toBe(
      true,
    );

    // The staged upload is consumed by the import.
    const again = await app.inject({
      method: 'POST',
      url: `/api/backups/uploads/${staged.id}/import`,
      headers: AUTH,
      payload: { sections: ['config'] },
    });
    expect(again.statusCode).toBe(404);
  });

  it('rejects import with no sections', async () => {
    const staged = (await upload(await exportedZip())).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/uploads/${staged.id}/import`,
      headers: AUTH,
      payload: { sections: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown section', async () => {
    const staged = (await upload(await exportedZip())).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/uploads/${staged.id}/import`,
      headers: AUTH,
      payload: { sections: ['bogus'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown or discarded upload', async () => {
    const staged = (await upload(await exportedZip())).json();
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/backups/uploads/${staged.id}`,
      headers: AUTH,
    });
    expect(del.statusCode).toBe(204);
    const res = await app.inject({
      method: 'POST',
      url: `/api/backups/uploads/${staged.id}/import`,
      headers: AUTH,
      payload: { sections: ['config'] },
    });
    expect(res.statusCode).toBe(404);
  });
});
