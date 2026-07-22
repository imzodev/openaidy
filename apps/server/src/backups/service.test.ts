import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { BackupService, type BackupPaths } from './service';

let home: string;
let paths: BackupPaths;
let service: BackupService;

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** Zip the output of buildZip into an AdmZip by streaming to a temp file. */
async function buildZipToAdm(
  svc: BackupService,
  sections: Parameters<BackupService['buildZip']>[0],
): Promise<AdmZip> {
  const zipPath = path.join(
    home,
    `out-${Math.random().toString(36).slice(2)}.zip`,
  );
  const out = fs.createWriteStream(zipPath);
  await svc.buildZip(sections, out);
  return new AdmZip(fs.readFileSync(zipPath));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-backup-'));
  paths = {
    dbPath: path.join(home, 'data', 'openaidy.db'),
    configPath: path.join(home, 'openaidy.json'),
    workspacesDir: path.join(home, 'workspaces'),
    skillsDir: path.join(home, 'skills'),
    addonsDir: path.join(home, 'addons'),
  };
  // Fixtures
  write(paths.dbPath, 'SQLITEDATA');
  write(paths.configPath, '{"providers":[]}');
  write(path.join(paths.workspacesDir, 'default', 'AGENT.md'), '# agent');
  write(path.join(paths.workspacesDir, 'default', 'MISSION.md'), '# mission');
  write(path.join(paths.skillsDir, 'my-skill', 'SKILL.md'), '# skill');
  write(
    path.join(paths.addonsDir, 'my-addon', 'addon.json'),
    '{"id":"my-addon"}',
  );
  service = new BackupService(paths, '0.3.8');
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('BackupService.buildManifest', () => {
  it('returns a valid manifest with per-section counts and sizes', () => {
    const m = service.buildManifest();
    expect(m.kind).toBe('openaidy-backup');
    expect(m.version).toBe(1);
    expect(m.openaidyVersion).toBe('0.3.8');
    expect(m.sections.db.itemCount).toBe(1);
    expect(m.sections.db.sizeBytes).toBeGreaterThan(0);
    expect(m.sections.config.itemCount).toBe(1);
    expect(m.sections.workspaces.itemCount).toBe(1); // one top-level workspace
    expect(m.sections.workspaces.sizeBytes).toBeGreaterThan(0);
    expect(m.sections.skills.itemCount).toBe(1);
    expect(m.sections.addons.itemCount).toBe(1);
  });

  it('reports zero for missing sections', () => {
    fs.rmSync(paths.skillsDir, { recursive: true, force: true });
    const m = service.buildManifest();
    expect(m.sections.skills).toEqual({ itemCount: 0, sizeBytes: 0 });
  });
});

describe('BackupService.buildZip', () => {
  it('produces a zip with manifest.json and all sections when none specified', async () => {
    const zip = await buildZipToAdm(service, []);
    expect(zip.getEntry('manifest.json')).toBeTruthy();
    expect(zip.getEntry('db/openaidy.db')).toBeTruthy();
    expect(zip.getEntry('config/openaidy.json')).toBeTruthy();
    expect(zip.getEntry('workspaces/default/AGENT.md')).toBeTruthy();
    expect(zip.getEntry('skills/my-skill/SKILL.md')).toBeTruthy();
    expect(zip.getEntry('addons/my-addon/addon.json')).toBeTruthy();
  });

  it('includes only the selected sections', async () => {
    const zip = await buildZipToAdm(service, ['db']);
    expect(zip.getEntry('manifest.json')).toBeTruthy();
    expect(zip.getEntry('db/openaidy.db')).toBeTruthy();
    expect(zip.getEntry('config/openaidy.json')).toBeFalsy();
    expect(zip.getEntry('workspaces/default/AGENT.md')).toBeFalsy();
  });
});

describe('BackupService.readManifest', () => {
  it('reads the manifest from a valid backup zip', async () => {
    const zip = await buildZipToAdm(service, []);
    const manifest = service.readManifest(zip.toBuffer());
    expect(manifest.kind).toBe('openaidy-backup');
    expect(manifest.sections.config.itemCount).toBe(1);
  });

  it('throws on a non-zip file', () => {
    expect(() => service.readManifest(Buffer.from('not a zip'))).toThrow();
  });

  it('throws on a zip missing manifest.json', () => {
    const zip = new AdmZip();
    zip.addFile('db/openaidy.db', Buffer.from('x'));
    expect(() => service.readManifest(zip.toBuffer())).toThrow(/manifest/i);
  });
});

describe('BackupService.applySection', () => {
  // Apply into a fresh, empty destination home.
  let dest: BackupService;
  let destPaths: BackupPaths;
  let destHome: string;
  let sourceZip: AdmZip;

  beforeEach(async () => {
    sourceZip = await buildZipToAdm(service, []);
    destHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oaidy-restore-'));
    destPaths = {
      dbPath: path.join(destHome, 'data', 'openaidy.db'),
      configPath: path.join(destHome, 'openaidy.json'),
      workspacesDir: path.join(destHome, 'workspaces'),
      skillsDir: path.join(destHome, 'skills'),
      addonsDir: path.join(destHome, 'addons'),
    };
    dest = new BackupService(destPaths, '0.3.8');
  });

  afterEach(() => {
    fs.rmSync(destHome, { recursive: true, force: true });
  });

  it('replaces the db file and flags restart required', () => {
    const r = dest.applySection('db', sourceZip);
    expect(r).toMatchObject({
      section: 'db',
      success: true,
      restartRequired: true,
    });
    expect(fs.readFileSync(destPaths.dbPath, 'utf-8')).toBe('SQLITEDATA');
  });

  it('overwrites the config file', () => {
    write(destPaths.configPath, '{"stale":true}');
    const r = dest.applySection('config', sourceZip);
    expect(r.success).toBe(true);
    expect(fs.readFileSync(destPaths.configPath, 'utf-8')).toBe(
      '{"providers":[]}',
    );
  });

  it('merges workspaces: existing overwritten, new added, none deleted', () => {
    // Pre-existing files: one that will be overwritten, one that must survive.
    write(path.join(destPaths.workspacesDir, 'default', 'AGENT.md'), 'OLD');
    write(path.join(destPaths.workspacesDir, 'default', 'KEEP.md'), 'keep me');

    const r = dest.applySection('workspaces', sourceZip);
    expect(r.success).toBe(true);
    // Overwritten from backup:
    expect(
      fs.readFileSync(
        path.join(destPaths.workspacesDir, 'default', 'AGENT.md'),
        'utf-8',
      ),
    ).toBe('# agent');
    // New file added from backup:
    expect(
      fs.existsSync(
        path.join(destPaths.workspacesDir, 'default', 'MISSION.md'),
      ),
    ).toBe(true);
    // Pre-existing file NOT in the backup is preserved (no deletion):
    expect(
      fs.readFileSync(
        path.join(destPaths.workspacesDir, 'default', 'KEEP.md'),
        'utf-8',
      ),
    ).toBe('keep me');
  });

  it('is idempotent — re-applying yields the same bytes', () => {
    dest.applySection('skills', sourceZip);
    const first = fs.readFileSync(
      path.join(destPaths.skillsDir, 'my-skill', 'SKILL.md'),
      'utf-8',
    );
    dest.applySection('skills', sourceZip);
    const second = fs.readFileSync(
      path.join(destPaths.skillsDir, 'my-skill', 'SKILL.md'),
      'utf-8',
    );
    expect(second).toBe(first);
  });

  it('merges addons files', () => {
    const r = dest.applySection('addons', sourceZip);
    expect(r.success).toBe(true);
    expect(
      fs.existsSync(path.join(destPaths.addonsDir, 'my-addon', 'addon.json')),
    ).toBe(true);
  });
});
