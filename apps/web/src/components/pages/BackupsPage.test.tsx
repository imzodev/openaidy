import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import type { BackupJob, BackupManifest } from '@openaidy/shared-types';

vi.mock('../../lib/api-backups', () => ({
  getBackupManifest: vi.fn(),
  getBackupJob: vi.fn(),
  startBackupExport: vi.fn(),
  cancelBackupJob: vi.fn(),
  waitForBackupJob: vi.fn(),
  downloadBackupFile: vi.fn(),
  uploadBackup: vi.fn(),
  discardBackupUpload: vi.fn(),
  startBackupImport: vi.fn(),
  formatBytes: (n: number) => `${n} B`,
}));

import {
  getBackupManifest,
  startBackupExport,
  waitForBackupJob,
  downloadBackupFile,
  uploadBackup,
  startBackupImport,
} from '../../lib/api-backups';
import { BackupsPage } from './BackupsPage';

function job(overrides: Partial<BackupJob> = {}): BackupJob {
  return {
    id: 'job-1',
    kind: 'export',
    status: 'running',
    phase: 'Adding workspaces',
    processedBytes: 50,
    totalBytes: 100,
    startedAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

function manifest(): BackupManifest {
  return {
    version: 1,
    kind: 'openaidy-backup',
    createdAt: '2026-07-21T00:00:00.000Z',
    openaidyVersion: '0.3.8',
    sections: {
      db: { itemCount: 1, sizeBytes: 100 },
      config: { itemCount: 1, sizeBytes: 200 },
      workspaces: { itemCount: 3, sizeBytes: 300, heavyBytes: 250 },
      skills: { itemCount: 2, sizeBytes: 400 },
      addons: { itemCount: 1, sizeBytes: 500 },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(getBackupManifest).mockResolvedValue(manifest());
});

describe('BackupsPage — export', () => {
  it('renders a checkbox for all 5 sections once the manifest loads', async () => {
    render(() => <BackupsPage />);
    for (const label of [
      'Database',
      'Configuration',
      'Workspaces',
      'Skills',
      'Addons',
    ]) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
    }
  });

  it('excludes heavy folders from the shown size until the box is ticked', async () => {
    render(() => <BackupsPage />);
    await screen.findByLabelText('Database');
    // 300 - 250 heavy bytes
    expect(screen.getByText('50 B')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/dependency and cache folders/i));
    expect(screen.getByText('300 B')).toBeInTheDocument();
  });

  it('starts an export of the selected sections, shows progress, then downloads', async () => {
    const done = job({
      status: 'succeeded',
      phase: 'Ready to download',
      fileSizeBytes: 77,
      downloadUrl: '/api/backups/exports/job-1/download?key=k',
    });
    vi.mocked(startBackupExport).mockResolvedValue(job());
    let finish!: (j: BackupJob) => void;
    vi.mocked(waitForBackupJob).mockImplementation((_id, onUpdate) => {
      onUpdate(job());
      return new Promise((r) => {
        finish = (j) => {
          onUpdate(j);
          r(j);
        };
      });
    });

    render(() => <BackupsPage />);
    await screen.findByLabelText('Database');
    // Deselect config, tick heavy folders, then create.
    fireEvent.click(screen.getByLabelText('Configuration'));
    fireEvent.click(screen.getByLabelText(/dependency and cache folders/i));
    fireEvent.click(screen.getByRole('button', { name: /create backup/i }));

    await waitFor(() => expect(startBackupExport).toHaveBeenCalledTimes(1));
    const [sections, includeHeavy] =
      vi.mocked(startBackupExport).mock.calls[0]!;
    expect(sections).not.toContain('config');
    expect(sections).toContain('db');
    expect(includeHeavy).toBe(true);

    expect(await screen.findByText('Adding workspaces')).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();

    finish(done);
    await waitFor(() => expect(downloadBackupFile).toHaveBeenCalledWith(done));
    expect(
      await screen.findByRole('button', { name: /download again/i }),
    ).toBeInTheDocument();
  });

  it('shows the error when the export job fails', async () => {
    vi.mocked(startBackupExport).mockResolvedValue(job());
    vi.mocked(waitForBackupJob).mockResolvedValue(
      job({
        status: 'failed',
        phase: 'Failed',
        error: 'Ran out of disk space',
      }),
    );
    render(() => <BackupsPage />);
    await screen.findByLabelText('Database');
    fireEvent.click(screen.getByRole('button', { name: /create backup/i }));
    expect(
      await screen.findByText(/ran out of disk space/i),
    ).toBeInTheDocument();
    expect(downloadBackupFile).not.toHaveBeenCalled();
  });

  it('shows an error and does not export when no sections are selected', async () => {
    render(() => <BackupsPage />);
    await screen.findByLabelText('Database');
    for (const label of [
      'Database',
      'Configuration',
      'Workspaces',
      'Skills',
      'Addons',
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole('button', { name: /create backup/i }));
    await screen.findByText(/select at least one section/i);
    expect(startBackupExport).not.toHaveBeenCalled();
  });
});

describe('BackupsPage — import', () => {
  async function goToImport() {
    render(() => <BackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    return screen.findByText(/choose backup file/i);
  }

  function selectFile() {
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'backup.zip', {
      type: 'application/zip',
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);
    return file;
  }

  function stagedUpload() {
    return {
      id: 'up-1',
      manifest: { ...manifest(), includesHeavyFolders: false },
      zipSizeBytes: 1234,
      expiresAt: '2026-07-21T01:00:00.000Z',
    };
  }

  it('uploads a chosen file and renders its manifest', async () => {
    vi.mocked(uploadBackup).mockReturnValue({
      promise: Promise.resolve(stagedUpload()),
      abort: vi.fn(),
    });
    await goToImport();
    selectFile();
    await waitFor(() => expect(uploadBackup).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole('button', { name: /restore/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Skills')).toBeInTheDocument();
    expect(screen.getByText(/reinstall/i)).toBeInTheDocument();
  });

  it('shows upload progress while the file is sent', async () => {
    vi.mocked(uploadBackup).mockImplementation((_file, onProgress) => {
      onProgress(1, 3);
      return { promise: new Promise(() => {}), abort: vi.fn() };
    });
    await goToImport();
    selectFile();
    expect(await screen.findByText('Uploading')).toBeInTheDocument();
    expect(screen.getByText(/33%/)).toBeInTheDocument();
  });

  it('restores the selected sections and shows results', async () => {
    vi.mocked(uploadBackup).mockReturnValue({
      promise: Promise.resolve(stagedUpload()),
      abort: vi.fn(),
    });
    vi.mocked(startBackupImport).mockResolvedValue(job({ kind: 'import' }));
    vi.mocked(waitForBackupJob).mockResolvedValue(
      job({
        kind: 'import',
        status: 'succeeded',
        results: [
          { section: 'config', success: true, itemsImported: 1 },
          { section: 'skills', success: true, itemsImported: 2 },
        ],
      }),
    );
    await goToImport();
    selectFile();
    fireEvent.click(await screen.findByRole('button', { name: /restore/i }));
    await waitFor(() => expect(startBackupImport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(startBackupImport).mock.calls[0]![0]).toBe('up-1');
    expect(await screen.findByText(/import results/i)).toBeInTheDocument();
  });

  it('shows an error when the file is not a valid backup', async () => {
    vi.mocked(uploadBackup).mockReturnValue({
      promise: Promise.reject(new Error('Not a valid zip archive')),
      abort: vi.fn(),
    });
    await goToImport();
    selectFile();
    expect(
      await screen.findByText(/not a valid zip archive/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
  });
});
