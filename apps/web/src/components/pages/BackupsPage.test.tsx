import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import type { BackupManifest } from '@openaidy/shared-types';

vi.mock('../../lib/api-backups', () => ({
  getBackupManifest: vi.fn(),
  downloadBackup: vi.fn(),
  previewBackup: vi.fn(),
  importBackup: vi.fn(),
  formatBytes: (n: number) => `${n} B`,
}));

import {
  getBackupManifest,
  downloadBackup,
  previewBackup,
  importBackup,
} from '../../lib/api-backups';
import { BackupsPage } from './BackupsPage';

function manifest(): BackupManifest {
  return {
    version: 1,
    kind: 'openaidy-backup',
    createdAt: '2026-07-21T00:00:00.000Z',
    openaidyVersion: '0.3.8',
    sections: {
      db: { itemCount: 1, sizeBytes: 100 },
      config: { itemCount: 1, sizeBytes: 200 },
      workspaces: { itemCount: 3, sizeBytes: 300 },
      skills: { itemCount: 2, sizeBytes: 400 },
      addons: { itemCount: 1, sizeBytes: 500 },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it('downloads the selected sections', async () => {
    render(() => <BackupsPage />);
    await screen.findByLabelText('Database');
    // Deselect config, then download.
    fireEvent.click(screen.getByLabelText('Configuration'));
    fireEvent.click(screen.getByRole('button', { name: /download backup/i }));
    await waitFor(() => expect(downloadBackup).toHaveBeenCalledTimes(1));
    const sections = vi.mocked(downloadBackup).mock.calls[0]![0];
    expect(sections).not.toContain('config');
    expect(sections).toContain('db');
  });

  it('shows an error and does not download when no sections are selected', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /download backup/i }));
    await screen.findByText(/select at least one section/i);
    expect(downloadBackup).not.toHaveBeenCalled();
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

  it('previews a chosen file and renders its manifest', async () => {
    vi.mocked(previewBackup).mockResolvedValue({
      manifest: manifest(),
      zipSizeBytes: 1234,
    });
    await goToImport();
    selectFile();
    await waitFor(() => expect(previewBackup).toHaveBeenCalledTimes(1));
    // Manifest table rendered → section labels present, Restore button shown.
    expect(
      await screen.findByRole('button', { name: /restore/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Skills')).toBeInTheDocument();
  });

  it('restores the selected sections and shows results', async () => {
    vi.mocked(previewBackup).mockResolvedValue({
      manifest: manifest(),
      zipSizeBytes: 1234,
    });
    vi.mocked(importBackup).mockResolvedValue({
      results: [
        { section: 'config', success: true, itemsImported: 1 },
        { section: 'skills', success: true, itemsImported: 2 },
      ],
    });
    await goToImport();
    selectFile();
    const restore = await screen.findByRole('button', { name: /restore/i });
    fireEvent.click(restore);
    await waitFor(() => expect(importBackup).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/import results/i)).toBeInTheDocument();
  });

  it('shows an error when the file is not a valid backup', async () => {
    vi.mocked(previewBackup).mockRejectedValue(
      new Error('Not a valid zip archive'),
    );
    await goToImport();
    selectFile();
    expect(
      await screen.findByText(/not a valid zip archive/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
  });
});
