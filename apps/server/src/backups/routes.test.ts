import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import AdmZip from 'adm-zip';
import { backupRoutes } from './routes';
import { BackupService, type BackupPaths } from './service';
import { AuthMiddleware } from '../websocket/middleware/auth';

const mockAuthMiddleware = {
  validateToken: async () => ({
    sub: 'test',
    scopes: ['*'],
    type: 'access' as const,
    iat: 0,
    exp: 9999999999,
  }),
  extractFromHeader: (_h: string) => 'test-token',
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
let app: FastifyInstance;

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

async function validBackupBuffer(): Promise<Buffer> {
  const zipPath = path.join(home, 'valid.zip');
  await service.buildZip([], fs.createWriteStream(zipPath));
  return fs.readFileSync(zipPath);
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
  write(paths.dbPath, 'DB');
  write(paths.configPath, '{"providers":[]}');
  write(path.join(paths.skillsDir, 's1', 'SKILL.md'), '# s');
  service = new BackupService(paths, '0.3.8');

  app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(
    async (api) => {
      await api.register(backupRoutes, {
        backupService: service,
        authMiddleware: mockAuthMiddleware,
      });
    },
    { prefix: '/api' },
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
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
});

describe('POST /api/backups/export', () => {
  it('returns a zip archive', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/export',
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    // PK zip magic bytes.
    expect(res.rawPayload.slice(0, 2).toString('latin1')).toBe('PK');
  });

  it('honors a section filter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/export',
      headers: AUTH,
      payload: { sections: ['config'] },
    });
    expect(res.statusCode).toBe(200);
    const zip = new AdmZip(res.rawPayload);
    expect(zip.getEntry('config/openaidy.json')).toBeTruthy();
    expect(zip.getEntry('skills/s1/SKILL.md')).toBeFalsy();
  });

  it('rejects an invalid sections value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/export',
      headers: AUTH,
      payload: { sections: ['nope'] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/backups/preview', () => {
  it('returns the manifest for a valid backup zip', async () => {
    const buf = await validBackupBuffer();
    const { body, contentType } = multipart({
      field: 'file',
      filename: 'backup.zip',
      content: buf,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/preview',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.manifest.kind).toBe('openaidy-backup');
    expect(json.zipSizeBytes).toBe(buf.length);
  });

  it('rejects a non-zip file with 400', async () => {
    const { body, contentType } = multipart({
      field: 'file',
      filename: 'x.zip',
      content: Buffer.from('not a zip'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/preview',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a zip missing manifest.json with 400', async () => {
    const zip = new AdmZip();
    zip.addFile('db/openaidy.db', Buffer.from('x'));
    const { body, contentType } = multipart({
      field: 'file',
      filename: 'x.zip',
      content: zip.toBuffer(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/preview',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/backups/import', () => {
  it('applies the requested sections and returns per-section results', async () => {
    const buf = await validBackupBuffer();
    // Restore into a different home so we can assert files were written.
    const destHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-dest-'));
    const destService = new BackupService(
      {
        dbPath: path.join(destHome, 'data', 'openaidy.db'),
        configPath: path.join(destHome, 'openaidy.json'),
        workspacesDir: path.join(destHome, 'workspaces'),
        skillsDir: path.join(destHome, 'skills'),
        addonsDir: path.join(destHome, 'addons'),
      },
      '0.3.8',
    );
    const destApp = Fastify({ logger: false });
    await destApp.register(sensible);
    await destApp.register(
      async (api) => {
        await api.register(backupRoutes, {
          backupService: destService,
          authMiddleware: mockAuthMiddleware,
        });
      },
      { prefix: '/api' },
    );
    await destApp.ready();

    const { body, contentType } = multipart(
      { field: 'file', filename: 'backup.zip', content: buf },
      { sections: JSON.stringify(['config', 'skills']) },
    );
    const res = await destApp.inject({
      method: 'POST',
      url: '/api/backups/import',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as Array<{
      section: string;
      success: boolean;
    }>;
    expect(results.map((r) => r.section).sort()).toEqual(['config', 'skills']);
    expect(results.every((r) => r.success)).toBe(true);
    expect(fs.existsSync(path.join(destHome, 'openaidy.json'))).toBe(true);
    expect(fs.existsSync(path.join(destHome, 'skills', 's1', 'SKILL.md'))).toBe(
      true,
    );

    await destApp.close();
    fs.rmSync(destHome, { recursive: true, force: true });
  });

  it('rejects import with no sections', async () => {
    const buf = await validBackupBuffer();
    const { body, contentType } = multipart(
      { field: 'file', filename: 'backup.zip', content: buf },
      { sections: '[]' },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/import',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown section', async () => {
    const buf = await validBackupBuffer();
    const { body, contentType } = multipart(
      { field: 'file', filename: 'backup.zip', content: buf },
      { sections: JSON.stringify(['bogus']) },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/backups/import',
      headers: { ...AUTH, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });
});
