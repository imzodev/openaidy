/**
 * Backup API client — manifest, export (download), preview, import.
 */

import { getStoredToken } from './auth-token';
import { API_BASE } from './api';
import type {
  BackupManifest,
  BackupPreview,
  BackupSection,
  ImportResponse,
} from '@openaidy/shared-types';

function authHeader(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Human-readable byte size, e.g. 5242880 → "5.0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** Live snapshot of what a full backup would contain. */
export async function getBackupManifest(): Promise<BackupManifest> {
  const response = await fetch(`${API_BASE}/api/backups/manifest`, {
    headers: authHeader(),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Failed to load backup info'));
  }
  const body = (await response.json()) as { manifest: BackupManifest };
  return body.manifest;
}

/**
 * Request a backup zip of the given sections and trigger a browser download.
 * Passing an empty array exports all sections.
 */
export async function downloadBackup(sections: BackupSection[]): Promise<void> {
  const response = await fetch(`${API_BASE}/api/backups/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ sections }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Backup export failed'));
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const date = new Date().toISOString().slice(0, 10);
  const filename = match?.[1] ?? `openaidy-backup-${date}.zip`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Upload a backup zip and read its manifest without applying anything. */
export async function previewBackup(file: File): Promise<BackupPreview> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE}/api/backups/preview`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Invalid backup file'));
  }
  return (await response.json()) as BackupPreview;
}

/** Upload a backup zip and apply the selected sections. */
export async function importBackup(
  file: File,
  sections: BackupSection[],
): Promise<ImportResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('sections', JSON.stringify(sections));
  const response = await fetch(`${API_BASE}/api/backups/import`, {
    method: 'POST',
    headers: authHeader(),
    body: form,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Import failed'));
  }
  return (await response.json()) as ImportResponse;
}
